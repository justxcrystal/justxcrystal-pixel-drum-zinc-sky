import { BookOpen, Power, ScanSearch, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ACCOUNTS, getAccount } from "@/lib/desk/accounts";
import { SYMBOLS, backtestStats, withTrendSide } from "@/lib/desk/scenarios";
import { money, moneyCompact, pct, price, signedMoney, signedR } from "@/lib/desk/format";
import { liveScan, paperScan, type ScanHit } from "@/lib/desk/scan";
import {
  challengeIndexLocked,
  equityOf,
  isIndexSymbol,
  todayPnl,
  useDesk,
} from "@/lib/desk/store";
import { AUTO_CLOSE, autoCloseLabel, BANK_TPS, type Scenario } from "@/lib/desk/types";
import { cn } from "@/lib/utils";

const SESSION_HOURS = [1, 2, 3, 4] as const;

function formatRemain(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function SessionClock() {
  const sessionHours = useDesk((s) => s.sessionHours);
  const sessionEnd = useDesk((s) => s.sessionEnd);
  const setSessionHours = useDesk((s) => s.setSessionHours);
  const tickSession = useDesk((s) => s.tickSession);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    tickSession();
    const id = window.setInterval(() => {
      setNow(Date.now());
      useDesk.getState().tickSession();
    }, 1000);
    return () => window.clearInterval(id);
  }, [tickSession]);

  const remain = sessionEnd == null ? sessionHours * 60 * 60 * 1000 : sessionEnd - now;
  const open = sessionEnd == null || remain > 0;
  const next = SESSION_HOURS[(SESSION_HOURS.indexOf(sessionHours) + 1) % SESSION_HOURS.length];

  return (
    <Button
      variant={open ? "muted" : "sell"}
      className="min-w-[7.5rem] px-3.5 font-mono tabular-nums"
      onClick={() => setSessionHours(open ? next : sessionHours)}
      aria-label="Desk session length"
    >
      {open ? `${sessionHours}H ${formatRemain(remain)}` : "REOPEN"}
    </Button>
  );
}

export function DeskHeader() {
  const armed = useDesk((s) => s.armed);
  const setArmed = useDesk((s) => s.setArmed);
  const openPlaybook = useDesk((s) => s.openPlaybook);
  const openSettings = useDesk((s) => s.openSettings);
  const position = useDesk((s) => s.position);
  const flatten = useDesk((s) => s.flatten);
  const flattenAtClose = useDesk((s) => s.flattenAtClose);
  const setFlattenAtClose = useDesk((s) => s.setFlattenAtClose);
  const tl = useDesk((s) => s.tl);
  const disconnectTl = useDesk((s) => s.disconnectTl);
  const [scanBusy, setScanBusy] = useState(false);

  async function bringDistribution() {
    if (scanBusy) return;
    setScanBusy(true);
    try {
      const desk = useDesk.getState();
      const locked = challengeIndexLocked(desk);
      const rows = await liveScan({ tf: desk.tf, tl: desk.tl });
      const tradable = locked ? rows.filter((h) => !isIndexSymbol(h.symbol)) : rows;
      const best =
        tradable.find((h) => h.rank >= 3) ??
        tradable.find((h) => h.dist) ??
        tradable[0];
      if (best) {
        desk.setSymbol(best.symbol);
        toast.message(
          best.rank >= 3
            ? `${best.symbol} · DIST RETEST on the chart`
            : `${best.symbol} · ${best.tag} on the chart`,
        );
      }
    } finally {
      setScanBusy(false);
    }
  }

  return (
    <header className="flex min-w-0 items-center gap-2">
      <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 shadow-border">
        <img src="/griffin.png" alt="" className="size-8 object-contain" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-2xs tracking-label text-faint uppercase">Meridian</p>
        <h1 className="truncate text-lg font-semibold leading-tight text-fg">ICC / AMD desk</h1>
      </div>
      {tl ? (
        <Button variant="muted" className="px-3.5" onClick={disconnectTl}>
          Sign out
        </Button>
      ) : null}
      <SessionClock />
      <Button
        variant="muted"
        className="min-w-24 px-3.5"
        disabled={scanBusy}
        onClick={() => void bringDistribution()}
      >
        <ScanSearch className="size-4" />
        {scanBusy ? "Scan…" : "Scan"}
      </Button>
      <Button variant="icon" size="icon" aria-label="Playbook" onClick={() => openPlaybook(true)}>
        <BookOpen className="size-4" />
      </Button>
      <Button variant="icon" size="icon" aria-label="Settings" onClick={() => openSettings(true)}>
        <SlidersHorizontal className="size-4" />
      </Button>
      <Button
        variant={armed ? "default" : "muted"}
        className="min-w-28 px-3.5"
        onClick={() => setArmed(!armed)}
        aria-pressed={armed}
      >
        <Power className="size-4" />
        {armed ? "Armed" : "Disarmed"}
      </Button>
      {position ? (
        <Button variant="sell" className="min-w-24 px-3.5" onClick={flatten}>
          Flatten
        </Button>
      ) : null}
      {position ? (
        <Button
          variant={flattenAtClose ? "sell" : "muted"}
          className="min-w-[8.5rem] px-3.5"
          onClick={() => setFlattenAtClose(!flattenAtClose)}
          aria-pressed={flattenAtClose}
        >
          {flattenAtClose ? "Close armed" : "Flatten at close"}
        </Button>
      ) : null}
    </header>
  );
}

