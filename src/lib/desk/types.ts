export type AccountId = string;
export type SymbolId =
  | "XAUUSD"
  | "EURUSD"
  | "GBPUSD"
  | "USDJPY"
  | "USDCHF"
  | "AUDUSD"
  | "USDCAD"
  | "NZDUSD"
  | "NAS100"
  | "US30"
  | "BTCUSD"
  | "ETHUSD";
export type Side = "buy" | "sell";
export type Trend = "bullish" | "bearish";
export type FillKind = "icc-retest" | "manual";
export type CandleStyle = "candles" | "heikin";
export type Timeframe = 1 | 5 | 15 | 30 | 60;
export type AutoClose = "off" | "tp1" | "tp2" | "odds" | "tp6";
export type CloseAt = "tp1" | "tp2" | "tp3" | "tp4" | "tp5" | "tp6" | "sl" | "market";

export const AUTO_CLOSE: AutoClose[] = ["off", "tp1", "tp2", "odds", "tp6"];
export const BANK_TPS = ["tp1", "tp2", "tp3", "tp4", "tp5", "tp6"] as const;

export function autoCloseLabel(v: AutoClose) {
  if (v === "off") return "Off";
  if (v === "odds") return "Odds";
  return v.toUpperCase();
}

export function autoCloseTarget(v: AutoClose): CloseAt | null {
  if (v === "off") return null;
  if (v === "odds") return "tp5";
  return v;
}

export function tpIndex(at: CloseAt): number | null {
  if (!at.startsWith("tp")) return null;
  const n = Number(at.slice(2));
  return Number.isFinite(n) ? n - 1 : null;
}

export type PhaseKind =
  | "accumulation"
  | "manipulation"
  | "indication"
  | "correction"
  | "continuation"
  | "distribution";

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface Phase {
  kind: PhaseKind;
  start: number;
  end: number;
  high: number;
  low: number;
  label?: string;
}

export interface Zone {
  high: number;
  low: number;
  index: number;
}

export interface Setup {
  bias: Side;
  retestIndex: number;
  entry: number;
  sl: number;
  tps: number[];
  fvg: Zone;
  ob: Zone;
}

export interface HistoricalTrade {
  r: number;
}

export interface Account {
  id: AccountId;
  code: string;
  name: string;
  sizeLabel: string;
  starting: number;
  sessionId: string;
}

export interface JournalEntry {
  id: string;
  accountId: AccountId;
  symbol: SymbolId;
  side: Side;
  kind: FillKind;
  pnl: number;
  r: number;
  at: number;
  note?: string;
}

export interface Position {
  accountId: AccountId;
  symbol: SymbolId;
  side: Side;
  kind: FillKind;
  entry: number;
  sl: number;
  initialSl: number;
  tps: number[];
  risk: number;
  openedAt: number;
  tlOrderId?: string;
}

export interface Scenario {
  symbol: SymbolId;
  name: string;
  tf: string;
  digits: number;
  intervalMs: number;
  candles: Candle[];
  phases: Phase[];
  setup: Setup;
  trend: Trend;
  historical: HistoricalTrade[];
}
