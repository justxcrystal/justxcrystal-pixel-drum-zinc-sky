#!/usr/bin/env python3
"""
Meridian ICC / AMD — Backtrader + TradeLocker

pip install backtrader tradelocker pandas

  python meridian_icc_tradelocker.py              # backtest on TradeLocker history
  python meridian_icc_tradelocker.py --csv gold.csv
  python meridian_icc_tradelocker.py --live       # live / demo orders (DRY_RUN first)

Same desk rules: with-trend continuation retest, TP1–TP6, TP2 / Odds / TP6,
trail SL to BE after TP1 then each prior TP.
"""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from typing import Literal, Optional

import backtrader as bt
import pandas as pd

# ── credentials ───────────────────────────────────────────────────────────
EMAIL = os.environ.get("TL_EMAIL", "you@email.com")
PASSWORD = os.environ.get("TL_PASSWORD", "YOUR_PASSWORD")
SERVER = os.environ.get("TL_SERVER", "YourBrokerName")  # prop welcome email, not Live/Demo
ENV = os.environ.get("TL_ENV", "demo")  # demo | live | bsa | bsb
ACC_NUM = int(os.environ.get("TL_ACC_NUM", "0"))

SYMBOL = os.environ.get("TL_SYMBOL", "XAUUSD")
RESOLUTION = os.environ.get("TL_TF", "15m")  # 5m | 15m | 30m | 1H
LOOKBACK = 80
AUTO_CLOSE: Literal["off", "tp1", "tp2", "odds", "tp6"] = "tp2"
TRAIL = True
ARMED = True
DRY_RUN = True  # --live still respects this until you set False
RISK_PCT = 0.02
CASH = 100_000.0
FIBS = (0.27, 0.411, 0.556, 0.688, 0.83, 1.0)
ODDS_I = 4  # TP5
AUTO_I = {"off": None, "tp1": 0, "tp2": 1, "odds": ODDS_I, "tp6": 5}

ENV_URL = {
    "demo": "https://demo.tradelocker.com",
    "live": "https://live.tradelocker.com",
    "bsa": "https://bsa.tradelocker.com",
    "bsb": "https://bsb.tradelocker.com",
}

Side = Literal["buy", "sell"]
Trend = Literal["bullish", "bearish"]


@dataclass
class Setup:
    trend: Trend
    side: Side
    entry: float
    sl: float
    tps: list[float]
    retest: bool
    note: str


def fibs(start: float, end: float) -> list[float]:
    span = end - start
    return [start + span * p for p in FIBS]


def fvg_zones(h, l, side: Side) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for i in range(2, len(h)):
        if side == "buy" and h[i - 2] < l[i]:
            out.append((l[i], h[i - 2]))
        if side == "sell" and l[i - 2] > h[i]:
            out.append((l[i - 2], h[i]))
    return out


def detect_setup(o, h, l, c) -> Optional[Setup]:
    n = len(c)
    if n < 50:
        return None
    a0, a1 = 2, max(3, int(n * 0.38))
    m0, m1 = int(n * 0.35), max(int(n * 0.48), int(n * 0.35) + 3)
    i0, i1 = int(n * 0.45), max(int(n * 0.60), int(n * 0.45) + 3)
    c0, c1 = int(n * 0.58), max(int(n * 0.70), int(n * 0.58) + 3)
    t0 = int(n * 0.68)

    acc_hi, acc_lo = max(h[a0:a1]), min(l[a0:a1])
    sweep_lo, sweep_hi = min(l[m0:m1]), max(h[m0:m1])
    dist_mid = (max(h[t0:]) + min(l[t0:])) / 2
    acc_mid = (acc_hi + acc_lo) / 2
    indic_c = c[i1 - 1]

    bull_raid = sweep_lo < acc_lo and indic_c > acc_lo
    bear_raid = sweep_hi > acc_hi and indic_c < acc_hi
    if dist_mid > acc_mid and (bull_raid or dist_mid > acc_mid):
        trend: Trend = "bullish"
    elif dist_mid < acc_mid:
        trend = "bearish"
    else:
        return None

    side: Side = "buy" if trend == "bullish" else "sell"
    last_c, last_h, last_l = c[-1], h[-1], l[-1]
    zones = fvg_zones(h[i0:c1], l[i0:c1], side)
    if not zones:
        body_hi, body_lo = max(o[m1 - 1], c[m1 - 1]), min(o[m1 - 1], c[m1 - 1])
        zones = [(body_hi, body_lo)]
    z_hi, z_lo = zones[-1]

    if side == "buy":
        retest = last_l <= z_hi and last_c >= z_lo
        sl = min(sweep_lo, acc_lo) - (acc_hi - acc_lo) * 0.02
        entry = max(z_lo, min(last_c, z_hi))
        target = entry + abs(entry - sl) * 2.75
    else:
        retest = last_h >= z_lo and last_c <= z_hi
        sl = max(sweep_hi, acc_hi) + (acc_hi - acc_lo) * 0.02
        entry = min(z_hi, max(last_c, z_lo))
        target = entry - abs(sl - entry) * 2.75

    return Setup(trend, side, entry, sl, fibs(entry, target), retest, f"{trend} · {side}")