function FlipMiniChart({ equity, start }: { equity: number; start: number }) {
  const accountId = useDesk((s) => s.accountId);
  const journal = useDesk((s) => s.journal);
  const challengeAt = useDesk((s) => s.challengeAt);
  const goal = start * 2;
  const fills = journal
    .filter((j) => j.accountId === accountId && j.at >= (challengeAt ?? 0))
    .slice()
    .sort((a, b) => a.at - b.at);
  let run = start;
  const data = [{ i: 0, v: start, goal }];
  fills.forEach((j, i) => {
    run += j.pnl;
    data.push({ i: i + 1, v: run, goal });
  });
  if (data.length === 1) data.push({ i: 1, v: Number.isFinite(equity) ? equity : start, goal });
  const doubled = equity >= goal;
  const span = Math.max(goal - start, 1);
  const pctDone = Math.min(100, Math.max(0, ((equity - start) / span) * 100));
  if (!Number.isFinite(pctDone)) return null;

  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-2xs tracking-label text-faint uppercase">Mini chart</p>
        <p className={cn("font-mono text-2xs tabular-nums", doubled ? "text-primary" : "text-muted")}>
          {money(equity, 2)} / {money(goal, 0)} {doubled ? "· indices open" : "· to unlock"}
        </p>
      </div>
      <div className="mt-2 h-24">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
            <Line
              type="monotone"
              dataKey="goal"
              stroke="rgba(255,255,255,0.18)"
              strokeWidth={1}
              strokeDasharray="4 4"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="v"
              stroke={equity >= start ? "var(--color-primary)" : "var(--color-loss)"}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
        <div
          className={cn("h-full rounded-full", doubled ? "bg-primary" : "bg-primary/70")}
          style={{ width: `${pctDone}%` }}
        />
      </div>
    </div>
  );
}

