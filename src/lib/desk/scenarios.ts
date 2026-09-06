import type { Candle, HistoricalTrade, Phase, Scenario, Setup, Side, SymbolId, Timeframe, Trend } from "./types";

const END = Date.UTC(2026, 7, 28, 14, 45, 0);

function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildPath(
  intervalMs: number,
  startPrice: number,
  segs: { n: number; target: number; vol: number }[],
  rand: () => number,
): Candle[] {
  const total = segs.reduce((n, s) => n + s.n, 0);
  let t = END - total * intervalMs;
  let price = startPrice;
  const out: Candle[] = [];
  for (const seg of segs) {
    for (let i = 0; i < seg.n; i++) {
      const remaining = seg.n - i;
      const drift = (seg.target - price) / remaining;
      const noise = (rand() - 0.46) * seg.vol;
      const o = price;
      const c = o + drift + noise;
      const h = Math.max(o, c) + rand() * seg.vol * 0.45;
      const l = Math.min(o, c) - rand() * seg.vol * 0.45;
      out.push({ t, o, h, l, c });
      price = c;
      t += intervalMs;
    }
  }
  return out;
}

function band(candles: Candle[], start: number, end: number) {
  let high = -Infinity;
  let low = Infinity;
  for (let i = start; i <= end && i < candles.length; i++) {
    high = Math.max(high, candles[i].h);
    low = Math.min(low, candles[i].l);
  }
  return { high, low };
}

function injectSweep(
  candles: Candle[],
  index: number,
  side: "low" | "high",
  extreme: number,
) {
  const c = candles[index];
  if (side === "low") {
    candles[index] = { ...c, l: Math.min(c.l, extreme), c: Math.max(c.c, c.o) };
  } else {
    candles[index] = { ...c, h: Math.max(c.h, extreme), c: Math.min(c.c, c.o) };
  }
}

function identifyTrend(candles: Candle[], phases: Phase[], bias: Side): Trend {
  const accum = phases.find((p) => p.kind === "accumulation");
  const dist = phases.find((p) => p.kind === "distribution");
  if (accum && dist) {
    const accumMid = (accum.high + accum.low) / 2;
    const distMid = (dist.high + dist.low) / 2;
    if (distMid > accumMid) return "bullish";
    if (distMid < accumMid) return "bearish";
  }
  const last = candles.at(-1);
  if (accum && last) {
    if (last.c > accum.high) return "bullish";
    if (last.c < accum.low) return "bearish";
  }
  return bias === "buy" ? "bullish" : "bearish";
}

export function withTrendSide(trend: Trend): Side {
  return trend === "bullish" ? "buy" : "sell";
}

function fibs(start: number, end: number): number[] {
  const span = end - start;
  return [0.27, 0.411, 0.556, 0.688, 0.83, 1].map((p) => start + span * p);
}

function xauusd(): Scenario {
  const intervalMs = 15 * 60 * 1000;
  const rand = mulberry(3652);
  const candles = buildPath(
    intervalMs,
    3649.2,
    [
      { n: 8, target: 3652.4, vol: 1.1 },
      { n: 22, target: 3653.1, vol: 1.35 },
      { n: 6, target: 3646.8, vol: 1.6 },
      { n: 10, target: 3662.4, vol: 1.8 },
      { n: 8, target: 3651.6, vol: 1.3 },
      { n: 18, target: 3668.6, vol: 1.7 },
      { n: 8, target: 3666.2, vol: 1.2 },
    ],
    rand,
  );
  injectSweep(candles, 31, "low", 3644.16);

  const acc = band(candles, 2, 28);
  const manip = band(candles, 28, 34);
  const indication = band(candles, 35, 44);
  const correction = band(candles, 45, 53);
  const cont = band(candles, 54, 72);
  const dist = band(candles, 48, 78);

  const entry = 3652.075;
  const sl = 3644.157;
  const setup: Setup = {
    bias: "buy",
    retestIndex: 53,
    entry,
    sl,
    tps: fibs(entry, 3674.0),
    fvg: { high: 3656.4, low: 3651.8, index: 40 },
    ob: { high: 3648.2, low: 3646.4, index: 33 },
  };

  const phases: Phase[] = [
    { kind: "accumulation", start: 2, end: 28, ...acc },
    { kind: "manipulation", start: 28, end: 34, ...manip },
    { kind: "indication", start: 35, end: 44, ...indication },
    { kind: "correction", start: 45, end: 53, ...correction },
    { kind: "continuation", start: 54, end: 72, ...cont },
    { kind: "distribution", start: 48, end: 78, ...dist },
  ];

  return {
    symbol: "XAUUSD",
    name: "Gold",
    tf: "15",
    digits: 3,
    intervalMs,
    candles,
    phases,
    setup,
    trend: identifyTrend(candles, phases, setup.bias),
    historical: [
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: -1 },
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: 1 },
    ],
  };
}

