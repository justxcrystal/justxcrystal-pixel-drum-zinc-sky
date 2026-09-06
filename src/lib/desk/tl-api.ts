import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const TL_ENVS = ["live", "demo", "bsa", "bsb"] as const;
export type TlEnv = (typeof TL_ENVS)[number];

const HOST: Record<TlEnv, string> = {
  live: "https://live.tradelocker.com/backend-api",
  demo: "https://demo.tradelocker.com/backend-api",
  bsa: "https://bsa.tradelocker.com/backend-api",
  bsb: "https://bsb.tradelocker.com/backend-api",
};

export type TlAccount = {
  id: string;
  accNum: number;
  accountId: string;
  name: string;
  currency: string;
  balance: number;
  equity: number;
  todayPnl: number;
};

export type TlSession = {
  env: TlEnv;
  email: string;
  server: string;
  accessToken: string;
  refreshToken?: string;
  accounts: TlAccount[];
};

const creds = z.object({
  email: z.string().min(3).max(200),
  password: z.string().min(1).max(200),
  server: z.string().min(1).max(120),
  env: z.enum(TL_ENVS),
});

type Json = Record<string, unknown>;

function asRecord(v: unknown): Json {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v : fallback;
}

function extractError(json: unknown, status: number): string {
  const o = asRecord(json);
  const msg = o.message ?? o.error ?? o.err ?? o.detail;
  const text = typeof msg === "string" ? msg.trim() : "";
  const lower = text.toLowerCase();
  if (lower.includes("server exists") || lower.includes("check if server")) {
    return "Server not found. Atlas DEMO uses server ATLAS.";
  }
  if (lower.includes("incorrect email") || lower.includes("incorrect password") || lower.includes("email or password")) {
    return "Incorrect email or password.";
  }
  if (text) return text;
  if (status === 401 || status === 403) return "Email, password, or server was rejected.";
  return `TradeLocker returned ${status}.`;
}

async function tlRequest(
  env: TlEnv,
  path: string,
  init: RequestInit,
  timeoutMs = 12_000,
): Promise<{ ok: true; json: unknown } | { ok: false; error: string; status: number }> {
  const url = `${HOST[env]}${path}`;
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = { message: text.slice(0, 180) };
      }
    }
    if (!res.ok) return { ok: false, error: extractError(json, res.status), status: res.status };
    return { ok: true, json };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, error: "TradeLocker timed out. Check live/demo and try again.", status: 0 };
    }
    return { ok: false, error: "Could not reach TradeLocker.", status: 0 };
  }
}

function tokenFrom(json: unknown): { accessToken: string; refreshToken: string } {
  const payload = asRecord(json);
  const inner = asRecord(payload.data ?? payload.result ?? payload);
  return {
    accessToken: str(inner.accessToken ?? inner.access_token ?? payload.accessToken),
    refreshToken: str(inner.refreshToken ?? inner.refresh_token ?? payload.refreshToken),
  };
}

function parseAccounts(json: unknown): Array<Json> {
  if (Array.isArray(json)) return json.filter((x) => x && typeof x === "object") as Json[];
  const o = asRecord(json);
  for (const key of ["accounts", "data", "items", "result", "instruments", "positions"]) {
    const v = o[key];
    if (Array.isArray(v)) return v.filter((x) => x && typeof x === "object") as Json[];
  }
  return [];
}

function toAccount(raw: Json, index: number): TlAccount {
  const accNum = num(raw.accNum ?? raw.accnum ?? raw.index, index);
  const accountId = str(raw.id ?? raw.accountId ?? raw.account_id, String(accNum));
  const name = str(
    raw.name ?? raw.accountName ?? raw.account_name ?? raw.label,
    `Account ${accNum}`,
  );
  return {
    id: `${accountId}:${accNum}`,
    accNum,
    accountId,
    name,
    currency: str(raw.currency ?? raw.currencyCode, "USD"),
    balance: num(raw.balance ?? raw.accountBalance),
    equity: num(raw.equity ?? raw.accountEquity ?? raw.balance ?? raw.accountBalance),
    todayPnl: num(raw.todayPnl ?? raw.dailyPnl ?? raw.pnlToday),
  };
}

