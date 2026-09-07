import { create } from "zustand";
import { toast } from "sonner";
import { ACCOUNTS, getAccount } from "./accounts";
import { getScenario, quoteDigits, scenarioFromBars, SYMBOLS, viewScenario, withTrendSide } from "./scenarios";
import { isSameDay } from "./format";
import { isCashClosed, isCryptoWeekend } from "./market";
import {
  closeTradeLockerPosition,
  fetchLiveMarket,
  fetchLiveQuote,
  fetchPublicMarket,
  fetchPublicQuote,
  loginTradeLocker,
  placeTradeLockerOrder,
  refreshTradeLocker,
  TL_ENVS,
  type TlAccount,
  type TlEnv,
  type TlSession,
} from "./tl-api";
import type {
  AccountId,
  AutoClose,
  CandleStyle,
  CloseAt,
  FillKind,
  JournalEntry,
  Position,
  Scenario,
  Side,
  SymbolId,
  Timeframe,
} from "./types";
import { autoCloseTarget, tpIndex } from "./types";

const KEY = "meridian-desk-v1";
const TL_KEY = "meridian-tl-session";
const REMEMBER_KEY = "meridian-tl-remember";

export const RISK_LEVELS = [0.01, 0.02, 0.03, 0.1, 0.15] as const;

const SEED_JOURNAL: JournalEntry[] = [
  {
    id: "seed-atlas-xau",
    accountId: "atlas",
    symbol: "XAUUSD",
    side: "buy",
    kind: "manual",
    pnl: 1381.02,
    r: 0.69,
    at: Date.UTC(2026, 7, 28, 14, 12, 0),
    note: "Continuation retest, gold",
  },
  {
    id: "seed-horizon-nas",
    accountId: "horizon",
    symbol: "NAS100",
    side: "sell",
    kind: "icc-retest",
    pnl: 620,
    r: 1.24,
    at: Date.UTC(2026, 7, 27, 18, 40, 0),
    note: "Short continuation after distribution retest",
  },
  {
    id: "seed-citadel-eur",
    accountId: "citadel",
    symbol: "EURUSD",
    side: "buy",
    kind: "icc-retest",
    pnl: 1875,
    r: 1.25,
    at: Date.UTC(2026, 7, 27, 15, 5, 0),
    note: "Entry on retest, TP2",
  },
];

export interface DeskState {
  accountId: AccountId;
  symbol: SymbolId;
  riskPct: number;
  armed: boolean;
  paperOn: boolean;
  candleStyle: CandleStyle;
  tf: Timeframe;
  autoClose: AutoClose;
  trailOn: boolean;
  journal: JournalEntry[];
  position: Position | null;
  replay: number | null;
  settingsOpen: boolean;
  playbookOpen: boolean;
  journalOpen: boolean;
  loginOpen: boolean;
  paperMode: boolean;
  tl: TlSession | null;
  loginBusy: boolean;
  loginError: string | null;
  brokerOn: boolean;
  lots: number;
  liveScenario: Scenario | null;
  liveError: string | null;
  liveLabel: string | null;
  sessionHours: 1 | 2 | 3 | 4;
  sessionEnd: number | null;
  tradeAll: boolean;
  flattenAtClose: boolean;
  paperStart: number;
  challengeOn: boolean;
  challengeAt: number | null;
  setAccount: (id: AccountId) => void;
  setSymbol: (s: SymbolId) => void;
  setRisk: (n: number) => void;
  setArmed: (v: boolean) => void;
  setPaperOn: (v: boolean) => void;
  setCandleStyle: (s: CandleStyle) => void;
  setTf: (tf: Timeframe) => void;
  setAutoClose: (v: AutoClose) => void;
  setTrailOn: (v: boolean) => void;
  setReplay: (n: number | null) => void;
  openSettings: (v: boolean) => void;
  openPlaybook: (v: boolean) => void;
  openJournal: (v: boolean) => void;
  openLogin: (v: boolean) => void;
  skipToPaper: () => void;
  connectTl: (creds: {
    email: string;
    password: string;
    server: string;
    env: TlEnv;
    remember: boolean;
  }) => Promise<boolean>;
  disconnectTl: () => void;
  refreshTl: () => Promise<void>;
  setBrokerOn: (v: boolean) => void;
  pullLive: () => Promise<void>;
  pullQuote: () => Promise<void>;
  applyLast: (last: number) => void;
  ingestBars: (
    candles: { t: number; o: number; h: number; l: number; c: number }[],
    last?: number,
  ) => void;
  takeTrade: (side: Side, kind: FillKind, src?: "auto" | "user") => void;
  tryAutoFill: () => boolean;
  tryAutoManage: () => boolean;
  closePosition: (at: CloseAt, opts?: { auto?: boolean }) => void;
  flatten: () => void;
  setFlattenAtClose: (v: boolean) => void;
  setPaperStart: (n: number) => void;
  setLots: (n: number) => void;
  startFlip100: () => void;
  resetDemo: () => void;
  setSessionHours: (n: 1 | 2 | 3 | 4) => void;
  tickSession: () => void;
  setTradeAll: (v: boolean) => void;
}