function eurusd(): Scenario {
  const intervalMs = 15 * 60 * 1000;
  const rand = mulberry(1173);
  const candles = buildPath(
    intervalMs,
    1.1694,
    [
      { n: 14, target: 1.1699, vol: 0.00022 },
      { n: 18, target: 1.1696, vol: 0.0002 },
      { n: 8, target: 1.1668, vol: 0.00028 },
      { n: 10, target: 1.1724, vol: 0.00032 },
      { n: 6, target: 1.1697, vol: 0.00022 },
      { n: 16, target: 1.1746, vol: 0.00028 },
      { n: 10, target: 1.1734, vol: 0.00018 },
    ],
    rand,
  );
  injectSweep(candles, 34, "low", 1.16605);

  const acc = band(candles, 4, 30);
  const manip = band(candles, 30, 38);
  const indication = band(candles, 38, 48);
  const correction = band(candles, 48, 54);
  const cont = band(candles, 54, 70);
  const dist = band(candles, 50, 78);

  const entry = 1.1698;
  const sl = 1.16834;
  const setup: Setup = {
    bias: "buy",
    retestIndex: 54,
    entry,
    sl,
    tps: fibs(entry, 1.17478),
    fvg: { high: 1.1712, low: 1.1697, index: 44 },
    ob: { high: 1.1689, low: 1.1676, index: 36 },
  };

  const phases: Phase[] = [
    { kind: "accumulation", start: 4, end: 30, ...acc },
    { kind: "manipulation", start: 30, end: 38, ...manip },
    { kind: "indication", start: 38, end: 48, ...indication },
    { kind: "correction", start: 48, end: 54, ...correction },
    { kind: "continuation", start: 54, end: 70, ...cont },
    { kind: "distribution", start: 50, end: 78, ...dist },
  ];

  return {
    symbol: "EURUSD",
    name: "Euro",
    tf: "15",
    digits: 5,
    intervalMs,
    candles,
    phases,
    setup,
    trend: identifyTrend(candles, phases, setup.bias),
    historical: [
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: -1 },
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: -1 },
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: -1 },
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: -1 },
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: -1 },
      { r: 1 },
      { r: 1 },
    ],
  };
}

function nas100(): Scenario {
  const intervalMs = 15 * 60 * 1000;
  const rand = mulberry(24400);
  const candles = buildPath(
    intervalMs,
    24320,
    [
      { n: 12, target: 24410, vol: 28 },
      { n: 16, target: 24390, vol: 22 },
      { n: 6, target: 24455, vol: 30 },
      { n: 8, target: 24280, vol: 38 },
      { n: 8, target: 24370, vol: 26 },
      { n: 18, target: 24170, vol: 36 },
      { n: 8, target: 24190, vol: 22 },
    ],
    rand,
  );
  injectSweep(candles, 29, "high", 24458);

  const acc = band(candles, 6, 26);
  const manip = band(candles, 26, 32);
  const indication = band(candles, 32, 40);
  const correction = band(candles, 40, 48);
  const cont = band(candles, 48, 68);
  const dist = band(candles, 44, 74);

  const entry = 24310;
  const sl = 24458;
  const setup: Setup = {
    bias: "sell",
    retestIndex: 48,
    entry,
    sl,
    tps: fibs(entry, 24140),
    fvg: { high: 24340, low: 24290, index: 36 },
    ob: { high: 24420, low: 24380, index: 30 },
  };

  const phases: Phase[] = [
    { kind: "accumulation", start: 6, end: 26, ...acc },
    { kind: "manipulation", start: 26, end: 32, ...manip },
    { kind: "indication", start: 32, end: 40, ...indication },
    { kind: "correction", start: 40, end: 48, ...correction },
    { kind: "continuation", start: 48, end: 68, ...cont },
    { kind: "distribution", start: 44, end: 74, ...dist },
  ];

  return {
    symbol: "NAS100",
    name: "Nasdaq",
    tf: "15",
    digits: 2,
    intervalMs,
    candles,
    phases,
    setup,
    trend: identifyTrend(candles, phases, setup.bias),
    historical: [
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: -1 },
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: -1 },
      { r: 1 },
      { r: 1 },
      { r: 1 },
    ],
  };
}

