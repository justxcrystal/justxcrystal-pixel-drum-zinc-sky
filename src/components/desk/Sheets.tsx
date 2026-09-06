import { useState } from "react";
import type { ReactNode } from "react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ACCOUNTS } from "@/lib/desk/accounts";
import { getScenario, SYMBOLS, TIMEFRAMES, tfLabel } from "@/lib/desk/scenarios";
import { downloadBlob, loadMockupScene, saveMockupScene } from "@/lib/desk/download";
import { money, pct, signedMoney, signedR } from "@/lib/desk/format";
import { equityOf, useDesk } from "@/lib/desk/store";
import {
  renderTradePost,
  renderTrophyPng,
  tradeCaption,
  trophyCaption,
  trophyDay,
  trophyTweetUrl,
  type MockupScene,
} from "@/lib/desk/trophy";
import type { JournalEntry } from "@/lib/desk/types";
import { AUTO_CLOSE, autoCloseLabel } from "@/lib/desk/types";
import { cn } from "@/lib/utils";

export function DeskDrawers() {
  const settingsOpen = useDesk((s) => s.settingsOpen);
  const playbookOpen = useDesk((s) => s.playbookOpen);
  const journalOpen = useDesk((s) => s.journalOpen);
  const openSettings = useDesk((s) => s.openSettings);
  const openPlaybook = useDesk((s) => s.openPlaybook);
  const openJournal = useDesk((s) => s.openJournal);

  return (
    <>
      <Drawer open={settingsOpen} onOpenChange={openSettings}>
        <DrawerContent title="Desk settings">
          <SettingsBody />
        </DrawerContent>
      </Drawer>
      <Drawer open={playbookOpen} onOpenChange={openPlaybook}>
        <DrawerContent title="ICC / AMD playbook">
          <PlaybookBody />
        </DrawerContent>
      </Drawer>
      <Drawer open={journalOpen} onOpenChange={openJournal}>
        <DrawerContent title="Trade journal">
          <JournalBody />
        </DrawerContent>
      </Drawer>
    </>
  );
}

function SettingsBody() {
  const accountId = useDesk((s) => s.accountId);
  const setAccount = useDesk((s) => s.setAccount);
  const symbol = useDesk((s) => s.symbol);
  const setSymbol = useDesk((s) => s.setSymbol);
  const riskPct = useDesk((s) => s.riskPct);
  const setRisk = useDesk((s) => s.setRisk);
  const candleStyle = useDesk((s) => s.candleStyle);
  const setCandleStyle = useDesk((s) => s.setCandleStyle);
  const tf = useDesk((s) => s.tf);
  const setTf = useDesk((s) => s.setTf);
  const paperOn = useDesk((s) => s.paperOn);
  const setPaperOn = useDesk((s) => s.setPaperOn);
  const autoClose = useDesk((s) => s.autoClose);
  const setAutoClose = useDesk((s) => s.setAutoClose);
  const trailOn = useDesk((s) => s.trailOn);
  const setTrailOn = useDesk((s) => s.setTrailOn);
  const resetDemo = useDesk((s) => s.resetDemo);
  const journal = useDesk((s) => s.journal);
  const tl = useDesk((s) => s.tl);
  const openLogin = useDesk((s) => s.openLogin);
  const disconnectTl = useDesk((s) => s.disconnectTl);
  const equity = equityOf({ accountId, journal, tl });
  const desks = tl?.accounts.length
    ? tl.accounts.map((a) => ({
        id: a.id,
        label: a.name,
        value: money(a.equity || a.balance, 0),
      }))
    : ACCOUNTS.map((a) => ({
        id: a.id,
        label: `${a.code} · ${a.sizeLabel}`,
        value: money(a.starting, 0),
      }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Desk settings</h2>
        <p className="mt-1 text-sm text-muted">
          {tl
            ? `Signed into TradeLocker ${tl.env} as ${tl.email}.`
            : "Paper desks until you sign into TradeLocker with email, password, and server."}
        </p>
      </div>
      {tl ? (
        <Button variant="muted" className="w-full" onClick={disconnectTl}>
          Disconnect TradeLocker
        </Button>
      ) : (
        <Button className="w-full" onClick={() => openLogin(true)}>
          TradeLocker login
        </Button>
      )}
      <Field label="Account">
        <div className="grid gap-2">
          {desks.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAccount(a.id)}
              className={cn(
                "flex h-12 items-center justify-between rounded-2xl px-4 text-sm shadow-border",
                a.id === accountId ? "bg-primary text-primary-fg" : "bg-surface-2 text-fg",
              )}
            >
              <span className="font-medium tracking-wide uppercase">{a.label}</span>
              <span className="font-mono text-xs">{a.value}</span>
            </button>
          ))}
        </div>
      </Field>
      <Field label="Chart">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SYMBOLS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSymbol(s)}
              className={cn(
                "h-11 rounded-full text-xs font-medium tracking-wide uppercase",
                s === symbol ? "bg-primary text-primary-fg" : "bg-surface-2 text-muted shadow-border",
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {TIMEFRAMES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTf(item)}
              className={cn(
                "h-11 rounded-full text-xs font-medium tracking-wide uppercase",
                item === tf ? "bg-primary text-primary-fg" : "bg-surface-2 text-muted shadow-border",
              )}
            >
              {tfLabel(item)}
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(["candles", "heikin"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCandleStyle(c)}
              className={cn(
                "h-11 rounded-full text-xs font-medium uppercase",
                c === candleStyle
                  ? "bg-primary text-primary-fg"
                  : "bg-surface-2 text-muted shadow-border",
              )}
            >
              {c === "heikin" ? "Heikin Ashi" : "Candles"}
            </button>
          ))}
        </div>
      </Field>
      <Field label={`Risk ${pct(riskPct)} · ${money(equity * riskPct, 0)} / trade`}>
        <Slider
          min={0.25}
          max={2}
          step={0.25}
          value={[riskPct * 100]}
          onValueChange={([v]) => setRisk((v ?? 1) / 100)}
          aria-label="Risk percent"
        />
      </Field>
      <div className="flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-3 shadow-border">
        <div>
          <p className="text-sm font-medium">Live execution</p>
          <p className="text-xs text-faint">
            {tl
              ? "Reads your TradeLocker accounts. Continuation fills stay on this desk."
              : "Armed + on = auto-enter the distribution retest"}
          </p>
        </div>
        <Switch checked={paperOn} onCheckedChange={setPaperOn} />
      </div>
      <Field label="Auto-close">
        <div className="grid grid-cols-5 gap-2">
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
        <div className="mt-3 flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-3 shadow-border">
          <div>
            <p className="text-sm font-medium">Trail SL</p>
            <p className="text-xs text-faint">Locks to BE after TP1, then each prior TP.</p>
          </div>
          <Switch checked={trailOn} onCheckedChange={setTrailOn} />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-faint">
          Odds banks TP5. TP2 is the even take. TP6 is the runner. Flatten anytime.
        </p>
      </Field>
      <Button variant="muted" className="w-full" onClick={resetDemo}>
        Reset demo desk
      </Button>
    </div>
  );
}