export function EquityCard() {
  const accountId = useDesk((s) => s.accountId);
  const journal = useDesk((s) => s.journal);
  const paperOn = useDesk((s) => s.paperOn);
  const setPaperOn = useDesk((s) => s.setPaperOn);
  const brokerOn = useDesk((s) => s.brokerOn);
  const setBrokerOn = useDesk((s) => s.setBrokerOn);
  const lots = useDesk((s) => s.lots);
  const setLots = useDesk((s) => s.setLots);
  const paperStart = useDesk((s) => s.paperStart);
  const setPaperStart = useDesk((s) => s.setPaperStart);
  const challengeOn = useDesk((s) => s.challengeOn);
  const challengeAt = useDesk((s) => s.challengeAt);
  const startFlip100 = useDesk((s) => s.startFlip100);
  const armed = useDesk((s) => s.armed);
  const openSettings = useDesk((s) => s.openSettings);
  const tl = useDesk((s) => s.tl);
  const tradeAll = useDesk((s) => s.tradeAll);
  const setTradeAll = useDesk((s) => s.setTradeAll);
  const account = getAccount(accountId);
  const tlAcc = tl?.accounts.find((a) => a.id === accountId) ?? tl?.accounts[0];
  const tlCount = tl?.accounts.length ?? 0;
  const equity = equityOf({
    accountId,
    journal,
    tl,
    paperStart,
    challengeOn,
    challengeAt,
  });
  const today = todayPnl({
    accountId,
    journal,
    tl,
    paperStart,
    challengeOn,
    challengeAt,
  });
  const connected = Boolean(tlAcc);

  return (
    <section className="rounded-3xl bg-surface px-5 py-5 shadow-border">
      <button type="button" onClick={() => openSettings(true)} className="block w-full text-left">
        <p className="font-mono text-xs tracking-label text-faint uppercase">
          {connected && tlAcc
            ? `${tlAcc.name} · ${tl?.env} · ${tl?.server}`
            : `${account.code} · ${account.sizeLabel} · paper`}
        </p>
        <p className="mt-2 font-mono text-4xl font-medium tracking-tight text-fg tabular-nums">
          {moneyCompact(equity)}
        </p>
        <p
          className={cn(
            "mt-1 font-mono text-sm tabular-nums",
            today >= 0 ? "text-primary" : "text-loss",
          )}
        >
          Today {signedMoney(today)}
        </p>
      </button>
      <div className="mt-4 rounded-2xl bg-surface-2 px-4 py-3 shadow-border">
        <p className="font-mono text-2xs tracking-label text-faint uppercase">
          {challengeOn ? "Flip $100 challenge" : "Paper bankroll"}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Input
            type="number"
            min={1}
            step={1}
            value={paperStart}
            onChange={(e) => setPaperStart(Number(e.target.value) || 1)}
            className="h-11 font-mono"
            aria-label="Paper starting amount"
          />
          <Button type="button" variant="muted" className="shrink-0 px-3.5" onClick={startFlip100}>
            Flip $100
          </Button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-faint">
          {challengeOn
            ? `Book ${money(equity, 2)} from $100 · ${money(Math.max(0, equity - 100), 2)} flipped · live ${lots} lot. Indices locked until $200.`
            : "Type any paper start. Flip $100 resets the challenge book on paper and live (0.01 lot)."}
        </p>
        {challengeOn ? <FlipMiniChart equity={equity} start={paperStart || 100} /> : null}
        <div className="mt-3">
          <p className="mb-1 font-mono text-2xs tracking-label text-faint uppercase">Live lots</p>
          <Input
            type="number"
            min={0.01}
            step={0.01}
            value={lots}
            onChange={(e) => setLots(Number(e.target.value) || 0.01)}
            className="h-11 font-mono"
            aria-label="Live lot size"
          />
        </div>
      </div>
      <div className="mt-4 h-px bg-border" />
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1 overflow-hidden">
          <p className="text-sm font-medium text-fg">Live execution</p>
          <p className="mt-0.5 truncate text-xs text-faint">
            {paperOn
              ? armed
                ? "Auto-enter retest on this desk (paper chart)"
                : "On, but desk is Disarmed"
              : "Off — no auto-enter"}
          </p>
        </div>
        <Switch checked={paperOn} onCheckedChange={setPaperOn} aria-label="Live execution" />
      </div>
      {tl ? (
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="text-sm font-medium text-fg">Send to TradeLocker</p>
            <p className="mt-0.5 truncate text-xs text-faint">
              {brokerOn
                ? `Buy/Sell/Flatten → ATLAS · ${lots} lot`
                : "Off — journal stays paper"}
            </p>
          </div>
          <Switch checked={brokerOn} onCheckedChange={setBrokerOn} aria-label="Send to TradeLocker" />
        </div>
      ) : (
        <p className="mt-4 text-xs leading-relaxed text-faint">
          Journal is paper on this desk. Log into TradeLocker, then turn on Send to TradeLocker.
        </p>
      )}
      {tl ? (
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="text-sm font-medium text-fg">Copy my Atlas accounts</p>
            <p className="mt-0.5 text-xs leading-relaxed text-faint">
              {!brokerOn
                ? "Send to TradeLocker is off — nothing copies."
                : tlCount < 2
                  ? "This login has one ATLAS account. Copy needs 2+ on the same owner."
                  : tradeAll
                    ? `Master = this desk. One fill → ${tlCount} ATLAS accounts (your accounts only).`
                    : "Copy off. Tap Copy on the account row to fan the same trade."}
            </p>
          </div>
          <Switch
            checked={Boolean(brokerOn && tradeAll && tlCount > 1)}
            onCheckedChange={(v) => setTradeAll(v)}
            aria-label="Copy Atlas accounts"
          />
        </div>
      ) : null}
    </section>
  );
}