function btcusd(): Scenario {
  const intervalMs = 15 * 60 * 1000;
  const rand = mulberry(80261);
  const candles = buildPath(
    intervalMs,
    79840,
    [
      { n: 12, target: 80180, vol: 95 },
      { n: 16, target: 79940, vol: 78 },
      { n: 6, target: 77820, vol: 175 },
      { n: 10, target: 80950, vol: 185 },
      { n: 8, target: 79860, vol: 110 },
      { n: 18, target: 82440, vol: 155 },
      { n: 8, target: 82110, vol: 90 },
    ],
    rand,
  );
  injectSweep(candles, 30, "low", 77077.6);

  const acc = band(candles, 4, 28);
  const manip = band(candles, 28, 34);
  const indication = band(candles, 34, 44);
  const correction = band(candles, 44, 52);
  const cont = band(candles, 52, 70);
  const dist = band(candles, 48, 76);

  const entry = 79860;
  const sl = 77077.6;
  const setup: Setup = {
    bias: "buy",
    retestIndex: 51,
    entry,
    sl,
    tps: fibs(entry, 82880),
    fvg: { high: 80480, low: 79840, index: 40 },
    ob: { high: 78120, low: 77540, index: 32 },
  };

  const phases: Phase[] = [
    { kind: "accumulation", start: 4, end: 28, ...acc },
    { kind: "manipulation", start: 28, end: 34, ...manip },
    { kind: "indication", start: 34, end: 44, ...indication },
    { kind: "correction", start: 44, end: 52, ...correction },
    { kind: "continuation", start: 52, end: 70, ...cont },
    { kind: "distribution", start: 48, end: 76, ...dist },
  ];

  return {
    symbol: "BTCUSD",
    name: "Bitcoin",
    tf: "15",
    digits: 1,
    intervalMs,
    candles,
    phases,
    setup,
    trend: identifyTrend(candles, phases, setup.bias),
    historical: [
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: -1 },
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: -1 },
      { r: 1 },
      { r: 1 },
    ],
  };
}

function fxPaper(
  symbol: SymbolId,
  name: string,
  digits: number,
  start: number,
  seed: number,
  vol: number,
): Scenario {
  const intervalMs = 15 * 60 * 1000;
  const rand = mulberry(seed);
  const candles = buildPath(
    intervalMs,
    start,
    [
      { n: 14, target: start * 1.0004, vol },
      { n: 18, target: start * 1.0002, vol },
      { n: 8, target: start * 0.9978, vol: vol * 1.3 },
      { n: 10, target: start * 1.0026, vol: vol * 1.45 },
      { n: 6, target: start * 1.0003, vol },
      { n: 16, target: start * 1.0044, vol: vol * 1.25 },
      { n: 10, target: start * 1.0034, vol: vol * 0.8 },
    ],
    rand,
  );
  injectSweep(candles, 34, "low", start * 0.9971);
  const acc = band(candles, 4, 30);
  const manip = band(candles, 30, 38);
  const indication = band(candles, 38, 48);
  const correction = band(candles, 48, 54);
  const cont = band(candles, 54, 70);
  const dist = band(candles, 50, 78);
  const entry = start * 1.00034;
  const sl = start * 0.99905;
  const setup: Setup = {
    bias: "buy",
    retestIndex: 54,
    entry,
    sl,
    tps: fibs(entry, start * 1.0046),
    fvg: { high: start * 1.0015, low: start * 1.0002, index: 44 },
    ob: { high: start * 0.9995, low: start * 0.9984, index: 36 },
  };
  const phases: Phase[] = [
    { kind: "accumulation", start: 4, end: 30, ...acc },
    { kind: "manipulation", start: 30, end: 38, ...manip },
    { kind: "indication", start: 38, end: 48, ...indication },
    { kind: "correction", start: 48, end: 54, ...correction },
    { kind: "continuation", start: 54, end: 70, ...cont },
    { kind: "distribution", start: 50, end: 78, ...dist },
  ];
  return {
    symbol,
    name,
    tf: "15",
    digits,
    intervalMs,
    candles,
    phases,
    setup,
    trend: identifyTrend(candles, phases, setup.bias),
    historical: [
      { r: 1 },
      { r: 1 },
      { r: -1 },
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: -1 },
      { r: 1 },
    ],
  };
}