function persistable(s: DeskState) {
  return {
    accountId: s.accountId,
    symbol: s.symbol,
    riskPct: s.riskPct,
    armed: s.armed,
    paperOn: s.paperOn,
    candleStyle: s.candleStyle,
    tf: s.tf,
    autoClose: s.autoClose,
    trailOn: s.trailOn,
    paperMode: s.paperMode,
    brokerOn: s.brokerOn,
    journal: s.journal,
    position: s.position,
    sessionHours: s.sessionHours,
    sessionEnd: s.sessionEnd,
    tradeAll: s.tradeAll,
    flattenAtClose: s.flattenAtClose,
    paperStart: s.paperStart,
    challengeOn: s.challengeOn,
    challengeAt: s.challengeAt,
    lots: s.lots,
    atlasAccounts: s.tl?.accounts ?? [],
  };
}

function persistTl(session: TlSession | null) {
  if (typeof window === "undefined") return;
  if (!session) {
    localStorage.removeItem(TL_KEY);
    sessionStorage.removeItem(TL_KEY);
    return;
  }
  localStorage.setItem(TL_KEY, JSON.stringify(session));
}

function persistRemember(creds: { email: string; server: string; env: TlEnv } | null) {
  if (typeof window === "undefined") return;
  if (!creds) {
    localStorage.removeItem(REMEMBER_KEY);
    return;
  }
  localStorage.setItem(REMEMBER_KEY, JSON.stringify(creds));
}

export function loadRememberedLogin(): { email: string; server: string; env: TlEnv } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { email?: string; server?: string; env?: TlEnv };
    if (!parsed.email && !parsed.server) return null;
    return {
      email: parsed.email ?? "",
      server: parsed.server ?? "ATLAS",
      env: parsed.env && (TL_ENVS as readonly string[]).includes(parsed.env) ? parsed.env : "live",
    };
  } catch {
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function persistNow(s: DeskState) {
  if (typeof window === "undefined") return;
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(KEY, JSON.stringify(persistable(s)));
  } catch {
    /* quota */
  }
  if (s.tl?.accessToken) persistTl(s.tl);
}

function scheduleSave(s: DeskState) {
  if (typeof window === "undefined") return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persistNow(s), 80);
}

type Book = Pick<DeskState, "accountId" | "journal" | "tl"> & {
  paperStart?: number;
  challengeOn?: boolean;
  challengeAt?: number | null;
};

export function equityOf(state: Book) {
  const start =
    state.paperStart && state.paperStart > 0
      ? state.paperStart
      : state.challengeOn
        ? 100
        : getAccount(state.accountId).starting;
  const after = state.challengeOn ? (state.challengeAt ?? 0) : 0;
  const pnl = state.journal
    .filter((j) => j.accountId === state.accountId && j.at >= after)
    .reduce((n, j) => n + j.pnl, 0);
  if (state.challengeOn || !state.tl) return start + pnl;
  const tlAcc = state.tl.accounts.find((a) => a.id === state.accountId) ?? state.tl.accounts[0];
  if (tlAcc) return tlAcc.equity || tlAcc.balance;
  return start + pnl;
}

export function todayPnl(state: Book, now = Date.now()) {
  if (state.challengeOn || !state.tl) {
    const after = state.challengeOn ? (state.challengeAt ?? 0) : 0;
    return state.journal
      .filter(
        (j) =>
          j.accountId === state.accountId &&
          j.at >= after &&
          isSameDay(j.at, now),
      )
      .reduce((n, j) => n + j.pnl, 0);
  }
  const tlAcc = state.tl.accounts.find((a) => a.id === state.accountId);
  if (tlAcc) return tlAcc.todayPnl;
  return state.journal
    .filter((j) => j.accountId === state.accountId && isSameDay(j.at, now))
    .reduce((n, j) => n + j.pnl, 0);
}

export function riskDollars(
  state: Book & Pick<DeskState, "riskPct">,
) {
  return equityOf(state) * state.riskPct;
}

export function isIndexSymbol(symbol: SymbolId) {
  return symbol === "US30" || symbol === "NAS100";
}

export function isCryptoSymbol(symbol: SymbolId) {
  return symbol === "BTCUSD" || symbol === "ETHUSD";
}

export function cryptoTradingLocked(symbol: SymbolId, now = Date.now()) {
  return isCryptoSymbol(symbol) && !isCryptoWeekend(now);
}

export function challengeIndexLocked(state: Book) {
  if (!state.challengeOn) return false;
  const start = state.paperStart && state.paperStart > 0 ? state.paperStart : 100;
  return equityOf(state) <= start * 2;
}