export function PositionsCard({ scenario }: { scenario: Scenario }) {
  const position = useDesk((s) => s.position);
  const closePosition = useDesk((s) => s.closePosition);
  const takeTrade = useDesk((s) => s.takeTrade);
  const armed = useDesk((s) => s.armed);
  const paperOn = useDesk((s) => s.paperOn);
  const tl = useDesk((s) => s.tl);
  const brokerOn = useDesk((s) => s.brokerOn);
  const accountId = useDesk((s) => s.accountId);
  const journal = useDesk((s) => s.journal);
  const paperStart = useDesk((s) => s.paperStart);
  const challengeOn = useDesk((s) => s.challengeOn);
  const challengeAt = useDesk((s) => s.challengeAt);
  const indexLocked = challengeIndexLocked({
    accountId,
    journal,
    tl,
    paperStart,
    challengeOn,
    challengeAt,
  });
  const canTrade = !(indexLocked && isIndexSymbol(scenario.symbol));
  const replay = useDesk((s) => s.replay);
  const setupReady = replay == null || replay >= scenario.setup.retestIndex;

  if (!position) {
    const autoOn = armed && paperOn;
    const trendSide = withTrendSide(scenario.trend);
    const bull = scenario.trend === "bullish";
    const status = !canTrade
      ? `Flip $100: ${scenario.symbol} locked until the book is ${money((paperStart || 100) * 2, 0)}. Use FX, gold, or BTC.`
      : !armed
        ? "Disarmed. Auto-enter is paused."
        : !paperOn
          ? "Live execution is off — auto-enter idle."
          : !tl
            ? "Paper only. Connect Atlas (LIVE · ATLAS) and turn on Send to TradeLocker."
            : !brokerOn
              ? "Connected, but Send to TradeLocker is off — fills stay paper."
              : setupReady
                ? `Armed. Auto-enter ${trendSide.toUpperCase()} with the ${scenario.trend} trend${tl && brokerOn ? " → Atlas" : ""}.`
                : `Armed. ${scenario.trend.toUpperCase()} trend — waiting on the continuation retest.`;
    return (
      <section className="rounded-3xl bg-surface px-5 py-5 shadow-border">
        <p className="font-mono text-xs tracking-label text-faint uppercase">Open positions</p>
        <p
          className={cn(
            "mt-2 font-mono text-xs tracking-label uppercase",
            bull ? "text-primary" : "text-loss",
          )}
        >
          Overall trend · {scenario.trend} · {trendSide}
        </p>
        <p className="mt-2 text-sm text-muted">{status}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Button
              variant="buy"
              className={trendSide === "buy" ? undefined : "bg-surface-2 text-muted shadow-border"}
              disabled={!canTrade}
              onClick={() => takeTrade("buy", trendSide === "buy" ? "icc-retest" : "manual")}
            >
              Buy {scenario.symbol}
            </Button>
            <p className="text-center font-mono text-2xs tracking-label uppercase text-faint">
              {trendSide === "buy" ? "With trend" : "Counter"}
            </p>
          </div>
          <div className="grid gap-1">
            <Button
              variant="sell"
              className={trendSide === "sell" ? undefined : "bg-surface-2 text-muted shadow-border"}
              disabled={!canTrade}
              onClick={() => takeTrade("sell", trendSide === "sell" ? "icc-retest" : "manual")}
            >
              Sell {scenario.symbol}
            </Button>
            <p className="text-center font-mono text-2xs tracking-label uppercase text-faint">
              {trendSide === "sell" ? "With trend" : "Counter"}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-faint">
          {autoOn
            ? `Desk takes the ${trendSide.toUpperCase()} continuation retest with the ${scenario.trend} trend, then banks the target. Flatten anytime.`
            : "Arm the desk and turn on Live execution to auto-enter with the overall trend. Flatten is always manual."}
        </p>
        <div className="mt-4">
          <AutoCloseRow />
        </div>
      </section>
    );
  }

  const last = scenario.candles.at(-1)?.c ?? position.entry;
  const dir = position.side === "buy" ? 1 : -1;
  const rDist = Math.abs(position.entry - (position.initialSl ?? position.sl)) || 1;
  const floatR = (dir * (last - position.entry)) / rDist;
  const floatPnl = floatR * position.risk;
  const trailLabel =
    position.sl === position.entry
      ? "Trail · BE"
      : position.initialSl && position.sl !== position.initialSl
        ? "Trail locked"
        : null;

  return (
    <section className="rounded-3xl bg-surface px-5 py-5 shadow-border">
      <p className="font-mono text-xs tracking-label text-faint uppercase">Open positions</p>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold uppercase">
          {position.side} {position.symbol}{" "}
          <span className="font-normal text-faint">{position.kind}</span>
        </p>
        <p
          className={cn(
            "font-mono text-sm tabular-nums",
            floatPnl >= 0 ? "text-primary" : "text-loss",
          )}
        >
          {signedMoney(floatPnl)} · {signedR(floatR)}
        </p>
      </div>
      {trailLabel ? (
        <p className="mt-1 font-mono text-2xs tracking-label uppercase text-primary">{trailLabel}</p>
      ) : null}
      <div className="mt-4 grid grid-cols-4 gap-2">
        {BANK_TPS.map((tp) => (
          <Button key={tp} variant="muted" size="sm" onClick={() => closePosition(tp)}>
            {tp.toUpperCase()}
          </Button>
        ))}
      </div>
      <div className="mt-2">
        <Button variant="muted" className="w-full" size="sm" onClick={() => closePosition("market")}>
          Flatten
        </Button>
      </div>
      <div className="mt-4">
        <AutoCloseRow />
      </div>
    </section>
  );
}