function us30(): Scenario {
  const intervalMs = 15 * 60 * 1000;
  const start = 45480;
  const rand = mulberry(45480);
  const candles = buildPath(
    intervalMs,
    start,
    [
      { n: 12, target: 45620, vol: 42 },
      { n: 16, target: 45540, vol: 34 },
      { n: 6, target: 45710, vol: 48 },
      { n: 8, target: 45310, vol: 56 },
      { n: 8, target: 45490, vol: 38 },
      { n: 18, target: 45180, vol: 52 },
      { n: 8, target: 45240, vol: 32 },
    ],
    rand,
  );
  injectSweep(candles, 29, "high", 45720);
  const acc = band(candles, 6, 26);
  const manip = band(candles, 26, 32);
  const indication = band(candles, 32, 40);
  const correction = band(candles, 40, 48);
  const cont = band(candles, 48, 68);
  const dist = band(candles, 44, 74);
  const entry = 45420;
  const sl = 45740;
  const setup: Setup = {
    bias: "sell",
    retestIndex: 50,
    entry,
    sl,
    tps: fibs(entry, 45110),
    fvg: { high: 45510, low: 45400, index: 42 },
    ob: { high: 45680, low: 45590, index: 30 },
  };
  const phases: Phase[] = [
    { kind: "accumulation", start: 6, end: 26, ...acc },
    { kind: "manipulation", start: 26, end: 32, ...manip },
    { kind: "indication", start: 32, end: 40, ...indication },
    { kind: "correction", start: 40, end: 48, ...correction },
    { kind: "continuation", start: 48, end: 68, ...cont },
    { kind: "distribution", start: 44, end: 74, ...dist },
  ];
  return {
    symbol: "US30",
    name: "Dow",
    tf: "15",
    digits: 1,
    intervalMs,
    candles,
    phases,
    setup,
    trend: identifyTrend(candles, phases, setup.bias),
    historical: [
      { r: 1 },
      { r: 1 },
      { r: -1 },
      { r: 1 },
      { r: 1 },
      { r: -1 },
      { r: 1 },
      { r: 1 },
    ],
  };
}

function ethusd(): Scenario {
  const intervalMs = 15 * 60 * 1000;
  const rand = mulberry(3480);
  const candles = buildPath(
    intervalMs,
    3482,
    [
      { n: 12, target: 3510, vol: 8 },
      { n: 16, target: 3494, vol: 6.5 },
      { n: 6, target: 3388, vol: 14 },
      { n: 10, target: 3558, vol: 16 },
      { n: 8, target: 3486, vol: 9 },
      { n: 18, target: 3624, vol: 13 },
      { n: 8, target: 3608, vol: 7 },
    ],
    rand,
  );
  injectSweep(candles, 30, "low", 3364);
  const acc = band(candles, 4, 28);
  const manip = band(candles, 28, 34);
  const indication = band(candles, 34, 44);
  const correction = band(candles, 44, 52);
  const cont = band(candles, 52, 70);
  const dist = band(candles, 48, 76);
  const entry = 3486;
  const sl = 3364;
  const setup: Setup = {
    bias: "buy",
    retestIndex: 51,
    entry,
    sl,
    tps: fibs(entry, 3648),
    fvg: { high: 3522, low: 3484, index: 40 },
    ob: { high: 3408, low: 3382, index: 32 },
  };
  const phases: Phase[] = [
    { kind: "accumulation", start: 4, end: 28, ...acc },
    { kind: "manipulation", start: 28, end: 34, ...manip },
    { kind: "indication", start: 34, end: 44, ...indication },
    { kind: "correction", start: 44, end: 52, ...correction },
    { kind: "continuation", start: 52, end: 70, ...cont },
    { kind: "distribution", start: 48, end: 76, ...dist },
  ];
  return {
    symbol: "ETHUSD",
    name: "Ether",
    tf: "15",
    digits: 2,
    intervalMs,
    candles,
    phases,
    setup,
    trend: identifyTrend(candles, phases, setup.bias),
    historical: [
      { r: 1 },
      { r: 1 },
      { r: 1 },
      { r: -1 },
      { r: 1 },
      { r: 1 },
      { r: -1 },
      { r: 1 },
    ],
  };
}