def slice_ohlc(data, n: int):
    o = [float(data.open[-i]) for i in range(n - 1, -1, -1)]
    h = [float(data.high[-i]) for i in range(n - 1, -1, -1)]
    l = [float(data.low[-i]) for i in range(n - 1, -1, -1)]
    c = [float(data.close[-i]) for i in range(n - 1, -1, -1)]
    return o, h, l, c


class MeridianICC(bt.Strategy):
    params = dict(
        lookback=LOOKBACK,
        auto_close=AUTO_CLOSE,
        trail=TRAIL,
        armed=ARMED,
        risk_pct=RISK_PCT,
        printlog=True,
    )

    def __init__(self):
        self.order = None
        self.setup: Optional[Setup] = None
        self.initial_sl = None
        self.trail_px = None
        self.tagged = -1
        self.filled_bar = None

    def log(self, txt: str) -> None:
        if self.p.printlog:
            dt = self.data.datetime.datetime(0)
            print(f"{dt:%Y-%m-%d %H:%M}  {txt}")

    def notify_order(self, order: bt.Order) -> None:
        if order.status in {order.Submitted, order.Accepted}:
            return
        if order.status == order.Completed:
            side = "BUY" if order.isbuy() else "SELL"
            self.log(f"{side} filled {order.executed.price:.5f} size {order.executed.size}")
            if order.isbuy() or (order.issell() and self.setup and self.setup.side == "sell" and self.position):
                self.filled_bar = len(self)
        elif order.status in {order.Canceled, order.Margin, order.Rejected}:
            self.log(f"Order {order.getstatusname()}")
        self.order = None

    def notify_trade(self, trade: bt.Trade) -> None:
        if trade.isclosed:
            self.log(f"Trade P&L {trade.pnl:.2f}  net {trade.pnlcomm:.2f}")
            self.setup = None
            self.initial_sl = None
            self.trail_px = None
            self.tagged = -1
            self.filled_bar = None

    def _size(self, setup: Setup) -> int:
        risk = self.broker.getvalue() * self.p.risk_pct
        dist = abs(setup.entry - setup.sl) or 1.0
        raw = max(1, int(risk / dist))
        return raw

    def next(self) -> None:
        if self.order:
            return
        n = min(self.p.lookback, len(self.data))
        if n < 50:
            return
        o, h, l, c = slice_ohlc(self.data, n)
        setup = detect_setup(o, h, l, c)
        if setup:
            self.setup = setup

        if self.position:
            self._manage()
            return

        if not self.p.armed or not setup or not setup.retest:
            return
        if self.filled_bar is not None:
            return

        size = self._size(setup)
        self.initial_sl = setup.sl
        self.trail_px = setup.sl
        self.tagged = -1
        self.log(
            f"{setup.note}  entry {setup.entry:.5f}  sl {setup.sl:.5f}  "
            f"tp2 {setup.tps[1]:.5f}  tp6 {setup.tps[5]:.5f}"
        )
        if setup.side == "buy":
            self.order = self.buy(size=size)
        else:
            self.order = self.sell(size=size)

    def _manage(self) -> None:
        if not self.setup:
            return
        hi, lo = float(self.data.high[0]), float(self.data.low[0])
        tps = self.setup.tps
        side: Side = "buy" if self.position.size > 0 else "sell"

        tagged = -1
        for i, tp in enumerate(tps):
            if (side == "buy" and hi >= tp) or (side == "sell" and lo <= tp):
                tagged = i
            else:
                break
        self.tagged = max(self.tagged, tagged)

        if self.p.trail and self.tagged >= 0:
            locked = self.setup.entry if self.tagged == 0 else tps[self.tagged - 1]
            better = locked > self.trail_px if side == "buy" else locked < self.trail_px
            if better:
                self.trail_px = locked
                self.log(f"Trail SL → {locked:.5f} (after TP{self.tagged + 1})")

        sl = self.trail_px if self.trail_px is not None else self.initial_sl
        if sl is not None:
            if (side == "buy" and lo <= sl) or (side == "sell" and hi >= sl):
                self.log("Stopped")
                self.order = self.close()
                return

        tp_i = AUTO_I.get(self.p.auto_close)
        if tp_i is None:
            return
        tp = tps[tp_i]
        if (side == "buy" and hi >= tp) or (side == "sell" and lo <= tp):
            label = "ODDS TP5" if self.p.auto_close == "odds" else f"TP{tp_i + 1}"
            self.log(f"Auto-close {label}")
            self.order = self.close()