function AutoCloseRow() {
  const autoClose = useDesk((s) => s.autoClose);
  const setAutoClose = useDesk((s) => s.setAutoClose);
  const trailOn = useDesk((s) => s.trailOn);
  const setTrailOn = useDesk((s) => s.setTrailOn);
  return (
    <div>
      <p className="font-mono text-2xs tracking-label text-faint uppercase">Auto-close</p>
      <div className="mt-2 grid grid-cols-5 gap-1">
        {AUTO_CLOSE.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setAutoClose(item)}
            className={cn(
              "h-11 rounded-full text-2xs font-medium tracking-wide uppercase",
              item === autoClose
                ? "bg-primary text-primary-fg"
                : "bg-surface-2 text-muted shadow-border",
            )}
          >
            {autoCloseLabel(item)}
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-fg">Trail SL</p>
          <p className="text-xs text-faint">After TP1, stop locks to BE, then each prior TP.</p>
        </div>
        <Switch checked={trailOn} onCheckedChange={setTrailOn} aria-label="Trail stop" />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-faint">
        {autoClose === "off"
          ? "SL still protects. Bank TP2, odds, or Flatten yourself."
          : autoClose === "odds"
            ? "Unattended: trail, then bank TP5 (odd). Flatten anytime."
            : `Unattended: trail BE then 2 TPs back, bank ${autoCloseLabel(autoClose)}. Flatten anytime.`}
      </p>
    </div>
  );
}