const CACHE: Record<SymbolId, Scenario> = {
  XAUUSD: toFiveMinute(xauusd()),
  EURUSD: toFiveMinute(eurusd()),
  GBPUSD: toFiveMinute(fxPaper("GBPUSD", "Cable", 5, 1.3142, 1314, 0.00028)),
  USDJPY: toFiveMinute(fxPaper("USDJPY", "Yen", 3, 147.22, 14722, 0.028)),
  USDCHF: toFiveMinute(fxPaper("USDCHF", "Swiss", 5, 0.8014, 8014, 0.00022)),
  AUDUSD: toFiveMinute(fxPaper("AUDUSD", "Aussie", 5, 0.6528, 6528, 0.00024)),
  USDCAD: toFiveMinute(fxPaper("USDCAD", "Loonie", 5, 1.3726, 13726, 0.00026)),
  NZDUSD: toFiveMinute(fxPaper("NZDUSD", "Kiwi", 5, 0.5914, 5914, 0.00024)),
  NAS100: toFiveMinute(nas100()),
  US30: toFiveMinute(us30()),
  BTCUSD: toFiveMinute(btcusd()),
  ETHUSD: toFiveMinute(ethusd()),
};

export const SYMBOLS: SymbolId[] = [
  "XAUUSD",
  "BTCUSD",
  "ETHUSD",
  "US30",
  "NAS100",
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "AUDUSD",
  "USDCAD",
  "NZDUSD",
];

export function quoteDigits(symbol: SymbolId) {
  if (symbol === "USDJPY") return 3;
  if (symbol === "ETHUSD") return 2;
  if (symbol === "BTCUSD" || symbol === "US30" || symbol === "NAS100") return 1;
  if (symbol === "XAUUSD") return 2;
  return 5;
}

export function getScenario(symbol: SymbolId): Scenario {
  return CACHE[symbol] ?? CACHE.XAUUSD;
}

export const TIMEFRAMES: Timeframe[] = [1, 5, 15, 30, 60];

export function tfLabel(tf: Timeframe) {
  return tf === 60 ? "1H" : `${tf}m`;
}

function densify(candles: Candle[], factor: number, stepMs: number): Candle[] {
  if (factor <= 1) return candles.map((c) => ({ ...c }));
  const out: Candle[] = [];
  for (const c of candles) {
    const span = c.c - c.o;
    const parts: Candle[] = [];
    let px = c.o;
    for (let k = 0; k < factor; k++) {
      const o = px;
      const close = k === factor - 1 ? c.c : c.o + (span * (k + 1)) / factor;
      let h = Math.max(o, close);
      let l = Math.min(o, close);
      if (k === 0) l = Math.min(l, c.l);
      if (k === Math.floor(factor / 2) || k === factor - 1) h = Math.max(h, c.h);
      if (k === factor - 1) l = Math.min(l, c.l);
      parts.push({ t: c.t + k * stepMs, o, h, l, c: close });
      px = close;
    }
    parts[0].l = Math.min(parts[0].l, c.l);
    parts[Math.floor(factor / 2)].h = Math.max(parts[Math.floor(factor / 2)].h, c.h);
    out.push(...parts);
  }
  return out;
}