async function enrichAccount(
  env: TlEnv,
  token: string,
  account: TlAccount,
): Promise<TlAccount> {
  const res = await tlRequest(
    env,
    "/trade/accounts",
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accNum: String(account.accNum),
      },
    },
    5_000,
  );
  if (!res.ok) return account;
  const o = asRecord(res.json);
  const inner = asRecord(o.data ?? o.account ?? o.result ?? o);
  return {
    ...account,
    name: str(inner.name ?? inner.accountName, account.name),
    currency: str(inner.currency, account.currency),
    balance: num(inner.balance ?? inner.accountBalance, account.balance),
    equity: num(inner.equity ?? inner.accountEquity ?? inner.balance, account.equity),
    todayPnl: num(inner.todayPnl ?? inner.dailyPnl ?? inner.pnl, account.todayPnl),
  };
}

async function keycloakPassword(email: string, password: string) {
  const attempts = [
    { client_id: "frontend-web-live", username: email },
    { client_id: "frontend-app", username: email },
  ];
  let last = "Keycloak login failed.";
  for (const attempt of attempts) {
    try {
      const res = await fetch(
        "https://auth.tradelocker.com/realms/tradelocker/protocol/openid-connect/token",
        {
          method: "POST",
          signal: AbortSignal.timeout(12_000),
          headers: {
            accept: "application/json",
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "password",
            client_id: attempt.client_id,
            username: attempt.username,
            password,
            scope: "openid",
          }),
        },
      );
      const json = asRecord(await res.json().catch(() => ({})));
      if (res.ok) {
        const accessToken = str(json.access_token);
        const refreshToken = str(json.refresh_token);
        if (accessToken) return { ok: true as const, accessToken, refreshToken };
      }
      last = str(json.error_description ?? json.error, `Keycloak ${res.status}`);
    } catch {
      last = "Could not reach auth.tradelocker.com.";
    }
  }
  return { ok: false as const, error: last };
}

