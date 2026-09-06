import { useEffect, useRef } from "react";
import { getScenario, viewScenario } from "@/lib/desk/scenarios";
import { downloadBlob, loadMockupScene } from "@/lib/desk/download";
import { hydrateDesk, useDesk } from "@/lib/desk/store";
import { renderTradePost } from "@/lib/desk/trophy";
import {
  AccountStrip,
  BacktestCard,
  DeskHeader,
  EquityCard,
  JournalCard,
  PositionsCard,
  ScanCard,
} from "./Cards";
import { ConnectPanel } from "./LoginScreen";
import { PriceChart } from "./PriceChart";
import { DeskDrawers } from "./Sheets";
import { SessionStrip } from "./XFeed";

export function DeskApp() {
  const symbol = useDesk((s) => s.symbol);
  const candleStyle = useDesk((s) => s.candleStyle);
  const tf = useDesk((s) => s.tf);
  const replay = useDesk((s) => s.replay);
  const setReplay = useDesk((s) => s.setReplay);
  const position = useDesk((s) => s.position);
  const tl = useDesk((s) => s.tl);
  const refreshTl = useDesk((s) => s.refreshTl);
  const pullLive = useDesk((s) => s.pullLive);
  const pullQuote = useDesk((s) => s.pullQuote);
  const liveScenario = useDesk((s) => s.liveScenario);
  const liveError = useDesk((s) => s.liveError);
  const liveLabel = useDesk((s) => s.liveLabel);
  const brokerOn = useDesk((s) => s.brokerOn);
  const paper = liveScenario && liveScenario.symbol === symbol ? liveScenario : getScenario(symbol);
  const scenario = viewScenario(paper, tf);
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    hydrateDesk();
    const desk = useDesk.getState();
    void desk.pullLive();
    desk.tryAutoFill();
    desk.tryAutoManage();
  }, []);

  useEffect(() => {
    void pullLive();
    const bars = window.setInterval(() => {
      void pullLive();
    }, 10_000);
    const quotes = window.setInterval(() => {
      void pullQuote();
    }, 2_000);
    return () => {
      window.clearInterval(bars);
      window.clearInterval(quotes);
    };
  }, [symbol, tf, pullLive, pullQuote]);

  useEffect(() => {
    if (symbol !== "BTCUSD" && symbol !== "ETHUSD") return;
    let dead = false;
    const feed = symbol === "ETHUSD" ? "/__desk/eth" : "/__desk/btc";

    const loadTick = async () => {
      try {
        const res = await fetch(`${feed}?kind=ticker`, { cache: "no-store" });
        if (!res.ok) {
          void pullQuote();
          return;
        }
        const json = (await res.json()) as { price?: string };
        const px = Number(json.price);
        if (!dead && px) useDesk.getState().applyLast(px);
      } catch {
        void pullQuote();
      }
    };

    const loadBars = async () => {
      try {
        const res = await fetch(`${feed}?kind=candles&tf=${tf}`, { cache: "no-store" });
        if (!res.ok) return;
        const rows = (await res.json()) as unknown;
        if (!Array.isArray(rows)) return;
        const candles: { t: number; o: number; h: number; l: number; c: number }[] = [];
        for (const row of rows) {
          if (!Array.isArray(row) || row.length < 5) continue;
          const t = Number(row[0]);
          const l = Number(row[1]);
          const h = Number(row[2]);
          const o = Number(row[3]);
          const c = Number(row[4]);
          if (!t || !o || !c) continue;
          candles.push({ t: t < 1e12 ? t * 1000 : t, o, h, l, c });
        }
        candles.sort((a, b) => a.t - b.t);
        if (!dead && candles.length >= 10) useDesk.getState().ingestBars(candles);
      } catch {
        void pullLive();
      }
    };

    void loadBars();
    void loadTick();
    const ticks = window.setInterval(() => {
      void loadTick();
    }, 1_000);
    const bars = window.setInterval(() => {
      void loadBars();
    }, 8_000);
    return () => {
      dead = true;
      window.clearInterval(ticks);
      window.clearInterval(bars);
    };
  }, [symbol, tf, pullLive, pullQuote]);

  useEffect(() => {
    if (!tl) return;
    void refreshTl();
    const auth = window.setInterval(() => {
      void refreshTl();
    }, 180_000);
    return () => window.clearInterval(auth);
  }, [tl?.accessToken, refreshTl]);

  const journalHead = useDesk((s) => s.journal[0]?.id);
  const armedDownload = useRef(false);
  useEffect(() => {
    const t = window.setTimeout(() => {
      armedDownload.current = true;
    }, 2500);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!armedDownload.current || !journalHead) return;
    const trade = useDesk.getState().journal[0];
    if (!trade) return;
    const live = useDesk.getState().liveScenario;
    const candles =
      live && live.symbol === trade.symbol ? live.candles : getScenario(trade.symbol).candles;
    void renderTradePost({
      trade,
      candles,
      scene: loadMockupScene(),
    })
      .then((blob) => {
        downloadBlob(blob, `justxcrystal-${trade.symbol}-${trade.side}.jpg`);
      })
      .catch(() => {
        /* keep desk running */
      });
  }, [journalHead]);

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-bg text-fg">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-40"
        style={{ backgroundImage: "url('/meridian-seal-background.png')" }}
      />
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_center,rgba(11,11,13,0.24),rgba(11,11,13,0.88)_82%)]" />
      <div className="relative z-10 mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-3 px-4 py-4 pb-10 md:gap-4 md:py-6 md:pb-12">
        <SessionStrip />
        <DeskHeader />
        <ScanCard />
        {!tl ? <ConnectPanel /> : null}
        <AccountStrip />
        <div className="grid min-w-0 items-start gap-3 md:grid-cols-12 md:gap-4">
          <div className="flex min-w-0 flex-col gap-3 md:col-span-7 md:gap-4">
            <PriceChart
              scenario={scenario}
              style={candleStyle}
              replay={replay}
              onReplay={setReplay}
              position={position}
            />
            <PositionsCard scenario={scenario} />
          </div>
          <div className="flex min-w-0 flex-col gap-3 md:col-span-5 md:gap-4">
            <EquityCard />
            <BacktestCard scenario={scenario} />
            <JournalCard />
            <p className="px-1 text-center text-xs leading-relaxed text-faint">
              {liveError
                ? `Live feed: ${liveError}`
                : liveLabel
                  ? `LIVE ${liveLabel}. Send to TradeLocker is ${brokerOn ? "ON" : "off"}.`
                  : tl
                    ? `Connected to ${tl.server}. Loading live bars…`
                    : "Paper desk. Connect TradeLocker on the right — orders only send while this screen is open."}
            </p>
            <p className="px-1 text-center text-xs leading-relaxed text-faint">
              This desk does not trade in the background. Close the tab and auto-enter stops. For 24/7, run the TradeLocker Bot Studio python.
            </p>
            <p className="px-1 text-center font-mono text-2xs leading-relaxed text-faint">
              © 2026 JustxCrystal Capital. All rights reserved.
            </p>
            <div aria-hidden className="pointer-events-none mt-6 flex justify-center pb-4">
              <img
                src="/seal.png"
                alt=""
                className="h-24 w-24 select-none opacity-[0.16] md:h-28 md:w-28"
              />
            </div>
          </div>
        </div>
      </div>
      <DeskDrawers />
    </div>
  );
}