function toFiveMinute(s: Scenario): Scenario {
  const step = 5 * 60 * 1000;
  const factor = Math.max(1, Math.round(s.intervalMs / step));
  if (factor === 1) return { ...s, tf: "5", intervalMs: step };
  const candles = densify(s.candles, factor, step);
  const map = (i: number) => Math.min(candles.length - 1, Math.max(0, i * factor));
  return {
    ...s,
    tf: "5",
    intervalMs: step,
    candles,
    phases: s.phases.map((p) => ({ ...p, start: map(p.start), end: map(p.end) })),
    setup: {
      ...s.setup,
      retestIndex: map(s.setup.retestIndex),
      fvg: { ...s.setup.fvg, index: map(s.setup.fvg.index) },
      ob: { ...s.setup.ob, index: map(s.setup.ob.index) },
    },
  };
}

function resample(candles: Candle[], intervalMs: number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const t = Math.floor(c.t / intervalMs) * intervalMs;
    const last = out[out.length - 1];
    if (!last || last.t !== t) {
      out.push({ t, o: c.o, h: c.h, l: c.l, c: c.c });
    } else {
      last.h = Math.max(last.h, c.h);
      last.l = Math.min(last.l, c.l);
      last.c = c.c;
    }
  }
  return out;
}

function mapIndex(base: Candle[], view: Candle[], i: number, intervalMs: number) {
  const src = base[Math.max(0, Math.min(i, base.length - 1))];
  if (!src || view.length === 0) return 0;
  const t = Math.floor(src.t / intervalMs) * intervalMs;
  let idx = view.findIndex((c) => c.t === t);
  if (idx < 0) idx = view.findIndex((c) => c.t >= t);
  if (idx < 0) return view.length - 1;
  return idx;
}

export function viewScenario(base: Scenario, tf: Timeframe): Scenario {
  const intervalMs = tf * 60 * 1000;
  if (base.intervalMs === intervalMs) {
    return { ...base, tf: String(tf) };
  }
  const candles =
    intervalMs < base.intervalMs
      ? densify(base.candles, Math.max(2, Math.round(base.intervalMs / intervalMs)), intervalMs)
      : resample(base.candles, intervalMs);
  const map = (i: number) => mapIndex(base.candles, candles, i, intervalMs);
  return {
    ...base,
    tf: String(tf),
    intervalMs,
    candles,
    phases: base.phases.map((p) => ({
      ...p,
      start: map(p.start),
      end: map(p.end),
    })),
    setup: {
      ...base.setup,
      retestIndex: map(base.setup.retestIndex),
      fvg: { ...base.setup.fvg, index: map(base.setup.fvg.index) },
      ob: { ...base.setup.ob, index: map(base.setup.ob.index) },
    },
  };
}

export function heikinAshi(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const haC = (c.o + c.h + c.l + c.c) / 4;
    const prev = out[i - 1];
    const haO = prev ? (prev.o + prev.c) / 2 : (c.o + c.c) / 2;
    out.push({
      t: c.t,
      o: haO,
      c: haC,
      h: Math.max(c.h, haO, haC),
      l: Math.min(c.l, haO, haC),
    });
  }
  return out;
}