export function activeTlAccount(state: Pick<DeskState, "accountId" | "tl">): TlAccount | null {
  if (!state.tl?.accounts.length) return null;
  return state.tl.accounts.find((a) => a.id === state.accountId) ?? state.tl.accounts[0];
}

function fanPaperIds(state: Pick<DeskState, "accountId" | "tl" | "tradeAll">): string[] {
  if (state.tl?.accounts.length && state.tradeAll) {
    return state.tl.accounts.map((a) => a.id);
  }
  if (state.tl?.accounts.length) {
    const one = activeTlAccount(state);
    return [one?.id ?? state.accountId];
  }
  return [state.accountId];
}

function fanTlAccounts(state: Pick<DeskState, "accountId" | "tl" | "tradeAll">): TlAccount[] {
  if (!state.tl?.accounts.length) return [];
  if (state.tradeAll) return state.tl.accounts;
  const one = activeTlAccount(state);
  return one ? [one] : [];
}

function riskOn(state: DeskState, accountId: string) {
  return riskDollars({ ...state, accountId });
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

let lastAutoKey = "";
let protectBar = -1;
let autoReadyAt = Date.now() + 12_000;

function autoKeyOf(symbol: SymbolId, tf: Timeframe, t = 0) {
  return `${symbol}:${tf}:${Math.floor(t / 60_000)}`;
}

function currentScenario(s: Pick<DeskState, "symbol" | "tf" | "liveScenario">) {
  if (s.liveScenario && s.liveScenario.symbol === s.symbol) return s.liveScenario;
  return viewScenario(getScenario(s.symbol), s.tf);
}

const defaults = {
  accountId: "atlas" as AccountId,
  symbol: "BTCUSD" as SymbolId,
  riskPct: 0.02,
  armed: true,
  paperOn: true,
  candleStyle: "candles" as CandleStyle,
  tf: 5 as Timeframe,
  autoClose: "tp6" as AutoClose,
  trailOn: true,
  journal: SEED_JOURNAL,
  position: null as Position | null,
  replay: null as number | null,
  settingsOpen: false,
  playbookOpen: false,
  journalOpen: false,
  loginOpen: false,
  paperMode: true,
  tl: null as TlSession | null,
  loginBusy: false,
  loginError: null as string | null,
  brokerOn: false,
  lots: 0.01,
  liveScenario: null as Scenario | null,
  liveError: null as string | null,
  liveLabel: null as string | null,
  sessionHours: 3 as 1 | 2 | 3 | 4,
  sessionEnd: null as number | null,
  tradeAll: true,
  flattenAtClose: false,
  paperStart: 100,
  challengeOn: false,
  challengeAt: null as number | null,
};

export const useDesk = create<DeskState>((set, get) => ({
  ...defaults,
  setAccount: (id) => {
    const s = get();
    if (s.position && s.position.accountId !== id && !s.tradeAll) {
      set({ accountId: id, position: null, tradeAll: false });
    } else set({ accountId: id, tradeAll: false });
    scheduleSave(get());
    void get().pullLive();
  },
  setTradeAll: (tradeAll) => {
    if (tradeAll && get().challengeOn) {
      toast.message("Copy Atlas is off during Paper $100.");
      set({ tradeAll: false });
      scheduleSave(get());
      return;
    }
    set({ tradeAll });
    scheduleSave(get());
  },
  setSymbol: (symbol) => {
    lastAutoKey = "";
    set({ symbol, replay: null, liveScenario: null });
    scheduleSave(get());
    void get().pullLive();
    get().tryAutoFill();
    get().tryAutoManage();
  },
  setRisk: (riskPct) => {
    if (!(RISK_LEVELS as readonly number[]).includes(riskPct)) {
      toast.error("Choose 1%, 2%, 3%, 10%, or 15% risk.");
      return;
    }
    set({ riskPct });
    scheduleSave(get());
  },
  setLots: (lots) => {
    set({ lots: Math.max(0.01, Math.round(lots * 100) / 100) });
    scheduleSave(get());
  },
  setPaperStart: (n) => {
    const paperStart = Math.max(1, Math.round(n * 100) / 100);
    set({ paperStart });
    scheduleSave(get());
  },
  startFlip100: () => {
    const s = get();
    const symbol = isIndexSymbol(s.symbol) ? "BTCUSD" : s.symbol;
    lastAutoKey = "";
    set({
      paperStart: 100,
      challengeOn: true,
      challengeAt: Date.now(),
      riskPct: 0.02,
      lots: 0.01,
      position: null,
      tradeAll: false,
      brokerOn: false,
      symbol,
      liveScenario: symbol === s.symbol ? s.liveScenario : null,
      replay: null,
    });
    scheduleSave(get());
    toast.message("Paper $100 on. Indices locked until $200. FX, gold, BTC, ETH only.");
    if (symbol !== s.symbol) void get().pullLive();
  },
  setArmed: (armed) => {
    const patch = armed
      ? {
          armed: true,
          paperOn: true,
          sessionEnd: Date.now() + get().sessionHours * 60 * 60 * 1000,
        }
      : { armed: false };
    set(patch);
    scheduleSave(get());
    get().tryAutoFill();
    get().tryAutoManage();
  },
  setPaperOn: (paperOn) => {
    set(paperOn ? { paperOn: true, armed: true } : { paperOn: false });
    scheduleSave(get());
    get().tryAutoFill();
    get().tryAutoManage();
  },
  setBrokerOn: (brokerOn) => {
    set({ brokerOn });
    scheduleSave(get());
  },
  setCandleStyle: (candleStyle) => {
    set({ candleStyle });
    scheduleSave(get());
  },
  setTf: (tf) => {
    lastAutoKey = "";
    set({ tf, replay: null });
    scheduleSave(get());
    void get().pullLive();
    get().tryAutoFill();
    get().tryAutoManage();
  },
  setReplay: (replay) => {
    set({ replay });
    get().tryAutoFill();
    get().tryAutoManage();
  },
  setAutoClose: (autoClose) => {
    set({ autoClose });
    scheduleSave(get());
    get().tryAutoManage();
  },
  setTrailOn: (trailOn) => {
    set({ trailOn });
    scheduleSave(get());
    get().tryAutoManage();
  },
  openSettings: (settingsOpen) => set({ settingsOpen }),
  openPlaybook: (playbookOpen) => set({ playbookOpen }),
  openJournal: (journalOpen) => set({ journalOpen }),
  openLogin: (loginOpen) => set({ loginOpen, loginError: null, settingsOpen: false }),
  skipToPaper: () => {
    set({
      paperMode: true,
      loginOpen: false,
      loginError: null,
      loginBusy: false,
      armed: true,
      paperOn: true,
      brokerOn: false,
    });
    persistNow(get());
    void get().pullLive();
  },
  connectTl: async (creds) => {
    set({ loginBusy: true, loginError: null });
    const server = creds.server.trim();
    try {
      const res = await loginTradeLocker({
        data: {
          email: creds.email.trim(),
          password: creds.password,
          server,
          env: creds.env,
        },
      });
      if (res.ok) {
        if (creds.remember) {
          persistRemember({ email: creds.email.trim(), server, env: res.session.env });
        } else persistRemember(null);
        const first = res.session.accounts[0];
        set({
          loginBusy: false,
          loginError: null,
          tl: res.session,
          loginOpen: false,
          paperMode: false,
          paperOn: true,
          armed: true,
          brokerOn: true,
          tradeAll: res.session.accounts.length > 1,
          accountId: first?.id ?? get().accountId,
          position: null,
          sessionEnd: Date.now() + get().sessionHours * 60 * 60 * 1000,
        });
        persistTl(res.session);
        scheduleSave(get());
        const n = res.session.accounts.length;
        toast.success(
          n
            ? `ATLAS · ${n} account${n === 1 ? "" : "s"} connected`
            : "ATLAS session ok",
        );
        void get().pullLive();
        return true;
      }
      set({ loginBusy: false, loginError: res.error });
      return false;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      set({
        loginBusy: false,
        loginError:
          msg && msg.length < 160
            ? msg
            : "Could not reach ATLAS. Check email and password.",
      });
      return false;
    }
  },
  disconnectTl: () => {
    persistTl(null);
    set({
      tl: null,
      paperMode: true,
      loginOpen: false,
      paperOn: true,
      brokerOn: false,
      accountId: "atlas",
    });
    scheduleSave(get());
    void get().pullLive();
  },
  refreshTl: async () => {
    const s = get();
    if (!s.tl) return;
    try {
      const res = await refreshTradeLocker({
        data: {
          env: s.tl.env,
          accessToken: s.tl.accessToken,
          refreshToken: s.tl.refreshToken,
          accounts: s.tl.accounts,
        },
      });
      if (!res.ok) return;
      const next: TlSession = {
        ...s.tl,
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        accounts: res.accounts,
      };
      set({ tl: next });
      persistTl(next);
    } catch {
      /* keep last snapshot */
    }
  },
  pullLive: async () => {
    const s = get();
    const applyBars = (
      candles: { t: number; o: number; h: number; l: number; c: number }[],
      label: string,
      last?: number,
    ) => {
      const live = scenarioFromBars(s.symbol, candles, s.tf);
      set({
        liveScenario: live,
        liveError: null,
        liveLabel: last
          ? `${label} · ${last.toFixed(quoteDigits(s.symbol))}`
          : label,
        replay: null,
      });
      get().tryAutoFill();
      get().tryAutoManage();
    };

    if (s.symbol === "BTCUSD" || s.symbol === "ETHUSD") {
      try {
        const pub = await fetchPublicMarket({ data: { symbol: s.symbol, tf: s.tf } });
        if (pub.ok) {
          applyBars(pub.candles, `LIVE ${s.symbol}`, pub.last);
          return;
        }
      } catch {
        /* Atlas fallback */
      }
    }

    if (!s.tl) {
      if (s.symbol === "BTCUSD" || s.symbol === "ETHUSD") {
        set({ liveError: `Public ${s.symbol} feed failed.` });
      }
      return;
    }
    const acc = activeTlAccount(s);
    if (!acc) {
      set({ liveError: "No TradeLocker account on this session." });
      return;
    }
    try {
      const res = await fetchLiveMarket({
        data: {
          env: s.tl.env,
          accessToken: s.tl.accessToken,
          accountId: acc.accountId,
          accNum: acc.accNum,
          symbol: s.symbol,
          tf: s.tf,
        },
      });
      if (!res.ok) {
        const expired = /401|403|unauthor|expired|token/i.test(res.error);
        set({
          liveError: res.error,
          liveLabel: null,
          ...(expired
            ? {
                tl: null,
                brokerOn: false,
                loginError: "Atlas session expired. Connect again.",
              }
            : {}),
        });
        if (expired) persistTl(null);
        return;
      }
      applyBars(res.candles, `${res.instrument} · ${s.tl.env.toUpperCase()}`, res.last);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Live feed failed.";
      set({ liveError: msg });
    }
  },
  pullQuote: async () => {
    const s = get();
    const patchLast = (last: number, label: string) => {
      const base =
        s.liveScenario && s.liveScenario.symbol === s.symbol ? s.liveScenario : null;
      if (!base?.candles.length) {
        void get().pullLive();
        return;
      }
      const candles = base.candles.slice();
      const cur = candles[candles.length - 1];
      candles[candles.length - 1] = {
        ...cur,
        c: last,
        h: Math.max(cur.h, last),
        l: Math.min(cur.l, last),
      };
      set({
        liveScenario: { ...base, candles },
        liveLabel: `${label} · ${last.toFixed(quoteDigits(s.symbol))}`,
        liveError: null,
      });
      get().tryAutoFill();
      get().tryAutoManage();
    };

    if (s.symbol === "BTCUSD" || s.symbol === "ETHUSD") {
      try {
        const pub = await fetchPublicQuote({ data: { symbol: s.symbol } });
        if (pub.ok) {
          patchLast(pub.last, `LIVE ${s.symbol}`);
          return;
        }
      } catch {
        /* Atlas fallback */
      }
    }

    if (!s.tl || !s.liveScenario || s.liveScenario.symbol !== s.symbol) {
      await get().pullLive();
      return;
    }
    const acc = activeTlAccount(s);
    if (!acc) return;
    try {
      const res = await fetchLiveQuote({
        data: {
          env: s.tl.env,
          accessToken: s.tl.accessToken,
          accountId: acc.accountId,
          accNum: acc.accNum,
          symbol: s.symbol,
        },
      });
      if (!res.ok) return;
      patchLast(res.last, res.instrument);
    } catch {
      /* keep last quote */
    }
  },
  applyLast: (last) => {
    if (!Number.isFinite(last) || last <= 0) return;
    const s = get();
    const base =
      s.liveScenario && s.liveScenario.symbol === s.symbol ? s.liveScenario : null;
    if (!base?.candles.length) {
      void get().pullLive();
      return;
    }
    const candles = base.candles.slice();
    const cur = candles[candles.length - 1];
    if (Math.abs(cur.c - last) < 1e-8) return;
    candles[candles.length - 1] = {
      ...cur,
      c: last,
      h: Math.max(cur.h, last),
      l: Math.min(cur.l, last),
    };
    set({
      liveScenario: { ...base, candles },
      liveLabel: `LIVE ${s.symbol} · ${last.toFixed(quoteDigits(s.symbol))}`,
      liveError: null,
      replay: null,
    });
    get().tryAutoManage();
  },
  ingestBars: (candles, last) => {
    const s = get();
    if (!candles.length) return;
    let bars = candles;
    if (last && last > 0) {
      bars = candles.slice();
      const cur = bars[bars.length - 1];
      bars[bars.length - 1] = {
        ...cur,
        c: last,
        h: Math.max(cur.h, last),
        l: Math.min(cur.l, last),
      };
    }
    const live = scenarioFromBars(s.symbol, bars, s.tf);
    const px = last || bars.at(-1)?.c || 0;
    set({
      liveScenario: live,
      liveError: null,
      liveLabel: `LIVE ${s.symbol} · ${px.toFixed(quoteDigits(s.symbol))}`,
      replay: null,
    });
    get().tryAutoFill();
    get().tryAutoManage();
  },
  takeTrade: (side, kind, _src = "user") => {
    const s = get();
    if (s.position) return;
    if (challengeIndexLocked(s) && isIndexSymbol(s.symbol)) {
      toast.error("Flip $100: indices stay locked while equity is $200 or less.");
      return;
    }
    if (cryptoTradingLocked(s.symbol)) {
      toast.error("Crypto entries are weekend-only (New York time).");
      return;
    }
    const scenario = currentScenario(s);
    const setup = scenario.setup;
    const usingSetup = kind === "icc-retest" && side === withTrendSide(scenario.trend);
    const entry = usingSetup ? setup.entry : scenario.candles.at(-1)?.c ?? setup.entry;
    const sl = usingSetup
      ? setup.sl
      : side === "buy"
        ? entry - Math.abs(setup.entry - setup.sl)
        : entry + Math.abs(setup.entry - setup.sl);
    const tps = usingSetup
      ? setup.tps
      : setup.tps.map((tp) => {
          const r = tp - setup.entry;
          return side === setup.bias ? entry + r : entry - r;
        });
    const position: Position = {
      accountId: s.accountId,
      symbol: s.symbol,
      side,
      kind,
      entry,
      sl,
      initialSl: sl,
      tps,
      risk: fanPaperIds(s).reduce((n, id) => n + riskOn(s, id), 0),
      openedAt: Date.now(),
    };
    set({ position });
    protectBar = s.replay == null ? scenario.candles.length - 1 : s.replay;
    scheduleSave(get());
    const sendLive = Boolean(s.tl && s.brokerOn);
    if (!sendLive && s.tl && !s.brokerOn) {
      toast.message("Paper fill. Turn on Send to TradeLocker.");
    } else if (!sendLive && !s.tl) {
      toast.message("Paper fill. Log into TradeLocker to send live orders.");
    }
    if (sendLive && s.tl) {
      const session = s.tl;
      const accs = fanTlAccounts(s);
      const tpAt = autoCloseTarget(s.autoClose);
      const tpIdx = tpAt ? tpIndex(tpAt) : 1;
      const tp = tpIdx != null ? tps[tpIdx] : tps[1];
      void Promise.all(
        accs.map((acc) =>
          placeTradeLockerOrder({
            data: {
              env: session.env,
              accessToken: session.accessToken,
              accountId: acc.accountId,
              accNum: acc.accNum,
              symbol: s.symbol,
              side,
              qty: s.lots || 0.01,
              sl,
              tp,
            },
          }),
        ),
      ).then((results) => {
        const ok = results.filter((r) => r.ok);
        const bad = results.find((r) => !r.ok);
        const filled = ok.reduce((n, r) => n + (r.ok ? r.openPositions : 0), 0);
        if (ok.length && filled === 0) {
          toast.message(
            "Order accepted, nothing open on TradeLocker. Weekend FX/gold is closed — try BTCUSD.",
          );
        } else if (ok.length) {
          toast.success(
            `Open on TradeLocker · ${filled} position${filled === 1 ? "" : "s"} across ${ok.length} account${ok.length === 1 ? "" : "s"}`,
          );
        }
        if (bad && !bad.ok) toast.error(`TradeLocker: ${bad.error}`);
        const cur = get().position;
        if (cur && cur.openedAt === position.openedAt && ok[0] && ok[0].ok) {
          set({ position: { ...cur, tlOrderId: ok[0].orderId } });
        }
      });
    }
  },
  tryAutoFill: () => {
    const s = get();
    if (!s.armed || !s.paperOn || s.position) return false;
    if (challengeIndexLocked(s) && isIndexSymbol(s.symbol)) return false;
    if (cryptoTradingLocked(s.symbol)) return false;
    if (Date.now() < autoReadyAt) return false;
    const sc = currentScenario(s);
    const bar = s.replay == null ? sc.candles.length - 1 : s.replay;
    if (bar < sc.setup.retestIndex) {
      lastAutoKey = "";
      return false;
    }
    const t = sc.candles[bar]?.t ?? Date.now();
    const key = autoKeyOf(s.symbol, s.tf, t);
    if (lastAutoKey === key) return false;
    lastAutoKey = key;
    get().takeTrade(withTrendSide(sc.trend), "icc-retest", "auto");
    toast.success(
      s.tl && s.brokerOn
        ? `${sc.setup.bias.toUpperCase()} ${s.symbol} · auto-enter sent to Atlas`
        : `${sc.setup.bias.toUpperCase()} ${s.symbol} · auto-enter paper (Atlas not sending)`,
    );
    if (s.replay != null) get().tryAutoManage();
    return true;
  },
  tryAutoManage: () => {
    const s = get();
    const p = s.position;
    if (s.loginOpen || !p || !p.tps?.length) return false;
    const sc = currentScenario(s);
    const i = s.replay == null ? sc.candles.length - 1 : Math.min(s.replay, sc.candles.length - 1);
    if (protectBar >= 0 && i <= protectBar) return false;
    const c = sc.candles[Math.max(0, i)];
    if (!c) return false;
    const buy = p.side === "buy";
    const hi = c.h;
    const lo = c.l;
    let tagged = -1;
    for (let t = 0; t < p.tps.length; t++) {
      if (buy ? hi >= p.tps[t] : lo <= p.tps[t]) tagged = t;
      else break;
    }
    let sl = p.sl;
    if (s.trailOn && tagged >= 0) {
      const locked = tagged >= 2 ? p.tps[tagged - 2] : p.entry;
      const better = buy ? locked > sl : locked < sl;
      if (better) {
        sl = locked;
        set({ position: { ...p, sl } });
      }
    }
    const hitSl = buy ? lo <= sl : hi >= sl;
    if (hitSl) {
      get().closePosition("sl", { auto: true });
      toast.error(`${p.side.toUpperCase()} ${p.symbol} · stopped`);
      return true;
    }
    const target = autoCloseTarget(s.autoClose);
    if (!target) return false;
    const idx = tpIndex(target);
    if (idx == null) return false;
    const tp = p.tps[idx];
    if (tp == null) return false;
    const hitTp = buy ? hi >= tp : lo <= tp;
    if (!hitTp) return false;
    get().closePosition(target, { auto: true });
    toast.success(
      s.autoClose === "odds"
        ? `Auto-close ODDS · TP5 · ${p.symbol}`
        : `Auto-close ${target.toUpperCase()} · ${p.symbol}`,
    );
    return true;
  },
  closePosition: (at, opts) => {
    const s = get();
    const p = s.position;
    if (!p) return;
    const sc = currentScenario(s);
    const last = sc.candles.at(-1)?.c ?? p.entry;
    const idx = tpIndex(at);
    const exit =
      at === "market" ? last : at === "sl" ? p.sl : idx != null ? p.tps[idx] ?? last : last;
    const dir = p.side === "buy" ? 1 : -1;
    const rDist = Math.abs(p.entry - (p.initialSl ?? p.sl)) || 1;
    const r = (dir * (exit - p.entry)) / rDist;
    const auto = Boolean(opts?.auto);
    const note =
      at === "market"
        ? "Closed at market"
        : at === "sl"
          ? auto
            ? "Stopped at SL"
            : "Closed at SL"
          : auto
            ? `Auto-banked ${at.toUpperCase()} on continuation retest`
            : `Banked ${at.toUpperCase()} on ${p.kind === "icc-retest" ? "continuation retest" : "manual"}`;
    const ids = fanPaperIds(s);
    const entries: JournalEntry[] = ids.map((accountId) => ({
      id: uid(),
      accountId,
      symbol: p.symbol,
      side: p.side,
      kind: p.kind,
      pnl: r * riskOn(s, accountId),
      r,
      at: Date.now(),
      note: ids.length > 1 ? `${note} · copy ${ids.length}` : note,
    }));
    set({ position: null, journal: [...entries, ...s.journal] });
    lastAutoKey = autoKeyOf(p.symbol, s.tf, sc.candles.at(-1)?.t ?? Date.now());
    protectBar = -1;
    scheduleSave(get());
    const live = get();
    if (live.tl && live.brokerOn) {
      const accs = fanTlAccounts(live);
      void Promise.all(
        accs.map((acc) =>
          closeTradeLockerPosition({
            data: {
              env: live.tl!.env,
              accessToken: live.tl!.accessToken,
              accountId: acc.accountId,
              accNum: acc.accNum,
              qty: live.lots || 0.01,
            },
          }),
        ),
      ).then((results) => {
        const bad = results.find((r) => !r.ok);
        const closed = results.reduce((n, r) => n + (r.ok ? r.closed : 0), 0);
        if (bad && !bad.ok) toast.error(`TradeLocker close failed: ${bad.error}`);
        else if (closed === 0) {
          toast.message("Nothing open on TradeLocker to close. Desk flattened here.");
        } else {
          toast.success(`Closed ${closed} TradeLocker position${closed === 1 ? "" : "s"}`);
        }
      });
    }
  },
  flatten: () => {
    get().closePosition("market");
    set({ flattenAtClose: false });
  },
  setFlattenAtClose: (flattenAtClose) => {
    const s = get();
    if (flattenAtClose && s.position && isCashClosed(s.position.symbol)) {
      get().flatten();
      toast.message("Market already closed. Flattened at market.");
      return;
    }
    set({ flattenAtClose });
    scheduleSave(get());
    if (flattenAtClose) toast.message("Flatten at market close is on.");
  },
  setSessionHours: (n) => {
    set({
      sessionHours: n,
      sessionEnd: Date.now() + n * 60 * 60 * 1000,
      armed: true,
      paperOn: true,
    });
    scheduleSave(get());
  },
  tickSession: () => {
    const s = get();
    if (s.flattenAtClose && s.position && isCashClosed(s.position.symbol)) {
      toast.message(`Flattened ${s.position.symbol} at market close.`);
      get().flatten();
    }
    if (!s.sessionEnd) {
      set({ sessionEnd: Date.now() + s.sessionHours * 60 * 60 * 1000 });
      scheduleSave(get());
      return;
    }
    if (Date.now() < s.sessionEnd) return;
    if (s.position) get().flatten();
    set({
      armed: true,
      paperOn: true,
      sessionEnd: Date.now() + s.sessionHours * 60 * 60 * 1000,
    });
    scheduleSave(get());
  },
  resetDemo: () => {
    persistTl(null);
    set({
      ...defaults,
      journal: SEED_JOURNAL,
      position: null,
      replay: null,
      loginOpen: false,
      paperMode: true,
    });
    scheduleSave(get());
    void get().pullLive();
  },
}));

export function hydrateDesk() {
  if (typeof window === "undefined") return;
  autoReadyAt = Date.now() + 12_000;
  let parsed: Partial<DeskState> & { atlasAccounts?: TlSession["accounts"] } = {};
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    parsed = {};
  }

  let session: TlSession | null = null;
  try {
    const raw = localStorage.getItem(TL_KEY) ?? sessionStorage.getItem(TL_KEY);
    if (raw) {
      const loaded = JSON.parse(raw) as TlSession;
      if (loaded?.accessToken) session = loaded;
    }
  } catch {
    localStorage.removeItem(TL_KEY);
    sessionStorage.removeItem(TL_KEY);
  }

  if (session && (!session.accounts || session.accounts.length === 0) && parsed.atlasAccounts?.length) {
    session = { ...session, accounts: parsed.atlasAccounts };
  }
  if (session) {
    persistTl(session);
    sessionStorage.removeItem(TL_KEY);
  }

  const paperIds = new Set(ACCOUNTS.map((a) => a.id));
  const tlIds = new Set((session?.accounts ?? []).map((a) => a.id));
  const wanted = parsed.accountId;
  const accountId =
    wanted && tlIds.has(wanted)
      ? wanted
      : session?.accounts[0]?.id
        ? session.accounts[0].id
        : wanted && paperIds.has(wanted)
          ? wanted
          : "atlas";
  const sessionAlive =
    typeof parsed.sessionEnd === "number" && parsed.sessionEnd > Date.now();
  const tfOk =
    parsed.tf === 1 ||
    parsed.tf === 5 ||
    parsed.tf === 15 ||
    parsed.tf === 30 ||
    parsed.tf === 60;
  const symbolOk = parsed.symbol && SYMBOLS.includes(parsed.symbol);
  const challengeOn = parsed.challengeOn === true;

  useDesk.setState({
    accountId,
    symbol: symbolOk ? parsed.symbol : "BTCUSD",
    riskPct: (RISK_LEVELS as readonly number[]).includes(parsed.riskPct)
      ? parsed.riskPct
      : 0.01,
    armed: sessionAlive ? parsed.armed !== false : true,
    paperOn: parsed.paperOn !== false,
    candleStyle: parsed.candleStyle ?? "candles",
    tf: tfOk ? parsed.tf : 5,
    autoClose:
      parsed.autoClose === "off" ||
      parsed.autoClose === "tp1" ||
      parsed.autoClose === "tp2" ||
      parsed.autoClose === "odds" ||
      parsed.autoClose === "tp6"
        ? parsed.autoClose
        : "tp6",
    trailOn: parsed.trailOn !== false,
    brokerOn: challengeOn ? false : session ? parsed.brokerOn !== false : Boolean(parsed.brokerOn),
    journal: parsed.journal ?? SEED_JOURNAL,
    position:
      parsed.position && Array.isArray(parsed.position.tps) && parsed.position.tps.length
        ? {
            ...parsed.position,
            initialSl: parsed.position.initialSl ?? parsed.position.sl,
          }
        : null,
    paperMode: session ? false : parsed.paperMode === true,
    loginOpen: false,
    sessionHours:
      parsed.sessionHours === 1 ||
      parsed.sessionHours === 2 ||
      parsed.sessionHours === 4
        ? parsed.sessionHours
        : 3,
    sessionEnd: sessionAlive
      ? parsed.sessionEnd
      : Date.now() + 3 * 60 * 60 * 1000,
    tradeAll: challengeOn ? false : parsed.tradeAll !== false,
    flattenAtClose: parsed.flattenAtClose === true,
    paperStart:
      typeof parsed.paperStart === "number" && parsed.paperStart > 0
        ? parsed.paperStart
        : 100,
    challengeOn,
    challengeAt: typeof parsed.challengeAt === "number" ? parsed.challengeAt : null,
    lots: typeof parsed.lots === "number" && parsed.lots >= 0.01 ? parsed.lots : 0.01,
    tl: session,
    loginError: null,
  });
  if (parsed.position?.tps?.length) {
    const sc = currentScenario(useDesk.getState());
    protectBar = sc.candles.length - 1;
  }
}