export const loginTradeLocker = createServerFn({ method: "POST" })
  .validator(creds)
  .handler(async ({ data }) => {
    const email = data.email.trim();
    const server = data.server.trim() || "ATLAS";
    const order: TlEnv[] = ["bsb", "demo", "bsa", "live"].filter(
      (v, i, a) => a.indexOf(v) === i,
    ) as TlEnv[];
    if (data.env && !order.includes(data.env)) order.unshift(data.env);

    let lastError = "Could not sign in to ATLAS.";
    let sawPassword = false;
    for (const env of order) {
      const auth = await tlRequest(env, "/auth/jwt/token", {
        method: "POST",
        body: JSON.stringify({
          email,
          password: data.password,
          server,
        }),
      });
      if (!auth.ok) {
        lastError = auth.error;
        if (/incorrect email|incorrect password/i.test(auth.error)) sawPassword = true;
        continue;
      }
      const tokens = tokenFrom(auth.json);
      if (!tokens.accessToken) continue;

      let list = await tlRequest(env, "/auth/jwt/all-accounts", {
        method: "GET",
        headers: { authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!list.ok) {
        list = await tlRequest(env, "/auth/jwt/accounts", {
          method: "GET",
          headers: { authorization: `Bearer ${tokens.accessToken}` },
        });
      }
      const raw = list.ok ? parseAccounts(list.json) : [];
      const base = raw.map(toAccount);
      const accounts = await Promise.all(
        base.slice(0, 8).map((a) => enrichAccount(env, tokens.accessToken, a)),
      );
      const session: TlSession = {
        env,
        email,
        server,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || undefined,
        accounts,
      };
      return { ok: true as const, session };
    }

    return {
      ok: false as const,
      error: sawPassword ? "Incorrect email or password for ATLAS." : lastError,
    };
  });

export const refreshTradeLocker = createServerFn({ method: "POST" })
  .validator(
    z.object({
      env: z.enum(TL_ENVS),
      accessToken: z.string().min(8),
      refreshToken: z.string().optional(),
      accounts: z.array(
        z.object({
          id: z.string(),
          accNum: z.number(),
          accountId: z.string(),
          name: z.string(),
          currency: z.string(),
          balance: z.number(),
          equity: z.number(),
          todayPnl: z.number(),
        }),
      ),
    }),
  )
  .handler(async ({ data }) => {
    let accessToken = data.accessToken;
    let refreshToken = data.refreshToken;
    if (refreshToken) {
      const refreshed = await tlRequest(data.env, "/auth/jwt/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      });
      if (refreshed.ok) {
        const tokens = tokenFrom(refreshed.json);
        accessToken = tokens.accessToken || accessToken;
        refreshToken = tokens.refreshToken || refreshToken;
      }
    }
    const accounts = await Promise.all(
      data.accounts.slice(0, 8).map((a) => enrichAccount(data.env, accessToken, a)),
    );
    return { ok: true as const, accessToken, refreshToken, accounts };
  });

const ALIAS: Record<string, string[]> = {
  XAUUSD: ["XAUUSD", "XAU/USD", "GOLD", "XAU", "XAUUSDM", "GOLDUSD", "SPOTGOLD"],
  EURUSD: ["EURUSD", "EUR/USD", "EURUSDM"],
  GBPUSD: ["GBPUSD", "GBP/USD", "GBPUSDM"],
  USDJPY: ["USDJPY", "USD/JPY", "USDJPYM"],
  USDCHF: ["USDCHF", "USD/CHF", "USDCHFM"],
  AUDUSD: ["AUDUSD", "AUD/USD", "AUDUSDM"],
  USDCAD: ["USDCAD", "USD/CAD", "USDCADM"],
  NZDUSD: ["NZDUSD", "NZD/USD", "NZDUSDM"],
  NAS100: [
    "NAS100",
    "NASDAQ100",
    "NASDAQ",
    "USTEC",
    "US100",
    "NDX",
    "NAS100M",
    "USATECH",
    "USTECH",
  ],
  US30: ["US30", "DJ30", "DJI", "DOW", "USA30", "WALLSTREET", "US30M", "DOWJONES"],
  BTCUSD: ["BTCUSD", "BTC/USD", "BTCUSDT", "BTCUSDC", "XBTUSD", "BITCOIN", "BTC"],
  ETHUSD: ["ETHUSD", "ETH/USD", "ETHUSDT", "ETHUSDC", "ETHER", "ETHEREUM", "ETH"],
};

function norm(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function rowLabel(row: Json) {
  return str(
    row.name ??
      row.symbol ??
      row.instrument ??
      row.ticker ??
      row.shortName ??
      row.fullName ??
      row.displayName ??
      row.code ??
      row.pair,
  );
}

function collectInstruments(json: unknown, out: Json[] = []): Json[] {
  if (Array.isArray(json)) {
    for (const item of json) collectInstruments(item, out);
    return out;
  }
  const o = asRecord(json);
  if (rowLabel(o) || o.tradableInstrumentId || o.instrumentId) out.push(o);
  for (const key of [
    "instruments",
    "tradableInstruments",
    "availableInstruments",
    "data",
    "d",
    "items",
    "result",
    "list",
  ]) {
    if (o[key] != null) collectInstruments(o[key], out);
  }
  return out;
}

function instrumentNames(rows: Json[]) {
  const names: string[] = [];
  for (const row of rows) {
    const n = rowLabel(row);
    if (n && !names.includes(n)) names.push(n);
  }
  return names;
}

function scoreName(name: string, aliases: string[]) {
  let best = 0;
  for (const a of aliases) {
    if (name === a) best = Math.max(best, 100);
    else if (name.startsWith(a) && name.includes("USD")) best = Math.max(best, 90);
    else if (name.includes(a) && name.includes("USD")) best = Math.max(best, 80);
    else if (name.startsWith(a)) best = Math.max(best, 70);
    else if (name.includes(a)) best = Math.max(best, 55);
    else if (a.startsWith(name) && name.length >= 6) best = Math.max(best, 50);
  }
  return best;
}

function fromRow(row: Json, symbol: string) {
  const id = str(row.tradableInstrumentId ?? row.instrumentId ?? row.id);
  const routes = Array.isArray(row.routes) ? row.routes : [];
  let routeId = str(row.routeId);
  let infoRouteId = str(row.infoRouteId);
  for (const r of routes) {
    const rec = asRecord(r);
    const typ = str(rec.type ?? rec.name).toUpperCase();
    const rid = str(rec.id ?? rec.routeId);
    if (typ === "TRADE" || typ === "TRADING") routeId = rid;
    if (typ === "INFO") infoRouteId = rid;
    if (!routeId) routeId = rid;
  }
  if (!infoRouteId) infoRouteId = routeId;
  if (!id) return null;
  return {
    id,
    routeId,
    infoRouteId,
    name: rowLabel(row) || symbol,
  };
}

function pickInstrument(
  rows: Json[],
  symbol: string,
): { id: string; routeId: string; infoRouteId: string; name: string } | null {
  const aliases = (ALIAS[symbol] ?? [symbol]).map(norm);
  let best: Json | null = null;
  let bestScore = 0;
  for (const row of rows) {
    const name = norm(rowLabel(row));
    if (!name) continue;
    const s = scoreName(name, aliases);
    if (s > bestScore) {
      bestScore = s;
      best = row;
    }
  }
  if (!best || bestScore < 50) return null;
  return fromRow(best, symbol);
}

function missingInstrument(symbol: string, rows: Json[]) {
  const names = instrumentNames(rows).slice(0, 20);
  if (!names.length) {
    return `No instruments on this Atlas account (empty list). ${symbol} cannot trade.`;
  }
  return `No ${symbol} on this Atlas account. TradeLocker lists: ${names.join(", ")}`;
}

async function loadInstruments(
  env: TlEnv,
  accessToken: string,
  accountId: string,
  accNum: number,
) {
  const primary = await tlRequest(
    env,
    `/trade/accounts/${accountId}/instruments`,
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        accNum: String(accNum),
      },
    },
    15_000,
  );
  if (primary.ok && collectInstruments(primary.json).length) return primary;
  const fallback = await tlRequest(
    env,
    `/trade/instruments`,
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        accNum: String(accNum),
      },
    },
    15_000,
  );
  return fallback.ok ? fallback : primary;
}