def tl_client():
    from tradelocker import TLAPI

    if EMAIL.endswith("@email.com") or PASSWORD == "YOUR_PASSWORD":
        raise SystemExit("Set TL_EMAIL, TL_PASSWORD, TL_SERVER before pulling TradeLocker data.")
    return TLAPI(
        environment=ENV_URL[ENV],
        username=EMAIL,
        password=PASSWORD,
        server=SERVER,
        acc_num=ACC_NUM,
        log_level="warning",
    )


def load_tl_history(symbol: str, tf: str, lookback_period: str = "30D") -> pd.DataFrame:
    tl = tl_client()
    iid = tl.get_instrument_id_from_symbol_name(symbol)
    df = tl.get_price_history(
        iid,
        resolution=tf,
        lookback_period=lookback_period,
        start_timestamp=0,
        end_timestamp=0,
    )
    df = df.rename(columns=str.lower)
    t = pd.to_datetime(df["t"], unit="ms", utc=True)
    if t.dt.tz is not None:
        t = t.dt.tz_convert(None)
    out = pd.DataFrame(
        {
            "datetime": t,
            "open": df["o"].astype(float),
            "high": df["h"].astype(float),
            "low": df["l"].astype(float),
            "close": df["c"].astype(float),
            "volume": df["v"].astype(float) if "v" in df else 0.0,
        }
    )
    return out.set_index("datetime").sort_index()