export function scenarioFromBars(
  symbol: SymbolId,
  candles: Candle[],
  tf: Timeframe,
): Scenario {
  const names: Record<SymbolId, string> = {
    XAUUSD: "Gold",
    EURUSD: "Euro",
    GBPUSD: "Cable",
    USDJPY: "Yen",
    USDCHF: "Swiss",
    AUDUSD: "Aussie",
    USDCAD: "Loonie",
    NZDUSD: "Kiwi",
    NAS100: "Nasdaq",
    US30: "Dow",
    BTCUSD: "Bitcoin",
    ETHUSD: "Ether",
  };
  const digits: Record<SymbolId, number> = {
    XAUUSD: 2,
    EURUSD: 5,
    GBPUSD: 5,
    USDJPY: 3,
    USDCHF: 5,
    AUDUSD: 5,
    USDCAD: 5,
    NZDUSD: 5,
    NAS100: 1,
    US30: 1,
    BTCUSD: 1,
    ETHUSD: 2,
  };
  const n = candles.length;
  const a1 = Math.max(6, Math.floor(n * 0.38));
  const m0 = Math.floor(n * 0.35);
  const m1 = Math.max(m0 + 3, Math.floor(n * 0.48));
  const i0 = Math.floor(n * 0.45);
  const i1 = Math.max(i0 + 3, Math.floor(n * 0.6));
  const c0 = Math.floor(n * 0.58);
  const c1 = Math.max(c0 + 3, Math.floor(n * 0.7));
  const t0 = Math.min(n - 3, Math.floor(n * 0.68));
  const acc = band(candles, 2, a1);
  const manip = band(candles, m0, m1);
  const indication = band(candles, i0, i1);
  const correction = band(candles, c0, c1);
  const cont = band(candles, t0, n - 1);
  const dist = band(candles, Math.floor(n * 0.6), n - 1);
  const last = candles[n - 1];
  const lastO = last?.o ?? 0;
  const lastC = last?.c ?? 0;
  const lastH = last?.h ?? 0;
  const lastL = last?.l ?? 0;
  const distMid = (dist.high + dist.low) / 2;
  const accMid = (acc.high + acc.low) / 2;
  const indicC = candles[Math.min(i1, n - 1)]?.c ?? lastC;
  let bias: Side = distMid >= accMid ? "buy" : "sell";
  if (distMid > accMid && indicC > accMid) bias = "buy";
  if (distMid < accMid && indicC < accMid) bias = "sell";
  let zhi = lastH;
  let zlo = lastL;
  let fvgIndex = i0;
  for (let i = i0 + 2; i < Math.min(c1, n); i++) {
    if (bias === "buy" && candles[i - 2].h < candles[i].l) {
      zhi = candles[i].l;
      zlo = candles[i - 2].h;
      fvgIndex = i;
    }
    if (bias === "sell" && candles[i - 2].l > candles[i].h) {
      zhi = candles[i - 2].l;
      zlo = candles[i].h;
      fvgIndex = i;
    }
  }
  const pad = Math.max((acc.high - acc.low) * 0.05, Math.abs(lastC) * 0.0008);
  let retest = false;
  let sl = lastC;
  let target = lastC;
  if (bias === "buy") {
    if (lastL <= zhi && lastC > zlo && lastC > lastO) retest = true;
    sl = Math.min(manip.low, acc.low) - pad;
    target = lastC + Math.abs(lastC - sl) * 2.75;
  } else {
    if (lastH >= zlo && lastC < zhi && lastC < lastO) retest = true;
    sl = Math.max(manip.high, acc.high) + pad;
    target = lastC - Math.abs(sl - lastC) * 2.75;
  }
  const entry = lastC;
  const setup: Setup = {
    bias,
    retestIndex: retest ? n - 1 : n,
    entry,
    sl,
    tps: fibs(entry, target),
    fvg: { high: zhi, low: zlo, index: fvgIndex },
    ob: { high: manip.high, low: manip.low, index: m0 },
  };
  const phases: Phase[] = [
    { kind: "accumulation", start: 2, end: a1, ...acc },
    { kind: "manipulation", start: m0, end: m1, ...manip },
    { kind: "indication", start: i0, end: i1, ...indication },
    { kind: "correction", start: c0, end: c1, ...correction },
    { kind: "continuation", start: t0, end: n - 1, ...cont },
    { kind: "distribution", start: Math.floor(n * 0.6), end: n - 1, ...dist },
  ];
  return {
    symbol,
    name: names[symbol],
    tf: String(tf),
    digits: digits[symbol],
    intervalMs: tf * 60 * 1000,
    candles,
    phases,
    setup,
    trend: identifyTrend(candles, phases, bias),
    historical: [],
  };
}

export function backtestStats(historical: HistoricalTrade[], risk: number) {
  let eq = 0;
  let peak = 0;
  let maxDd = 0;
  let wins = 0;
  let losses = 0;
  const curve: number[] = [0];
  for (const t of historical) {
    eq += t.r;
    if (t.r > 0) wins += 1;
    else losses += 1;
    peak = Math.max(peak, eq);
    maxDd = Math.min(maxDd, eq - peak);
    curve.push(eq);
  }
  const n = historical.length || 1;
  const grossWins = wins * risk;
  const grossLoss = losses * risk;
  return {
    wins,
    losses,
    netR: eq,
    expectancy: eq / n,
    maxDd,
    pnl: eq * risk,
    curve,
    winRate: wins / n,
    grossWins,
    grossLoss,
    n,
  };
}
