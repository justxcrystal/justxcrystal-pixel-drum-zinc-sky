import type { SymbolId } from "./types";

const NY = "America/New_York";

export interface MarketStatus {
  open: boolean;
  label: "Open" | "Closed";
  session: string;
  detail: string;
  clock: string;
}

function nyParts(now: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  return { weekday, hour, minute, mins: hour * 60 + minute };
}

function clockLabel(now: number) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(now));
}

function fxOpen(weekday: string, mins: number) {
  if (weekday === "Sat") return false;
  if (weekday === "Sun") return mins >= 17 * 60;
  if (weekday === "Fri") return mins < 17 * 60;
  return true;
}

function nasOpen(weekday: string, mins: number) {
  if (weekday === "Sat") return false;
  if (weekday === "Sun") return mins >= 18 * 60;
  if (weekday === "Fri") return mins < 17 * 60;
  if (mins >= 17 * 60 && mins < 18 * 60) return false;
  return true;
}

function fxSession(mins: number) {
  const asia = mins >= 19 * 60 || mins < 4 * 60;
  const london = mins >= 3 * 60 && mins < 12 * 60;
  const ny = mins >= 8 * 60 && mins < 17 * 60;
  const names: string[] = [];
  if (asia) names.push("Asia");
  if (london) names.push("London");
  if (ny) names.push("New York");
  return names.join(" / ") || "Off hours";
}

function nasSession(mins: number) {
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return "Cash (RTH)";
  return "Globex";
}

function fxDetail(open: boolean, weekday: string, mins: number) {
  if (open) {
    if (weekday === "Fri") return "Closes 5:00 PM ET";
    return "Closes Friday 5:00 PM ET";
  }
  if (weekday === "Sun" && mins < 17 * 60) return "Opens 5:00 PM ET";
  return "Opens Sunday 5:00 PM ET";
}

function nasDetail(open: boolean, weekday: string, mins: number) {
  if (open) {
    if (weekday === "Fri") return "Closes 5:00 PM ET";
    if (mins >= 16 * 60 && mins < 17 * 60) return "Halt 5:00–6:00 PM ET";
    return "Daily halt 5:00–6:00 PM ET";
  }
  if (weekday === "Sun" && mins < 18 * 60) return "Opens 6:00 PM ET";
  if (mins >= 17 * 60 && mins < 18 * 60) return "Opens 6:00 PM ET";
  return "Opens Sunday 6:00 PM ET";
}

export function marketStatus(symbol: SymbolId, now = Date.now()): MarketStatus {
  const clock = clockLabel(now);
  if (symbol === "BTCUSD" || symbol === "ETHUSD") {
    return {
      open: true,
      label: "Open",
      session: "Crypto · 24/7",
      detail: "Trades through the weekend",
      clock,
    };
  }

  const { weekday, mins } = nyParts(now);

  if (symbol === "NAS100" || symbol === "US30") {
    const open = nasOpen(weekday, mins);
    return {
      open,
      label: open ? "Open" : "Closed",
      session: open ? nasSession(mins) : weekendOrHalt(weekday, mins),
      detail: nasDetail(open, weekday, mins),
      clock,
    };
  }

  const open = fxOpen(weekday, mins);
  return {
    open,
    label: open ? "Open" : "Closed",
    session: open ? fxSession(mins) : "Weekend",
    detail: fxDetail(open, weekday, mins),
    clock,
  };
}

export function isCashClosed(symbol: SymbolId, now = Date.now()) {
  if (symbol === "BTCUSD" || symbol === "ETHUSD") {
    const { weekday, mins } = nyParts(now);
    if (weekday === "Sat") return true;
    if (weekday === "Sun") return mins < 18 * 60;
    if (weekday === "Fri") return mins >= 17 * 60;
    return false;
  }
  return !marketStatus(symbol, now).open;
}

export function sessionBoard(now = Date.now()) {
  const { weekday, mins } = nyParts(now);
  const marketOpen = fxOpen(weekday, mins);
  const asia = marketOpen && (mins >= 19 * 60 || mins < 4 * 60);
  const london = marketOpen && mins >= 3 * 60 && mins < 12 * 60;
  const ny = marketOpen && mins >= 8 * 60 && mins < 17 * 60;
  return {
    asia,
    london,
    ny,
    overlap: london && ny,
    clock: clockLabel(now),
    marketOpen,
  };
}

function zoneClock(now: number, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(now));
}

export function sessionClocks(now = Date.now()) {
  return {
    asia: zoneClock(now, "Asia/Tokyo"),
    london: zoneClock(now, "Europe/London"),
    ny: zoneClock(now, "America/New_York"),
  };
}

function weekendOrHalt(weekday: string, mins: number) {
  if (mins >= 17 * 60 && mins < 18 * 60 && weekday !== "Fri" && weekday !== "Sat") {
    return "Daily halt";
  }
  return "Weekend";
}