def load_csv(path: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    df.columns = [c.lower() for c in df.columns]
    ts = "datetime" if "datetime" in df.columns else df.columns[0]
    df[ts] = pd.to_datetime(df[ts], utc=True, errors="coerce")
    df = df.rename(columns={"o": "open", "h": "high", "l": "low", "c": "close", "v": "volume"})
    df = df.set_index(ts).sort_index()
    if df.index.tz is not None:
        df.index = df.index.tz_convert(None)
    return df[["open", "high", "low", "close"] + (["volume"] if "volume" in df.columns else [])]


def run_cerebro(df: pd.DataFrame) -> None:
    feed = bt.feeds.PandasData(dataname=df)
    cerebro = bt.Cerebro()
    cerebro.addstrategy(
        MeridianICC,
        lookback=LOOKBACK,
        auto_close=AUTO_CLOSE,
        trail=TRAIL,
        armed=ARMED,
        risk_pct=RISK_PCT,
    )
    cerebro.adddata(feed, name=SYMBOL)
    cerebro.broker.setcash(CASH)
    cerebro.broker.setcommission(commission=0.0002)
    cerebro.addanalyzer(bt.analyzers.TradeAnalyzer, _name="trades")
    cerebro.addanalyzer(bt.analyzers.DrawDown, _name="dd")
    cerebro.addanalyzer(bt.analyzers.SharpeRatio, _name="sharpe", timeframe=bt.TimeFrame.Days)
    print(f"Start {cerebro.broker.getvalue():,.2f}  {SYMBOL} {RESOLUTION}  auto-close {AUTO_CLOSE}")
    res = cerebro.run()
    strat = res[0]
    print(f"End   {cerebro.broker.getvalue():,.2f}")
    trades = strat.analyzers.trades.get_analysis()
    total = trades.get("total", {}).get("closed", 0)
    won = trades.get("won", {}).get("total", 0)
    lost = trades.get("lost", {}).get("total", 0)
    pnl = trades.get("pnl", {}).get("net", {}).get("total", 0)
    dd = strat.analyzers.dd.get_analysis().get("max", {}).get("drawdown", 0)
    print(f"Trades {total}  {won}W/{lost}L  net {pnl:.2f}  maxDD {dd:.2f}%")
    try:
        cerebro.plot(style="candle")
    except Exception:
        pass


def run_live() -> None:
    """Poll TradeLocker and fire the same Backtrader rules as market orders."""
    import time
    from tradelocker import TLAPI

    tl: TLAPI = tl_client()
    iid = tl.get_instrument_id_from_symbol_name(SYMBOL)
    print(f"LIVE {ENV} {SYMBOL} {RESOLUTION}  DRY_RUN={DRY_RUN}  auto-close {AUTO_CLOSE}")
    filled = False
    pos_id = None
    setup: Optional[Setup] = None
    trail_px = None
    tagged = -1

    try:
        while True:
            df = load_tl_history(SYMBOL, RESOLUTION, "5D").tail(LOOKBACK)
            o = df.open.tolist()
            h = df.high.tolist()
            l = df.low.tolist()
            c = df.close.tolist()
            setup = detect_setup(o, h, l, c)
            if setup:
                print(setup.note, "retest" if setup.retest else "wait", f"sl {setup.sl:.5f}")

            positions = tl.get_all_positions()
            open_row = None
            if not positions.empty:
                col = "tradableInstrumentId" if "tradableInstrumentId" in positions.columns else None
                if col:
                    hit = positions[positions[col].astype(int) == iid]
                    if not hit.empty:
                        open_row = hit.iloc[0]
                        pos_id = int(open_row.get("id", open_row.get("positionId", 0)))

            if open_row is not None and setup:
                hi, lo = float(df.high.max()), float(df.low.min())
                side = setup.side
                tps = setup.tps
                tag = -1
                for i, tp in enumerate(tps):
                    if (side == "buy" and hi >= tp) or (side == "sell" and lo <= tp):
                        tag = i
                    else:
                        break
                tagged = max(tagged, tag)
                if TRAIL and tagged >= 0:
                    locked = setup.entry if tagged == 0 else tps[tagged - 1]
                    cur = trail_px if trail_px is not None else setup.sl
                    better = locked > cur if side == "buy" else locked < cur
                    if better:
                        trail_px = locked
                        print(f"Trail SL → {locked:.5f}")
                        if not DRY_RUN and pos_id:
                            tl.modify_position(pos_id, {"stopLoss": locked, "stopLossType": "absolute"})
                sl = trail_px if trail_px is not None else setup.sl
                tp_i = AUTO_I[AUTO_CLOSE]
                stop_hit = (side == "buy" and lo <= sl) or (side == "sell" and hi >= sl)
                tp_hit = tp_i is not None and (
                    (side == "buy" and hi >= tps[tp_i]) or (side == "sell" and lo <= tps[tp_i])
                )
                if stop_hit or tp_hit:
                    print("Close", "SL" if stop_hit else AUTO_CLOSE)
                    if not DRY_RUN and pos_id:
                        tl.close_position(position_id=pos_id)
                    filled = True
                    pos_id = None
            elif (
                ARMED
                and setup
                and setup.retest
                and not filled
                and open_row is None
            ):
                tp_i = AUTO_I[AUTO_CLOSE]
                tp = None if tp_i is None else setup.tps[tp_i]
                print(f"{'[DRY] ' if DRY_RUN else ''}{setup.side.upper()} {SYMBOL} sl={setup.sl} tp={tp}")
                if not DRY_RUN:
                    oid = tl.create_order(
                        iid,
                        quantity=0.01,
                        side=setup.side,
                        type_="market",
                        stop_loss=setup.sl,
                        stop_loss_type="absolute",
                        take_profit=tp,
                        take_profit_type="absolute" if tp is not None else None,
                        strategy_id="meridian-icc",
                    )
                    print("order", oid)
                    trail_px = setup.sl
                filled = True

            time.sleep(15)
    except KeyboardInterrupt:
        print("Stopped")
        if pos_id and not DRY_RUN:
            tl.close_position(position_id=pos_id)


def main() -> None:
    p = argparse.ArgumentParser(description="Meridian ICC / AMD — Backtrader + TradeLocker")
    p.add_argument("--csv", help="OHLC csv (datetime,open,high,low,close)")
    p.add_argument("--live", action="store_true", help="Poll TradeLocker and place orders")
    p.add_argument("--symbol", default=SYMBOL)
    p.add_argument("--tf", default=RESOLUTION)
    args = p.parse_args()

    global SYMBOL, RESOLUTION
    SYMBOL, RESOLUTION = args.symbol, args.tf

    if args.live:
        run_live()
        return
    if args.csv:
        df = load_csv(args.csv)
    else:
        df = load_tl_history(SYMBOL, RESOLUTION)
    run_cerebro(df)


if __name__ == "__main__":
    main()