function PlaybookBody() {
  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-xs tracking-label text-faint uppercase">Meridian</p>
        <h2 className="mt-1 text-xl font-semibold">ICC on the AMD cycle</h2>
      </div>
      <p className="text-sm leading-relaxed text-muted">
        Trade buy and sell with the overall trend. Continuation only, inside
        distribution, usually right after the retest.
      </p>
      <Block title="AMD — market cycle">
        <Row k="Accumulation" v="Range. Uninformed is trapped. Wait." />
        <Row k="Manipulation" v="Liquidity raid. Stops swept. Do not chase." />
        <Row k="Distribution" v="Real intent. The move lives here." />
      </Block>
      <Block title="Overall trend">
        <Row k="Bullish" v="Distribution expanding up. Buy the continuation retest." />
        <Row k="Bearish" v="Distribution expanding down. Sell the continuation retest." />
        <Row k="Counter" v="Allowed as manual. Auto-enter stays with trend." />
      </Block>
      <Block title="ICC — the trigger">
        <Row k="Indication" v="Displacement that prints direction." />
        <Row k="Correction" v="Pullback into FVG / order block." />
        <Row k="Continuation" v="The trade. Enter on the retest." />
      </Block>
      <Block title="Execution">
        <p className="text-sm leading-relaxed text-muted">
          Bias comes from the overall trend. Longs after a bullish raid and displacement.
          Shorts after a bearish raid. Stop beyond the manipulation extreme. Auto-enter is
          with-trend only. Scale TP1–TP6. Odds are 1 / 3 / 5 (bank TP5). After TP1 the stop
          trails to break-even, then each prior TP. Flatten anytime.
        </p>
      </Block>
    </div>
  );
}