const PINNED: Record<string, string> = {
  BTCUSD: "17412",
};

async function resolveInstrument(
  env: TlEnv,
  accessToken: string,
  accountId: string,
  accNum: number,
  symbol: string,
) {
  const instRes = await loadInstruments(env, accessToken, accountId, accNum);
  if (!instRes.ok) return { ok: false as const, error: instRes.error };
  const rows = collectInstruments(instRes.json);
  const pin = PINNED[symbol];
  let pinnedJson: unknown = null;
  if (pin) {
    const pinned = await tlRequest(
      env,
      `/trade/accounts/${accountId}/instruments/${pin}`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${accessToken}`,
          accNum: String(accNum),
        },
      },
    );
    if (pinned.ok) {
      pinnedJson = pinned.json;
      for (const row of collectInstruments(pinned.json)) rows.unshift(row);
    }
  }
  let inst = pickInstrument(rows, symbol);
  if (inst && !inst.routeId) {
    const detail = await tlRequest(
      env,
      `/trade/accounts/${accountId}/instruments/${inst.id}`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${accessToken}`,
          accNum: String(accNum),
        },
      },
    );
    if (detail.ok) {
      const filled = fromRow(asRecord(asRecord(detail.json).d ?? detail.json), symbol);
      if (filled) inst = filled;
    }
  }
  if (!inst?.routeId && pinnedJson) {
    inst = fromRow(asRecord(asRecord(pinnedJson).d ?? pinnedJson), symbol);
  }
  if (!inst?.routeId) {
    return { ok: false as const, error: missingInstrument(symbol, rows) };
  }
  return { ok: true as const, inst };
}

export const placeTradeLockerOrder = createServerFn({ method: "POST" })
  .validator(
    z.object({
      env: z.enum(TL_ENVS),
      accessToken: z.string().min(8),
      accountId: z.string().min(1),
      accNum: z.number(),
      symbol: z.string().min(2),
      side: z.enum(["buy", "sell"]),
      qty: z.number().positive(),
      sl: z.number().optional(),
      tp: z.number().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const found = await resolveInstrument(
      data.env,
      data.accessToken,
      data.accountId,
      data.accNum,
      data.symbol,
    );
    if (!found.ok) return found;
    const inst = found.inst;
    const body: Json = {
      qty: String(data.qty),
      side: data.side,
      type: "market",
      validity: "IOC",
      tradableInstrumentId: inst.id,
      routeId: inst.routeId,
    };
    if (data.sl != null) {
      body.stopLoss = data.sl;
      body.stopLossType = "absolute";
    }
    if (data.tp != null) {
      body.takeProfit = data.tp;
      body.takeProfitType = "absolute";
    }
    const order = await tlRequest(data.env, `/trade/accounts/${data.accountId}/orders`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${data.accessToken}`,
        accNum: String(data.accNum),
      },
      body: JSON.stringify(body),
    });
    if (!order.ok) return { ok: false as const, error: order.error };
    const rec = asRecord(order.json);
    const d = asRecord(rec.d ?? rec.data ?? rec);
    await new Promise((r) => setTimeout(r, 900));
    const posList = await tlRequest(data.env, `/trade/accounts/${data.accountId}/positions`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${data.accessToken}`,
        accNum: String(data.accNum),
      },
    });
    const posPayload = posList.ok ? asRecord(posList.json) : {};
    const positions = posList.ok ? parseAccounts(posPayload.d ?? posPayload.data ?? posList.json) : [];
    return {
      ok: true as const,
      orderId: str(d.orderId ?? d.id ?? rec.orderId ?? positions[0]?.id),
      instrument: inst.name,
      openPositions: positions.length,
    };
  });

