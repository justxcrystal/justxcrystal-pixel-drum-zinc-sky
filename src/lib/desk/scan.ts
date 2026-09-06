import { getScenario, scenarioFromBars, SYMBOLS, withTrendSide } from "./scenarios";
import { fetchLiveMarket, fetchPublicMarket, type TlSession } from "./tl-api";
import type { Scenario, Side, SymbolId, Timeframe, Trend } from "./types";

export interface ScanHit {
  symbol: SymbolId;
  name: string;
  trend: Trend;
  side: Side;
  last: number;
  digits: number;
  dist: boolean;
  retest: boolean;
  rank: number;
  tag: string;
}

function hitFrom(sc: Scenario): ScanHit {
  const n = sc.candles.length;
  const last = sc.candles.at(-1)?.c ?? 0;
  const distPhase = sc.phases.find((p) => p.kind === "distribution");
  const inDist = Boolean(distPhase && n - 1 >= distPhase.start);
  const retest = sc.setup.retestIndex < n;
  const side = withTrendSide(sc.trend);
  let rank = 0;
  let tag = "SCAN";
  if (inDist && retest) {
    rank = 3;
    tag = "DIST RETEST";
  } else if (retest) {
    rank = 2;
    tag = "RETEST";
  } else if (inDist) {
    rank = 1;
    tag = "DIST";
  } else {
    tag = "WAIT";
  }
  return {
    symbol: sc.symbol,
    name: sc.name,
    trend: sc.trend,
    side,
    last,
    digits: sc.digits,
    dist: inDist,
    retest,
    rank,
    tag,
  };
}

export function paperScan(_tf: Timeframe): ScanHit[] {
  return SYMBOLS.map((s) => hitFrom(getScenario(s))).sort(byRank);
}

function byRank(a: ScanHit, b: ScanHit) {
  if (b.rank !== a.rank) return b.rank - a.rank;
  return a.symbol.localeCompare(b.symbol);
}

export async function liveScan(opts: {
  tf: Timeframe;
  tl: TlSession | null;
}): Promise<ScanHit[]> {
  const acc = opts.tl?.accounts[0];
  const rows = await Promise.all(
    SYMBOLS.map(async (symbol) => {
      try {
        if (symbol === "BTCUSD" || symbol === "ETHUSD") {
          const pub = await fetchPublicMarket({ data: { symbol, tf: opts.tf } });
          if (pub.ok && pub.candles.length >= 10) {
            return hitFrom(scenarioFromBars(symbol, pub.candles, opts.tf));
          }
        }
        if (opts.tl && acc) {
          const live = await fetchLiveMarket({
            data: {
              env: opts.tl.env,
              accessToken: opts.tl.accessToken,
              accountId: acc.accountId,
              accNum: acc.accNum,
              symbol,
              tf: opts.tf,
            },
          });
          if (live.ok && live.candles.length >= 10) {
            return hitFrom(scenarioFromBars(symbol, live.candles, opts.tf));
          }
        }
      } catch {
        /* paper fallback */
      }
      return hitFrom(getScenario(symbol));
    }),
  );
  return rows.sort(byRank);
}