export function BacktestCard({ scenario }: { scenario: Scenario }) {
  const accountId = useDesk((s) => s.accountId);
  const riskPct = useDesk((s) => s.riskPct);
  const journal = useDesk((s) => s.journal);
  const tl = useDesk((s) => s.tl);
  const paperStart = useDesk((s) => s.paperStart);
  const challengeOn = useDesk((s) => s.challengeOn);
  const challengeAt = useDesk((s) => s.challengeAt);
  const starting = equityOf({
    accountId,
    journal,
    tl,
    paperStart,
    challengeOn,
    challengeAt,
  });
  const risk = starting * riskPct;
  const stats = backtestStats(scenario.historical, risk);
  const data = stats.curve.map((v, i) => ({ i, v }));

  return (
    <section className="rounded-3xl bg-surface px-5 py-5 shadow-border">
      <p className="font-mono text-xs tracking-label text-faint uppercase">Sample backtest</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Walk-forward on this chart. Dollar P&L uses your risk % and starting equity.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Stat label="P&L" value={signedMoney(stats.pnl, 0)} tone={stats.pnl >= 0 ? "up" : "down"} />
        <Stat label="Net" value={signedR(stats.netR)} tone={stats.netR >= 0 ? "up" : "down"} />
        <Stat label="Win rate" value={pct(stats.winRate)} tone="up" />
        <Stat label="Trades" value={`${stats.wins}W / ${stats.losses}L`} />
        <Stat label="Expectancy" value={signedR(stats.expectancy)} tone="up" />
        <Stat label="Max DD" value={signedMoney(stats.maxDd * risk, 0)} tone="down" />
      </div>
      <div className="mt-4 h-16">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <Line
              type="monotone"
              dataKey="v"
              stroke="var(--color-primary)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-faint">
        Gross {money(stats.grossWins, 0)} on {stats.wins} wins · −{money(stats.grossLoss, 0).slice(1)} on{" "}
        {stats.losses} losses. Sized at {money(risk, 0)} risk per trade.
      </p>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="rounded-2xl bg-surface-2 px-3 py-3 shadow-border">
      <p className="font-mono text-2xs tracking-label text-faint uppercase">{label}</p>
      <p
        className={cn(
          "mt-1 font-mono text-lg tabular-nums",
          tone === "up" && "text-primary",
          tone === "down" && "text-loss",
          !tone && "text-fg",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function JournalCard() {
  const accountId = useDesk((s) => s.accountId);
  const journal = useDesk((s) => s.journal);
  const openJournal = useDesk((s) => s.openJournal);
  const latest = journal.find((j) => j.accountId === accountId);

  return (
    <button
      type="button"
      onClick={() => openJournal(true)}
      className="w-full rounded-3xl bg-surface px-5 py-5 text-left shadow-border transition-[box-shadow] duration-150 hover:shadow-border-hover"
    >
      <p className="font-mono text-xs tracking-label text-faint uppercase">Journal</p>
      {latest ? (
        <div className="mt-3 flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold tracking-wide uppercase">
            {latest.side} {latest.symbol}{" "}
            <span className="font-normal text-faint">{latest.kind}</span>
          </p>
          <p
            className={cn(
              "font-mono text-sm tabular-nums",
              latest.pnl >= 0 ? "text-primary" : "text-loss",
            )}
          >
            {signedMoney(latest.pnl)}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">No fills on this desk yet.</p>
      )}
      <p className="mt-3 font-mono text-2xs tracking-label text-faint uppercase">
        Trophy · end of day catch photo
      </p>
    </button>
  );
}

export function AccountStrip() {
  const accountId = useDesk((s) => s.accountId);
  const setAccount = useDesk((s) => s.setAccount);
  const tradeAll = useDesk((s) => s.tradeAll);
  const setTradeAll = useDesk((s) => s.setTradeAll);
  const startFlip100 = useDesk((s) => s.startFlip100);
  const setPaperOn = useDesk((s) => s.setPaperOn);
  const setBrokerOn = useDesk((s) => s.setBrokerOn);
  const brokerOn = useDesk((s) => s.brokerOn);
  const symbol = useDesk((s) => s.symbol);
  const setSymbol = useDesk((s) => s.setSymbol);
  const tl = useDesk((s) => s.tl);
  const journal = useDesk((s) => s.journal);
  const paperStart = useDesk((s) => s.paperStart);
  const challengeOn = useDesk((s) => s.challengeOn);
  const challengeAt = useDesk((s) => s.challengeAt);
  const indexLocked = challengeIndexLocked({
    accountId,
    journal,
    tl,
    paperStart,
    challengeOn,
    challengeAt,
  });
  const desks = tl?.accounts.length
    ? tl.accounts.map((a) => ({
        id: a.id,
        label: a.name,
      }))
    : ACCOUNTS.map((a) => ({
        id: a.id,
        label: `${a.code} · ${a.sizeLabel}`,
      }));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex w-full min-w-0 gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => {
            startFlip100();
            setPaperOn(true);
            setBrokerOn(false);
          }}
          className={cn(
            "h-11 shrink-0 rounded-full px-4 text-xs font-medium tracking-wide uppercase transition-colors duration-150",
            challengeOn && !brokerOn
              ? "bg-primary text-primary-fg"
              : "bg-surface-2 text-muted shadow-border",
          )}
        >
          Paper $100 challenge
        </button>
        {tl && desks.length > 1 ? (
          <button
            type="button"
            onClick={() => setTradeAll(!tradeAll)}
            disabled={challengeOn}
            className={cn(
              "h-11 shrink-0 rounded-full px-4 text-xs font-medium tracking-wide uppercase transition-colors duration-150",
              challengeOn
                ? "cursor-not-allowed bg-surface-2 text-faint opacity-50"
                : tradeAll
                  ? "bg-primary text-primary-fg"
                  : "bg-surface-2 text-muted shadow-border",
            )}
          >
            {challengeOn ? "Copy off · $100" : `Copy ${desks.length} Atlas`}
          </button>
        ) : null}
        {desks.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAccount(a.id)}
            className={cn(
              "h-11 shrink-0 rounded-full px-4 text-xs font-medium tracking-wide uppercase transition-colors duration-150",
              !tradeAll && a.id === accountId
                ? "bg-primary text-primary-fg"
                : "bg-surface-2 text-muted shadow-border",
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
      <div className="flex w-full min-w-0 gap-2 overflow-x-auto pb-1">
        {SYMBOLS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSymbol(s)}
            className={cn(
              "h-11 shrink-0 rounded-full px-4 text-xs font-medium tracking-wide uppercase transition-colors duration-150",
              s === symbol
                ? "bg-surface-2 text-fg shadow-border"
                : indexLocked && isIndexSymbol(s)
                  ? "bg-transparent text-faint opacity-50"
                  : "bg-transparent text-faint",
            )}
          >
            {s}
            {indexLocked && isIndexSymbol(s) ? " · LOCK" : ""}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ScanCard() {
  const tf = useDesk((s) => s.tf);
  const tl = useDesk((s) => s.tl);
  const symbol = useDesk((s) => s.symbol);
  const setSymbol = useDesk((s) => s.setSymbol);
  const position = useDesk((s) => s.position);
  const accountId = useDesk((s) => s.accountId);
  const journal = useDesk((s) => s.journal);
  const paperStart = useDesk((s) => s.paperStart);
  const challengeOn = useDesk((s) => s.challengeOn);
  const challengeAt = useDesk((s) => s.challengeAt);
  const indexLocked = challengeIndexLocked({
    accountId,
    journal,
    tl,
    paperStart,
    challengeOn,
    challengeAt,
  });
  const [hits, setHits] = useState<ScanHit[]>(() => paperScan(5));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setHits(paperScan(tf));
    let dead = false;
    setBusy(true);
    void liveScan({ tf, tl }).then((rows) => {
      if (!dead) {
        setHits(rows);
        setBusy(false);
      }
    });
    return () => {
      dead = true;
    };
  }, [tf, tl?.accessToken]);

  return (
    <section
      id="distribution-scan"
      className="overflow-hidden rounded-3xl bg-surface px-4 py-4 shadow-border"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-xs tracking-label text-faint uppercase">Distribution scan</p>
        <p className="font-mono text-2xs text-faint">
          {busy ? "Scanning…" : `${hits.filter((h) => h.rank >= 2).length} setups`}
        </p>
      </div>
      <ul className="mt-3 divide-y divide-border">
        {[...hits]
          .sort((a, b) => {
            const ao = position?.symbol === a.symbol ? 1 : 0;
            const bo = position?.symbol === b.symbol ? 1 : 0;
            if (ao !== bo) return bo - ao;
            return b.rank - a.rank;
          })
          .map((h) => {
            const open = Boolean(position && position.symbol === h.symbol);
            const shownSide = open && position ? position.side : h.side;
            return (
              <li key={h.symbol}>
                <button
                  type="button"
                  onClick={() => setSymbol(h.symbol)}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-2 py-2.5 text-left",
                    h.symbol === symbol && "rounded-xl bg-surface-2 px-2",
                  )}
                >
                  <span className="w-20 shrink-0 font-mono text-xs uppercase text-fg">
                    {h.symbol}
                  </span>
                  <span
                    className={cn(
                      "w-14 shrink-0 font-mono text-2xs tracking-label uppercase",
                      shownSide === "buy" ? "text-primary" : "text-loss",
                    )}
                  >
                    {shownSide}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate font-mono text-2xs tracking-label uppercase",
                      open || h.rank >= 3 ? "text-primary" : "text-faint",
                    )}
                  >
                    {open
                      ? `OPEN ${shownSide}`
                      : indexLocked && isIndexSymbol(h.symbol)
                        ? "LOCKED"
                        : h.tag}
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                    {price(h.last, h.digits)}
                  </span>
                </button>
              </li>
            );
          })}
      </ul>
      <p className="mt-2 text-xs leading-relaxed text-faint">
        Tap Scan in the header to load the distribution pair on the chart.
      </p>
    </section>
  );
}