export const closeTradeLockerPosition = createServerFn({ method: "POST" })
  .validator(
    z.object({
      env: z.enum(TL_ENVS),
      accessToken: z.string().min(8),
      accountId: z.string().min(1),
      accNum: z.number(),
      positionId: z.string().optional(),
      qty: z.number().positive().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const list = await tlRequest(data.env, `/trade/accounts/${data.accountId}/positions`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${data.accessToken}`,
        accNum: String(data.accNum),
      },
    });
    if (!list.ok) return { ok: false as const, error: list.error };
    const payload = asRecord(list.json);
    const rows = parseAccounts(payload.d ?? payload.data ?? list.json);
    if (!rows.length) return { ok: true as const, closed: 0 };
    let closed = 0;
    for (const row of rows) {
      const positionId = str(row.id ?? row.positionId);
      if (!positionId) continue;
      const res = await tlRequest(data.env, `/trade/positions/${positionId}`, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${data.accessToken}`,
          accNum: String(data.accNum),
        },
        body: JSON.stringify({ qty: data.qty != null ? String(data.qty) : "0" }),
      });
      if (res.ok) closed += 1;
    }
    return { ok: true as const, closed };
  });

export type LiveBar = { t: number; o: number; h: number; l: number; c: number };

function parseBars(json: unknown): LiveBar[] {
  const rec = asRecord(json);
  const d = asRecord(rec.d ?? rec.data ?? rec);
  const raw = d.barDetails ?? d.bars ?? d.history ?? rec.barDetails;
  const rows = Array.isArray(raw) ? raw : parseAccounts(d);
  const out: LiveBar[] = [];
  for (const row of rows) {
    const o = asRecord(row as Json);
    let t = num(o.t ?? o.time ?? o.timestamp ?? o.ts ?? o.barTime);
    const open = num(o.o ?? o.open ?? o.openPrice);
    const high = num(o.h ?? o.high ?? o.highPrice);
    const low = num(o.l ?? o.low ?? o.lowPrice);
    const close = num(o.c ?? o.close ?? o.closePrice ?? o.last ?? o.price);
    if (!Number.isFinite(t) || t <= 0) continue;
    if (!Number.isFinite(open) || !Number.isFinite(close)) continue;
    if (t < 1e12) t *= 1000;
    out.push({
      t,
      o: open,
      h: Number.isFinite(high) ? high : Math.max(open, close),
      l: Number.isFinite(low) ? low : Math.min(open, close),
      c: close,
    });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function parseQuote(json: unknown): number {
  const rec = asRecord(json);
  const d = asRecord(rec.d ?? rec.data ?? rec);
  const row = Array.isArray(d.quotes) ? asRecord(d.quotes[0] as Json) : d;
  const last = num(
    row.last ??
      row.lp ??
      row.lastPrice ??
      row.price ??
      rec.last ??
      rec.price,
  );
  if (last) return last;
  const bid = num(row.bid ?? row.bidPrice ?? row.bp ?? rec.bid);
  const ask = num(row.ask ?? row.askPrice ?? row.ap ?? rec.ask);
  if (bid && ask) return (bid + ask) / 2;
  return bid || ask;
}

function applyQuote(candles: LiveBar[], last: number): LiveBar[] {
  if (!last || !candles.length) return candles;
  const next = candles.slice();
  const cur = { ...next[next.length - 1] };
  cur.c = last;
  cur.h = Math.max(cur.h, last);
  cur.l = Math.min(cur.l, last);
  next[next.length - 1] = cur;
  return next;
}

const RES: Record<number, string[]> = {
  1: ["1m", "1M", "1", "M1"],
  5: ["5m", "5M", "5", "M5"],
  15: ["15m", "15M", "15", "M15"],
  30: ["30m", "30M", "30", "M30"],
  60: ["1H", "1h", "60", "H1"],
};

export const fetchLiveMarket = createServerFn({ method: "POST" })
  .validator(
    z.object({
      env: z.enum(TL_ENVS),
      accessToken: z.string().min(8),
      accountId: z.string().min(1),
      accNum: z.number(),
      symbol: z.string().min(2),
      tf: z.number(),
    }),
  )
  .handler(async ({ data }) => {
    const found = await resolveInstrument(
      data.env,
      data.accessToken,
      data.accountId,
      data.accNum,
      data.symbol,
    );
    if (!found.ok) return found;
    const inst = found.inst;
    const tf = data.tf === 1 || data.tf === 5 || data.tf === 30 || data.tf === 60 ? data.tf : 15;
    const toMs = Date.now();
    const fromMs = toMs - tf * 60 * 1000 * 180;
    let candles: LiveBar[] = [];
    const resolutions = RES[tf] ?? RES[15];
    for (const resolution of resolutions) {
      if (candles.length >= 20) break;
      for (const asSeconds of [false, true]) {
        const qs = new URLSearchParams({
          tradableInstrumentId: inst.id,
          routeId: inst.infoRouteId || inst.routeId,
          resolution,
          from: String(asSeconds ? Math.floor(fromMs / 1000) : fromMs),
          to: String(asSeconds ? Math.floor(toMs / 1000) : toMs),
        });
        const hist = await tlRequest(data.env, `/trade/history?${qs.toString()}`, {
          method: "GET",
          headers: {
            authorization: `Bearer ${data.accessToken}`,
            accNum: String(data.accNum),
          },
        }, 15_000);
        if (!hist.ok) continue;
        const parsed = parseBars(hist.json);
        if (parsed.length > candles.length) candles = parsed;
        if (candles.length >= 20) break;
      }
    }
    const quoteQs = new URLSearchParams({
      tradableInstrumentId: inst.id,
      routeId: inst.infoRouteId || inst.routeId,
    });
    const quoteRes = await tlRequest(data.env, `/trade/quotes?${quoteQs.toString()}`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${data.accessToken}`,
        accNum: String(data.accNum),
      },
    }, 8_000);
    const last = quoteRes.ok ? parseQuote(quoteRes.json) : 0;
    if (last && candles.length) candles = applyQuote(candles, last);
    else if (last && !candles.length) {
      const t = Date.now();
      candles = [{ t, o: last, h: last, l: last, c: last }];
    }
    if (candles.length < 2) {
      return { ok: false as const, error: `TradeLocker returned ${candles.length} bars for ${inst.name}.` };
    }
    const posRes = await tlRequest(data.env, `/trade/accounts/${data.accountId}/positions`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${data.accessToken}`,
        accNum: String(data.accNum),
      },
    });
    const posPayload = posRes.ok ? asRecord(posRes.json) : {};
    const positions = posRes.ok ? parseAccounts(posPayload.d ?? posPayload.data ?? posRes.json) : [];
    return {
      ok: true as const,
      instrument: inst.name,
      instrumentId: inst.id,
      candles,
      last: last || candles.at(-1)?.c || 0,
      openPositions: positions.length,
    };
  });

