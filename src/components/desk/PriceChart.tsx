import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { heikinAshi, TIMEFRAMES, tfLabel } from "@/lib/desk/scenarios";
import { price } from "@/lib/desk/format";
import { marketStatus } from "@/lib/desk/market";
import { useDesk } from "@/lib/desk/store";
import type { Candle, Phase, PhaseKind, Position, Scenario, Setup } from "@/lib/desk/types";
import { cn } from "@/lib/utils";

const C = {
  bg: "#0b0b0d",
  grid: "rgba(255,255,255,0.045)",
  axis: "#8b8b93",
  up: "#5dcaa5",
  down: "#e07a72",
  accum: "rgba(75,143,212,0.22)",
  accumStroke: "rgba(75,143,212,0.7)",
  manip: "rgba(196,92,92,0.22)",
  manipStroke: "rgba(196,92,92,0.7)",
  dist: "rgba(61,154,122,0.18)",
  distStroke: "rgba(61,154,122,0.65)",
  indicate: "rgba(139,58,58,0.28)",
  correct: "rgba(138,122,58,0.28)",
  cont: "rgba(61,154,122,0.28)",
  entry: "#5dcaa5",
  sl: "#e07a72",
  tp: "#5dcaa5",
  fvg: "rgba(93,202,165,0.12)",
  ob: "rgba(212,168,75,0.16)",
  obStroke: "rgba(212,168,75,0.8)",
  text: "#f0f0f2",
  muted: "#8b8b93",
};

const PHASE_FILL: Record<PhaseKind, string> = {
  accumulation: C.accum,
  manipulation: C.manip,
  indication: C.indicate,
  correction: C.correct,
  continuation: C.cont,
  distribution: C.dist,
};

const PHASE_LABEL: Record<PhaseKind, string> = {
  accumulation: "Accumulation",
  manipulation: "Manipulation",
  indication: "Indication",
  correction: "Correction",
  continuation: "Continuation",
  distribution: "Distribution",
};

function axisPad(scenario: Scenario, sample: number) {
  const label = price(sample, scenario.digits);
  return Math.max(56, Math.round(label.length * 6.6 + 16));
}