function JournalBody() {
  const accountId = useDesk((s) => s.accountId);
  const journal = useDesk((s) => s.journal);
  const rows = journal.filter((j) => j.accountId === accountId);
  const day = trophyDay(journal);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [scene, setScene] = useState<MockupScene>(() => loadMockupScene());
  const [lastCaption, setLastCaption] = useState<string | null>(null);
  const liveScenario = useDesk((s) => s.liveScenario);

  function candlesFor(trade: JournalEntry) {
    if (liveScenario && liveScenario.symbol === trade.symbol) return liveScenario.candles;
    return getScenario(trade.symbol).candles;
  }

  async function savePhoto() {
    setBusy(true);
    setNote(null);
    try {
      const blob = await renderTrophyPng(journal);
      downloadBlob(blob, `meridian-trophy-${day.stamp.toISOString().slice(0, 10)}.png`);
      setNote("Trophy photo downloaded.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not save photo.");
    } finally {
      setBusy(false);
    }
  }

  async function copyCaption() {
    const caption = trophyCaption(journal);
    try {
      await navigator.clipboard.writeText(caption);
      setNote("Caption copied. Paste it under the photo on X.");
    } catch {
      setNote(caption);
    }
  }

  function shareX() {
    window.open(trophyTweetUrl(trophyCaption(journal)), "_blank", "noopener,noreferrer");
  }

  async function postTrade(trade: JournalEntry) {
    setBusy(true);
    setNote(null);
    try {
      const blob = await renderTradePost({
        trade,
        candles: candlesFor(trade),
        scene,
      });
      downloadBlob(blob, `justxcrystal-${trade.symbol}-${trade.side}.jpg`);
      const caption = tradeCaption(trade);
      try {
        await navigator.clipboard.writeText(caption);
      } catch {
        /* still saved */
      }
      setLastCaption(caption);
      setNote("Photo downloaded.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not build trade post.");
    } finally {
      setBusy(false);
    }
  }

  const latest = [...rows].sort((a, b) => b.at - a.at)[0];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Journal</h2>
      <div className="rounded-2xl bg-surface-2 px-4 py-4 shadow-border">
        <p className="font-mono text-2xs tracking-label text-faint uppercase">End of day trophy</p>
        <p
          className={`mt-2 font-mono text-2xl tabular-nums ${day.pnl >= 0 ? "text-primary" : "text-loss"}`}
        >
          {signedMoney(day.pnl)} · {signedR(day.r)}
        </p>
        <p className="mt-1 text-sm text-muted">
          {day.wins}W / {day.losses}L · {day.rows.length} fills
          {day.isToday ? " today" : " · latest session"}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Complete breakdown photo — like the catch of the day. Save it, then post on X yourself.
        </p>
        <div className="mt-4 grid gap-2">
          <Button size="lg" disabled={busy || !day.rows.length} onClick={() => void savePhoto()}>
            {busy ? "Printing the catch…" : "Save trophy photo"}
          </Button>
          <Button variant="muted" disabled={!day.rows.length} onClick={() => void copyCaption()}>
            Copy breakdown caption
          </Button>
          <Button variant="ghost" disabled={!day.rows.length} onClick={shareX}>
            Open X compose
          </Button>
        </div>
        {note ? <p className="mt-3 text-sm leading-relaxed text-muted">{note}</p> : null}
      </div>
      <div className="rounded-2xl bg-surface-2 px-4 py-4 shadow-border">
        <p className="font-mono text-2xs tracking-label text-faint uppercase">Post my trade</p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Your chart on the pool laptop. JUSTXCRYSTAL. Save the photo, caption is copied, X compose opens.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setScene("pool");
              saveMockupScene("pool");
            }}
            className={cn(
              "overflow-hidden rounded-2xl shadow-border",
              scene === "pool" && "ring-2 ring-primary",
            )}
          >
            <img src="/mockup-pool.jpg" alt="" className="aspect-square w-full object-cover" />
            <p className="px-2 py-1.5 text-center font-mono text-2xs uppercase text-faint">Pool</p>
          </button>
          <button
            type="button"
            onClick={() => {
              setScene("riad");
              saveMockupScene("riad");
            }}
            className={cn(
              "overflow-hidden rounded-2xl shadow-border",
              scene === "riad" && "ring-2 ring-primary",
            )}
          >
            <img src="/mockup-riad.jpg" alt="" className="aspect-square w-full object-cover" />
            <p className="px-2 py-1.5 text-center font-mono text-2xs uppercase text-faint">Riad</p>
          </button>
        </div>
        <Button
          size="lg"
          className="mt-3 w-full"
          disabled={busy || !latest}
          onClick={() => latest && void postTrade(latest)}
        >
          {busy ? "Compositing…" : "Post my trade"}
        </Button>
        <Button
          variant="muted"
          className="mt-2 w-full"
          disabled={!lastCaption && !latest}
          onClick={() =>
            window.open(
              trophyTweetUrl(lastCaption ?? (latest ? tradeCaption(latest) : "")),
              "_blank",
              "noopener,noreferrer",
            )
          }
        >
          Open X compose
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No fills on this paper desk yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((j) => (
            <li
              key={j.id}
              className="flex items-baseline justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3 shadow-border"
            >
              <div>
                <p className="text-sm font-semibold uppercase">
                  {j.side} {j.symbol}{" "}
                  <span className="font-normal text-faint">{j.kind}</span>
                </p>
                <p className="mt-0.5 text-xs text-faint">
                  {new Date(j.at).toLocaleString()} · {j.note ?? "desk fill"}
                </p>
              </div>
              <div className="text-right">
                <p
                  className={cn(
                    "font-mono text-sm tabular-nums",
                    j.pnl >= 0 ? "text-primary" : "text-loss",
                  )}
                >
                  {signedMoney(j.pnl)}
                </p>
                <p className="font-mono text-xs text-faint">{signedR(j.r)}</p>
                <button
                  type="button"
                  className="mt-1 font-mono text-2xs tracking-label text-muted uppercase"
                  onClick={() => void postTrade(j)}
                >
                  Post
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 font-mono text-2xs tracking-label text-faint uppercase">{label}</p>
      {children}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-4 py-4 shadow-border">
      <p className="font-mono text-xs tracking-label text-faint uppercase">{title}</p>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <p className="text-sm leading-relaxed">
      <span className="font-semibold text-fg">{k}. </span>
      <span className="text-muted">{v}</span>
    </p>
  );
}