export const fetchLiveQuote = createServerFn({ method: "POST" })
  .validator(
    z.object({
      env: z.enum(TL_ENVS),
      accessToken: z.string().min(8),
      accountId: z.string().min(1),
      accNum: z.number(),
      symbol: z.string().min(2),
    }),
  )
  .handler(async ({ data }) => {
    const found = await resolveInstrument(
      data.env,
      data.accessToken,
      data.accountId,
      data.accNum,
      data.symbol,
    );
    if (!found.ok) return found;
    const inst = found.inst;
    const quoteQs = new URLSearchParams({
      tradableInstrumentId: inst.id,
      routeId: inst.infoRouteId || inst.routeId,
    });
    const quoteRes = await tlRequest(data.env, `/trade/quotes?${quoteQs.toString()}`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${data.accessToken}`,
        accNum: String(data.accNum),
      },
    }, 8_000);
    if (!quoteRes.ok) return { ok: false as const, error: quoteRes.error };
    const last = parseQuote(quoteRes.json);
    if (!last) return { ok: false as const, error: `No quote for ${inst.name}.` };
    return { ok: true as const, last, instrument: inst.name };
  });

const CB_GRAIN: Record<number, number> = { 1: 60, 5: 300, 15: 900, 30: 900, 60: 3600 };

async function jsonGet(url: string, ms = 10_000): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(ms),
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0 MeridianDesk" },
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

function parseCoinbaseCandles(rows: unknown): LiveBar[] {
  if (!Array.isArray(rows)) return [];
  const out: LiveBar[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const t = Number(row[0]);
    const l = Number(row[1]);
    const h = Number(row[2]);
    const o = Number(row[3]);
    const c = Number(row[4]);
    if (!t || !o || !c) continue;
    out.push({ t: t < 1e12 ? t * 1000 : t, o, h, l, c });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

async function publicCryptoLast(symbol: string): Promise<number> {
  const spec =
    symbol === "ETHUSD"
      ? { cb: "ETH-USD", binance: "ETHUSDT", stamp: "ethusd", min: 40 }
      : { cb: "BTC-USD", binance: "BTCUSDT", stamp: "btcusd", min: 1000 };
  const tries = [
    async () => num(asRecord(await jsonGet(`https://api.exchange.coinbase.com/products/${spec.cb}/ticker`, 6_000)).price),
    async () =>
      num(asRecord(asRecord(await jsonGet(`https://api.coinbase.com/v2/prices/${spec.cb}/spot`, 6_000)).data).amount),
    async () => num(asRecord(await jsonGet(`https://api.binance.us/api/v3/ticker/price?symbol=${spec.binance}`, 6_000)).price),
    async () => num(asRecord(await jsonGet(`https://www.bitstamp.net/api/v2/ticker/${spec.stamp}/`, 6_000)).last),
  ];
  for (const tryOne of tries) {
    try {
      const px = await tryOne();
      if (px > spec.min) return px;
    } catch {
      /* next */
    }
  }
  return 0;
}

export const fetchPublicMarket = createServerFn({ method: "POST" })
  .validator(z.object({ symbol: z.string(), tf: z.number() }))
  .handler(async ({ data }) => {
    if (data.symbol !== "BTCUSD" && data.symbol !== "ETHUSD") {
      return { ok: false as const, error: "No public feed for this symbol." };
    }
    const product = data.symbol === "ETHUSD" ? "ETH-USD" : "BTC-USD";
    const binance = data.symbol === "ETHUSD" ? "ETHUSDT" : "BTCUSDT";
    const grain = CB_GRAIN[data.tf] ?? 300;
    let candles: LiveBar[] = [];
    try {
      const rows = await jsonGet(
        `https://api.exchange.coinbase.com/products/${product}/candles?granularity=${grain}&limit=150`,
      );
      candles = parseCoinbaseCandles(rows);
    } catch {
      try {
        const interval =
          data.tf === 60 ? "1h" : data.tf === 1 ? "1m" : data.tf === 15 ? "15m" : data.tf === 30 ? "30m" : "5m";
        const rows = await jsonGet(
          `https://api.binance.us/api/v3/klines?symbol=${binance}&interval=${interval}&limit=150`,
        );
        if (Array.isArray(rows)) {
          for (const row of rows) {
            if (!Array.isArray(row) || row.length < 5) continue;
            candles.push({
              t: Number(row[0]),
              o: Number(row[1]),
              h: Number(row[2]),
              l: Number(row[3]),
              c: Number(row[4]),
            });
          }
        }
      } catch {
        candles = [];
      }
    }
    const last = (await publicCryptoLast(data.symbol)) || candles.at(-1)?.c || 0;
    if (last && candles.length) {
      const i = candles.length - 1;
      candles[i] = {
        ...candles[i],
        c: last,
        h: Math.max(candles[i].h, last),
        l: Math.min(candles[i].l, last),
      };
    }
    if (candles.length < 10) {
      return { ok: false as const, error: `Public ${data.symbol} feed returned ${candles.length} bars.` };
    }
    return { ok: true as const, instrument: data.symbol, candles, last };
  });

export const fetchPublicQuote = createServerFn({ method: "POST" })
  .validator(z.object({ symbol: z.string() }))
  .handler(async ({ data }) => {
    if (data.symbol !== "BTCUSD" && data.symbol !== "ETHUSD") {
      return { ok: false as const, error: "No public quote." };
    }
    const last = await publicCryptoLast(data.symbol);
    if (!last) return { ok: false as const, error: "Public quote empty." };
    return { ok: true as const, last, instrument: data.symbol };
  });