function usePrefersReduced() {
  const [v, setV] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setV(mq.matches);
    const fn = () => setV(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return v;
}

export function PriceChart({
  scenario,
  style,
  replay,
  onReplay,
  position,
}: {
  scenario: Scenario;
  style: "candles" | "heikin";
  replay: number | null;
  onReplay: (n: number | null) => void;
  position: Position | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const reduced = usePrefersReduced();
  const tf = useDesk((s) => s.tf);
  const setTf = useDesk((s) => s.setTf);
  const liveOn = useDesk((s) => s.liveScenario?.symbol === scenario.symbol);
  const liveErr = useDesk((s) => s.liveError);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const status = marketStatus(scenario.symbol, now);
  const playRef = useRef(false);

  const source = useMemo(
    () => (style === "heikin" ? heikinAshi(scenario.candles) : scenario.candles),
    [scenario.candles, scenario.candles.at(-1)?.c, style],
  );
  const visible = replay == null ? source.length : Math.max(2, Math.min(replay, source.length));
  const candles = source.slice(0, visible);

  useEffect(() => {
    if (!playing) {
      playRef.current = false;
      return;
    }
    playRef.current = true;
    if (reduced) {
      onReplay(null);
      setPlaying(false);
      return;
    }
    let frame = Math.max(2, Math.round(source.length * 0.12));
    onReplay(frame);
    let raf = 0;
    let lastTs = 0;
    const tick = (t: number) => {
      if (!playRef.current) return;
      if (t - lastTs > 48) {
        frame += 1;
        lastTs = t;
        if (frame >= source.length) {
          onReplay(null);
          setPlaying(false);
          playRef.current = false;
          return;
        }
        onReplay(frame);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      playRef.current = false;
      cancelAnimationFrame(raf);
    };
  }, [playing, reduced, source.length, onReplay]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(ctx, w, h, candles, scenario, hover, position);
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [candles, scenario, hover, position]);

  const last = candles.at(-1);
  const setupReady = visible > scenario.setup.retestIndex;

  return (
    <section className="overflow-hidden rounded-3xl bg-surface shadow-border">
      <div className="flex flex-col gap-3 px-4 pt-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs tracking-label text-faint uppercase">
              {scenario.symbol} · {tfLabel(tf)} · {style === "heikin" ? "Heikin Ashi" : "Candles"}
              {liveOn ? " · LIVE" : liveErr ? " · FEED" : " · LOADING"}
            </p>
            <p className="mt-0.5 font-mono text-lg tabular-nums text-fg">
              {last ? price(last.c, scenario.digits) : "—"}
            </p>
            <p
              className={cn(
                "mt-1 font-mono text-2xs tracking-label uppercase",
                scenario.trend === "bullish" ? "text-primary" : "text-loss",
              )}
            >
              Overall trend · {scenario.trend} · {scenario.trend === "bullish" ? "buy" : "sell"}
            </p>
          </div>
          <div className="min-w-0 text-right">
            <p
              className={cn(
                "font-mono text-xs tracking-label uppercase",
                status.open ? "text-primary" : "text-loss",
              )}
            >
              <span className="mr-1.5 inline-block size-1.5 rounded-full bg-current align-middle" />
              {status.label}
            </p>
            <p className="mt-0.5 font-mono text-2xs tracking-label text-faint uppercase">
              {status.session}
            </p>
            <p className="mt-0.5 text-2xs leading-snug text-muted">{status.detail}</p>
            <p className="mt-0.5 font-mono text-2xs text-faint">{status.clock}</p>
          </div>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 gap-1 overflow-x-auto">
            {TIMEFRAMES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setPlaying(false);
                  setTf(item);
                }}
                className={cn(
                  "h-11 shrink-0 rounded-full px-4 text-xs font-medium tracking-wide uppercase",
                  item === tf
                    ? "bg-surface-2 text-fg shadow-border"
                    : "bg-transparent text-faint",
                )}
              >
                {tfLabel(item)}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="muted"
            size="icon"
            className="size-10"
            aria-label={playing ? "Pause replay" : "Replay cycle"}
            onClick={() => {
              if (playing) {
                setPlaying(false);
                return;
              }
              onReplay(Math.max(2, Math.round(source.length * 0.12)));
              setPlaying(true);
            }}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
          <Button
            variant="muted"
            size="icon"
            className="size-10"
            aria-label="Show full cycle"
            onClick={() => {
              setPlaying(false);
              onReplay(null);
            }}
          >
            <RotateCcw className="size-4" />
          </Button>
          </div>
        </div>
      </div>
      <div
        ref={wrapRef}
        className="relative mt-1 h-64 w-full md:h-96"
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const padL = 8;
          const padR = axisPad(scenario, candles[candles.length - 1]?.c ?? 0);
          const plotW = rect.width - padL - padR;
          const i = Math.round(((x - padL) / plotW) * (candles.length - 1));
          setHover(Math.max(0, Math.min(candles.length - 1, i)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-3 pt-1 text-2xs tracking-widest uppercase">
        <span
          className={cn(
            "font-semibold tracking-wide",
            scenario.trend === "bullish" ? "text-primary" : "text-loss",
          )}
        >
          {scenario.trend === "bullish" ? "Bullish · buy with trend" : "Bearish · sell with trend"}
        </span>
        <span className="text-accum">Accum</span>
        <span className="text-loss">Manip</span>
        <span className="text-primary">Dist</span>
        <span className="text-loss">Indic</span>
        <span className="text-[#c8b45a]">Corr</span>
        <span className="text-primary">Cont</span>
        <span className={cn(setupReady ? "text-primary" : "text-faint")}>
          {setupReady ? "Retest in — continuation is the trade" : "Waiting on retest"}
        </span>
      </div>
    </section>
  );
}

function paint(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  candles: Candle[],
  scenario: Scenario,
  hover: number | null,
  position: Position | null,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  if (candles.length < 2) return;

  const padL = 8;
  const padR = axisPad(scenario, candles[candles.length - 1]?.c ?? 0);
  const padT = 12;
  const padB = 22;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    lo = Math.min(lo, c.l);
    hi = Math.max(hi, c.h);
  }
  const setup = scenario.setup;
  lo = Math.min(lo, setup.sl, ...setup.tps);
  hi = Math.max(hi, setup.sl, ...setup.tps);
  const pad = (hi - lo) * 0.06 || 1;
  lo -= pad;
  hi += pad;
  const n = candles.length;
  const x = (i: number) => padL + ((i + 0.5) / n) * plotW;
  const y = (p: number) => padT + ((hi - p) / (hi - lo)) * plotH;
  const cw = Math.max(2, (plotW / n) * 0.62);

  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  for (let g = 0; g < 5; g++) {
    const gy = padT + (plotH / 4) * g;
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(w - padR, gy);
    ctx.stroke();
  }

  drawPhases(ctx, scenario.phases, x, y, cw, n);
  drawIcc(ctx, scenario.phases, x, y, cw, n);
  drawFvg(ctx, setup, x, y, n);
  drawOb(ctx, setup, x, y, n);

  if (n > setup.retestIndex) {
    drawTradePlan(ctx, setup, x, y, padL, w - padR, n);
  }

  if (position) {
    dash(ctx, y(position.entry), padL, w - padR, C.entry);
    dash(ctx, y(position.sl), padL, w - padR, C.sl);
  }

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const up = c.c >= c.o;
    ctx.strokeStyle = up ? C.up : C.down;
    ctx.fillStyle = up ? C.up : C.down;
    const cx = x(i);
    ctx.beginPath();
    ctx.moveTo(cx, y(c.h));
    ctx.lineTo(cx, y(c.l));
    ctx.stroke();
    const top = y(Math.max(c.o, c.c));
    const bot = y(Math.min(c.o, c.c));
    ctx.fillRect(cx - cw / 2, top, cw, Math.max(1, bot - top));
  }

  // last price tag
  const last = candles[n - 1];
  const ly = y(last.c);
  ctx.fillStyle = last.c >= last.o ? C.up : C.down;
  roundRect(ctx, w - padR + 4, ly - 9, padR - 8, 18, 4);
  ctx.fill();
  ctx.font = "500 10px 'IBM Plex Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = last.c >= last.o ? "#06281c" : "#1a0808";
  ctx.fillText(price(last.c, scenario.digits), w - padR / 2 + 2, ly);

  ctx.fillStyle = C.axis;
  ctx.font = "500 10px 'IBM Plex Mono', monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let g = 0; g < 5; g++) {
    const p = hi - ((hi - lo) / 4) * g;
    const gy = padT + (plotH / 4) * g;
    if (g === 4 || Math.abs(gy - ly) > 16) {
      ctx.fillText(price(p, scenario.digits), w - 6, gy);
    }
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const times = [0, Math.floor(n / 2), n - 1];
  for (const i of times) {
    ctx.fillText(hhmm(candles[i].t), x(i) - 12, h - 6);
  }

  drawPhaseLabels(ctx, scenario.phases, x, y, n);
  drawTrend(ctx, scenario, padL, padT);

  if (hover != null && candles[hover]) {
    const c = candles[hover];
    ctx.strokeStyle = "rgba(240,240,242,0.25)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x(hover), padT);
    ctx.lineTo(x(hover), padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    const boxW = 148;
    const bx = Math.min(x(hover) + 10, w - padR - boxW - 4);
    const by = padT + 6;
    ctx.fillStyle = "rgba(20,20,22,0.92)";
    roundRect(ctx, bx, by, boxW, 58, 8);
    ctx.fill();
    ctx.fillStyle = C.text;
    ctx.font = "500 11px 'IBM Plex Mono', monospace";
    ctx.fillText(`${scenario.symbol}  ${hhmm(c.t)}`, bx + 10, by + 16);
    ctx.fillStyle = C.muted;
    ctx.font = "400 10px 'IBM Plex Mono', monospace";
    ctx.fillText(
      `O ${price(c.o, scenario.digits)}  C ${price(c.c, scenario.digits)}`,
      bx + 10,
      by + 34,
    );
    ctx.fillText(
      `H ${price(c.h, scenario.digits)}  L ${price(c.l, scenario.digits)}`,
      bx + 10,
      by + 48,
    );
  }
}

function drawPhases(
  ctx: CanvasRenderingContext2D,
  phases: Phase[],
  x: (i: number) => number,
  y: (p: number) => number,
  cw: number,
  n: number,
) {
  const order: PhaseKind[] = ["accumulation", "manipulation", "distribution"];
  for (const kind of order) {
    const p = phases.find((ph) => ph.kind === kind);
    if (!p || p.start >= n) continue;
    const x0 = x(p.start) - cw / 2;
    const x1 = x(Math.min(p.end, n - 1)) + cw / 2;
    const y0 = y(p.high);
    const y1 = y(p.low);
    ctx.fillStyle = PHASE_FILL[p.kind];
    ctx.fillRect(x0, y0, Math.max(4, x1 - x0), Math.max(4, y1 - y0));
  }
}

function drawTrend(
  ctx: CanvasRenderingContext2D,
  scenario: Scenario,
  padL: number,
  padT: number,
) {
  const bull = scenario.trend === "bullish";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = "700 12px Figtree, sans-serif";
  ctx.fillStyle = bull ? C.up : C.down;
  ctx.fillText(bull ? "BULLISH" : "BEARISH", padL + 8, padT + 14);
  ctx.font = "500 9px 'IBM Plex Mono', monospace";
  ctx.fillStyle = C.muted;
  ctx.fillText("OVERALL TREND", padL + 8, padT + 28);
}

function drawIcc(
  ctx: CanvasRenderingContext2D,
  phases: Phase[],
  x: (i: number) => number,
  y: (p: number) => number,
  cw: number,
  n: number,
) {
  const kinds: PhaseKind[] = ["indication", "correction", "continuation"];
  for (const kind of kinds) {
    const p = phases.find((ph) => ph.kind === kind);
    if (!p || p.start >= n) continue;
    const x0 = x(p.start) - cw / 2;
    const x1 = x(Math.min(p.end, n - 1)) + cw / 2;
    const y0 = y(p.high);
    const y1 = y(p.low);
    ctx.fillStyle = PHASE_FILL[p.kind];
    ctx.fillRect(x0, y0, Math.max(4, x1 - x0), Math.max(4, y1 - y0));
    ctx.fillStyle = PHASE_FILL[p.kind].replace("0.28", "0.85").replace("0.22", "0.85");
    ctx.fillRect(x0, y1 - 3, Math.max(4, x1 - x0), 4);
  }
}

function drawOb(
  ctx: CanvasRenderingContext2D,
  setup: Setup,
  x: (i: number) => number,
  y: (p: number) => number,
  n: number,
) {
  if (setup.ob.index >= n) return;
  const x0 = x(setup.ob.index) - 6;
  const top = y(setup.ob.high);
  const h = y(setup.ob.low) - top;
  ctx.fillStyle = C.ob;
  ctx.fillRect(x0, top, 18, h);
  ctx.strokeStyle = C.obStroke;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0, top, 18, h);
  ctx.fillStyle = C.obStroke;
  ctx.font = "600 9px Figtree, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("OB", x0, top - 4);
}

function drawFvg(
  ctx: CanvasRenderingContext2D,
  setup: Setup,
  x: (i: number) => number,
  y: (p: number) => number,
  n: number,
) {
  if (setup.fvg.index >= n) return;
  const x0 = x(setup.fvg.index) - 4;
  const h = y(setup.fvg.low) - y(setup.fvg.high);
  ctx.fillStyle = C.fvg;
  ctx.fillRect(x0, y(setup.fvg.high), 22, h);
  ctx.fillStyle = C.up;
  ctx.font = "600 9px Figtree, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("FVG", x0, y(setup.fvg.high) - 4);
}

function drawTradePlan(
  ctx: CanvasRenderingContext2D,
  setup: Setup,
  x: (i: number) => number,
  y: (p: number) => number,
  left: number,
  right: number,
  n: number,
) {
  dash(ctx, y(setup.entry), left, right, C.entry);
  dash(ctx, y(setup.sl), left, right, C.sl);

  const colL = Math.max(x(Math.min(setup.retestIndex, n - 1)), right - 86);
  setup.tps.forEach((tp, i) => {
    const y0 = y(tp);
    const y1 = i === 0 ? y(setup.entry) : y(setup.tps[i - 1]);
    const top = Math.min(y0, y1);
    ctx.fillStyle = i % 2 === 0 ? "rgba(93,202,165,0.14)" : "rgba(93,202,165,0.07)";
    ctx.fillRect(colL, top, right - colL, Math.abs(y1 - y0));
    ctx.fillStyle = C.muted;
    ctx.font = "500 9px 'IBM Plex Mono', monospace";
    ctx.textAlign = "right";
    ctx.fillText(`TP${i + 1}`, right - 4, (y0 + y1) / 2 + 3);
  });
  ctx.textAlign = "left";
}

function drawPhaseLabels(
  ctx: CanvasRenderingContext2D,
  phases: Phase[],
  x: (i: number) => number,
  y: (p: number) => number,
  n: number,
) {
  ctx.font = "600 12px Figtree, sans-serif";
  ctx.textAlign = "left";
  const wanted: PhaseKind[] = [
    "accumulation",
    "manipulation",
    "indication",
    "correction",
    "continuation",
    "distribution",
  ];
  for (const kind of wanted) {
    const p = phases.find((ph) => ph.kind === kind);
    if (!p || p.start >= n) continue;
    const lx = x(p.start) + 6;
    const icc = kind === "indication" || kind === "correction" || kind === "continuation";
    const ly = icc ? y(p.low) + 14 : kind === "manipulation" ? y(p.low) + 14 : y(p.high) - 8;
    ctx.font = icc ? "600 10px Figtree, sans-serif" : "600 12px Figtree, sans-serif";
    ctx.fillStyle = icc ? "rgba(240,240,242,0.75)" : "rgba(240,240,242,0.9)";
    ctx.fillText(PHASE_LABEL[kind], lx, ly);
  }
  const manip = phases.find((ph) => ph.kind === "manipulation");
  if (manip && manip.start < n) {
    ctx.font = "700 10px Figtree, sans-serif";
    ctx.fillStyle = C.down;
    ctx.fillText("MSS", x(manip.start) + 6, y(manip.high) - 8);
  }
}

function dash(
  ctx: CanvasRenderingContext2D,
  y: number,
  x0: number,
  x1: number,
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hhmm(t: number) {
  const d = new Date(t);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
