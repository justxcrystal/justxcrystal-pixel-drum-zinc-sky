import backtrader as bt


class MeridianICC(bt.Strategy):
    params = {
        "sizer": "FixedLotSizer",
        "sizer_lots": 0.01,
        "lookback": 80,
        "auto_close": "tp2",
        "trail": True,
        "armed": True,
        "cooldown": 48,
        "min_rr": 1.6,
    }

    def __init__(self):
        self.order = None
        self.entry_px = 0.0
        self.sl_px = 0.0
        self.trail_px = 0.0
        self.side = ""
        self.tp1 = 0.0
        self.tp2 = 0.0
        self.tp3 = 0.0
        self.tp4 = 0.0
        self.tp5 = 0.0
        self.tp6 = 0.0
        self.tagged = -1
        self.entry_bar = -1
        self.cool_until = 0

    def log(self, txt):
        dt = self.data.datetime.datetime(0)
        print(dt.isoformat() + " " + txt)

    def notify_order(self, order):
        if order.status in [order.Submitted, order.Accepted]:
            return
        if order.status == order.Completed:
            if order.isbuy():
                self.log("BUY " + str(order.executed.price))
                self.entry_px = float(order.executed.price)
            if order.issell():
                self.log("SELL " + str(order.executed.price))
                self.entry_px = float(order.executed.price)
            self.entry_bar = len(self)
        if order.status in [order.Canceled, order.Margin, order.Rejected]:
            self.log("Order fail " + str(order.getstatusname()))
            self.side = ""
        self.order = None

    def notify_trade(self, trade):
        if trade.isclosed:
            self.log("P&L " + str(trade.pnl))
            self.side = ""
            self.tagged = -1
            self.trail_px = 0.0
            self.entry_bar = -1
            self.cool_until = len(self) + int(self.p.cooldown)

    def _bar(self, n):
        o = []
        h = []
        l = []
        c = []
        i = n - 1
        while i >= 0:
            o.append(float(self.data.open[-i]))
            h.append(float(self.data.high[-i]))
            l.append(float(self.data.low[-i]))
            c.append(float(self.data.close[-i]))
            i = i - 1
        return o, h, l, c

    def _rng_hi(self, arr, a, b):
        m = arr[a]
        i = a
        while i < b:
            if arr[i] > m:
                m = arr[i]
            i = i + 1
        return m

    def _rng_lo(self, arr, a, b):
        m = arr[a]
        i = a
        while i < b:
            if arr[i] < m:
                m = arr[i]
            i = i + 1
        return m

    def _fvg(self, h, l, a, b, side):
        zhi = 0.0
        zlo = 0.0
        found = False
        i = a + 2
        while i < b:
            if side == "buy":
                if h[i - 2] < l[i]:
                    zhi = l[i]
                    zlo = h[i - 2]
                    found = True
            if side == "sell":
                if l[i - 2] > h[i]:
                    zhi = l[i - 2]
                    zlo = h[i]
                    found = True
            i = i + 1
        return found, zhi, zlo

    def _detect(self):
        n = int(self.p.lookback)
        o, h, l, c = self._bar(n)
        a1 = int(n * 0.38)
        if a1 < 6:
            a1 = 6
        m0 = int(n * 0.35)
        m1 = int(n * 0.48)
        if m1 < m0 + 3:
            m1 = m0 + 3
        i0 = int(n * 0.45)
        i1 = int(n * 0.60)
        if i1 < i0 + 3:
            i1 = i0 + 3
        c0 = int(n * 0.58)
        c1 = int(n * 0.70)
        if c1 < c0 + 3:
            c1 = c0 + 3
        t0 = int(n * 0.68)
        if t0 >= n - 2:
            t0 = n - 3
        acc_hi = self._rng_hi(h, 2, a1)
        acc_lo = self._rng_lo(l, 2, a1)
        sweep_lo = self._rng_lo(l, m0, m1)
        sweep_hi = self._rng_hi(h, m0, m1)
        dist_hi = self._rng_hi(h, t0, n)
        dist_lo = self._rng_lo(l, t0, n)
        dist_mid = (dist_hi + dist_lo) / 2.0
        acc_mid = (acc_hi + acc_lo) / 2.0
        last_o = o[n - 1]
        last_c = c[n - 1]
        last_h = h[n - 1]
        last_l = l[n - 1]
        indic_c = c[i1 - 1]
        side = ""
        bull = False
        bear = False
        if dist_mid > acc_mid:
            if indic_c > acc_mid:
                bull = True
        if dist_mid < acc_mid:
            if indic_c < acc_mid:
                bear = True
        if bull:
            if sweep_lo <= acc_lo:
                side = "buy"
        if bear:
            if sweep_hi >= acc_hi:
                side = "sell"
        if side == "":
            return False
        found, zhi, zlo = self._fvg(h, l, i0, c1, side)
        if found == False:
            return False
        pad = (acc_hi - acc_lo) * 0.05
        retest = False
        entry = last_c
        sl = last_c
        target = last_c
        if side == "buy":
            if last_l <= zhi:
                if last_c > zlo:
                    if last_c > last_o:
                        retest = True
            sl = sweep_lo - pad
            if acc_lo - pad < sl:
                sl = acc_lo - pad
            entry = last_c
            target = entry + abs(entry - sl) * 2.75
        if side == "sell":
            if last_h >= zlo:
                if last_c < zhi:
                    if last_c < last_o:
                        retest = True
            sl = sweep_hi + pad
            if acc_hi + pad > sl:
                sl = acc_hi + pad
            entry = last_c
            target = entry - abs(sl - entry) * 2.75
        if retest == False:
            return False
        risk = abs(entry - sl)
        if risk <= 0:
            return False
        tp2 = entry + (target - entry) * 0.411
        rr = abs(tp2 - entry) / risk
        if rr < float(self.p.min_rr):
            return False
        span = target - entry
        self.side = side
        self.entry_px = entry
        self.sl_px = sl
        self.trail_px = sl
        self.tp1 = entry + span * 0.27
        self.tp2 = entry + span * 0.411
        self.tp3 = entry + span * 0.556
        self.tp4 = entry + span * 0.688
        self.tp5 = entry + span * 0.83
        self.tp6 = entry + span * 1.0
        self.tagged = -1
        return True

    def _tp_at(self, idx):
        if idx == 0:
            return self.tp1
        if idx == 1:
            return self.tp2
        if idx == 2:
            return self.tp3
        if idx == 3:
            return self.tp4
        if idx == 4:
            return self.tp5
        return self.tp6

    def _auto_idx(self):
        ac = str(self.p.auto_close)
        if ac == "tp1":
            return 0
        if ac == "tp2":
            return 1
        if ac == "odds":
            return 4
        if ac == "tp6":
            return 5
        return -1

    def _manage(self):
        if self.entry_bar < 0:
            return
        if len(self) <= self.entry_bar:
            return
        hi = float(self.data.high[0])
        lo = float(self.data.low[0])
        cl = float(self.data.close[0])
        tagged = -1
        blocked = 0
        i = 0
        while i < 6:
            if blocked == 0:
                tp = self._tp_at(i)
                hit = 0
                if self.side == "buy":
                    if cl >= tp:
                        hit = 1
                if self.side == "sell":
                    if cl <= tp:
                        hit = 1
                if hit == 1:
                    tagged = i
                if hit == 0:
                    blocked = 1
            i = i + 1
        if tagged > self.tagged:
            self.tagged = tagged
        if self.p.trail:
            if self.tagged >= 0:
                locked = self.entry_px
                if self.tagged > 0:
                    locked = self._tp_at(self.tagged - 1)
                better = False
                if self.side == "buy":
                    if locked > self.trail_px:
                        better = True
                if self.side == "sell":
                    if locked < self.trail_px:
                        better = True
                if better:
                    self.trail_px = locked
                    self.log("Trail SL " + str(locked))
        sl = self.trail_px
        stop_hit = False
        if self.side == "buy":
            if lo <= sl:
                stop_hit = True
        if self.side == "sell":
            if hi >= sl:
                stop_hit = True
        if stop_hit:
            self.log("Stopped")
            self.order = self.close()
            return
        idx = self._auto_idx()
        if idx < 0:
            return
        tp = self._tp_at(idx)
        tp_hit = False
        if self.side == "buy":
            if hi >= tp:
                tp_hit = True
        if self.side == "sell":
            if lo <= tp:
                tp_hit = True
        if tp_hit:
            self.log("Auto-close " + str(self.p.auto_close))
            self.order = self.close()

    def next(self):
        if self.order:
            return
        n = int(self.p.lookback)
        if len(self.data) < n:
            return
        if self.position:
            self._manage()
            return
        if self.p.armed == False:
            return
        if len(self) < self.cool_until:
            return
        ok = self._detect()
        if ok == False:
            return
        self.log(self.side + " retest sl=" + str(self.sl_px) + " tp2=" + str(self.tp2))
        if self.side == "buy":
            self.order = self.buy()
        if self.side == "sell":
            self.order = self.sell()
