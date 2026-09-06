import { isSameDay, signedMoney, signedR } from "./format";
import type { JournalEntry } from "./types";

function kindLabel(kind: JournalEntry["kind"]) {
  if (kind === "icc-retest") return "continuation retest";
  return "manual";
}

export function trophyDay(journal: JournalEntry[], now = Date.now()) {
  const today = journal.filter((j) => isSameDay(j.at, now)).sort((a, b) => a.at - b.at);
  const rows = today.length
    ? today
    : journal.slice().sort((a, b) => b.at - a.at).slice(0, 8).reverse();
  const pnl = rows.reduce((n, j) => n + j.pnl, 0);
  const r = rows.reduce((n, j) => n + j.r, 0);
  const wins = rows.filter((j) => j.pnl > 0).length;
  const losses = rows.filter((j) => j.pnl < 0).length;
  const stamp = new Date(rows.at(-1)?.at ?? now);
  return { rows, pnl, r, wins, losses, stamp, isToday: today.length > 0 };
}

export function trophyCaption(journal: JournalEntry[], now = Date.now()) {
  const d = trophyDay(journal, now);
  const when = d.stamp.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const lines = [
    d.pnl >= 0 ? "Landed it." : "Fought it. Still standing.",
    "",
    `Meridian ICC / AMD · ${when}`,
    `${signedMoney(d.pnl)} · ${signedR(d.r)} · ${d.wins}W / ${d.losses}L`,
    "",
    ...d.rows.map(
      (j) =>
        `${j.side.toUpperCase()} ${j.symbol} · ${kindLabel(j.kind)} · ${signedMoney(j.pnl)} (${signedR(j.r)})`,
    ),
    "",
    "JustxCrystal Capital · Meridian ICC / AMD",
  ];
  return lines.join("\n");
}

export function trophyTweetUrl(caption: string) {
  const text = caption.slice(0, 250);
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export async function renderTrophyPng(journal: JournalEntry[]): Promise<Blob> {
  const d = trophyDay(journal);
  const w = 1080;
  const h = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable.");

  ctx.fillStyle = "#0b0b0d";
  ctx.fillRect(0, 0, w, h);

  const griffin = new Image();
  griffin.src = "/griffin.png";
  try {
    await griffin.decode();
    ctx.globalAlpha = 0.14;
    const gs = 720;
    ctx.drawImage(griffin, (w - gs) / 2, 280, gs, gs);
    ctx.globalAlpha = 1;
  } catch {
    /* photo still works without mark */
  }

  ctx.fillStyle = "#8b8b93";
  ctx.font = "600 22px 'IBM Plex Mono', ui-monospace, monospace";
  ctx.fillText("MERIDIAN", 72, 88);
  ctx.fillStyle = "#f0f0f2";
  ctx.font = "600 54px Figtree, ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("ICC / AMD desk", 72, 154);
  ctx.fillStyle = "#5c5c64";
  ctx.font = "400 24px Figtree, ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(
    d.stamp.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
    72,
    198,
  );

  ctx.fillStyle = d.pnl >= 0 ? "#5dcaa5" : "#e07a72";
  ctx.font = "700 92px 'IBM Plex Mono', ui-monospace, monospace";
  ctx.fillText(signedMoney(d.pnl, 0), 72, 320);
  ctx.fillStyle = "#f0f0f2";
  ctx.font = "500 32px 'IBM Plex Mono', ui-monospace, monospace";
  ctx.fillText(
    `${signedR(d.r)}   ${d.wins}W / ${d.losses}L   ${d.rows.length} fills`,
    72,
    372,
  );

  ctx.fillStyle = "#c4a35a";
  ctx.font = "600 22px Figtree, ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(d.pnl >= 0 ? "THE CATCH" : "THE FIGHT", 72, 430);

  let y = 470;
  const show = d.rows.slice(0, 8);
  for (const j of show) {
    ctx.fillStyle = "#141416";
    roundRect(ctx, 72, y, w - 144, 86, 22);
    ctx.fill();
    ctx.fillStyle = "#f0f0f2";
    ctx.font = "600 26px Figtree, ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(`${j.side.toUpperCase()}  ${j.symbol}`, 96, y + 36);
    ctx.fillStyle = "#8b8b93";
    ctx.font = "400 20px Figtree, ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(kindLabel(j.kind), 96, y + 64);
    ctx.fillStyle = j.pnl >= 0 ? "#5dcaa5" : "#e07a72";
    ctx.font = "600 26px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillText(signedMoney(j.pnl), w - 96, y + 36);
    ctx.fillStyle = "#8b8b93";
    ctx.font = "400 20px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.fillText(signedR(j.r), w - 96, y + 64);
    ctx.textAlign = "left";
    y += 98;
  }

  ctx.fillStyle = "#5c5c64";
  ctx.font = "400 20px Figtree, ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("JustxCrystal Capital  ·  Meridian ICC / AMD", 72, h - 64);

  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not build trophy photo."));
    }, "image/png");
  });
}

export type MockupScene = "pool" | "riad";

const MOCKUPS: Record<MockupScene, { src: string; screen: { x: number; y: number; w: number; h: number } }> = {
  pool: { src: "/mockup-pool.jpg", screen: { x: 0.20, y: 0.385, w: 0.60, h: 0.21 } },
  riad: { src: "/mockup-riad.jpg", screen: { x: 0.24, y: 0.405, w: 0.52, h: 0.20 } },
};

export function tradeCaption(trade: JournalEntry) {
  const when = new Date(trade.at).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return [
    `${trade.symbol} ${trade.side.toUpperCase()}`,
    `${kindLabel(trade.kind)} · ${signedMoney(trade.pnl)} · ${signedR(trade.r)}`,
    when,
    "",
    "JUSTXCRYSTAL · Meridian ICC / AMD",
  ].join("\n");
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Mockup failed to load."));
    img.src = src;
  });
}

function paintScreenChart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  candles: { o: number; h: number; l: number; c: number }[],
  trade: JournalEntry,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = "#0c0e12";
  ctx.fillRect(x, y, w, h);

  const bars = candles.slice(-48);
  const pad = h * 0.16;
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of bars) {
    lo = Math.min(lo, c.l);
    hi = Math.max(hi, c.h);
  }
  const span = Math.max(hi - lo, 1e-8);
  const bw = w / Math.max(bars.length, 1);
  const yOf = (px: number) => y + pad + (1 - (px - lo) / span) * (h - pad * 2);

  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const gy = y + (h * i) / 4;
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x + w, gy);
    ctx.stroke();
  }

  bars.forEach((c, i) => {
    const up = c.c >= c.o;
    ctx.strokeStyle = up ? "#5dcaa5" : "#e07a72";
    ctx.fillStyle = ctx.strokeStyle;
    const cx = x + i * bw + bw * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, yOf(c.h));
    ctx.lineTo(cx, yOf(c.l));
    ctx.lineWidth = Math.max(1, bw * 0.12);
    ctx.stroke();
    const top = yOf(Math.max(c.o, c.c));
    const bot = yOf(Math.min(c.o, c.c));
    ctx.fillRect(cx - bw * 0.28, top, Math.max(1.2, bw * 0.56), Math.max(1.2, bot - top));
  });

  ctx.fillStyle = "rgba(12,14,18,0.72)";
  ctx.fillRect(x + 10, y + 10, Math.min(w * 0.72, 420), 78);
  ctx.fillStyle = "#f0f0f2";
  ctx.font = `600 ${Math.max(16, Math.floor(h * 0.09))}px Figtree, ui-sans-serif, sans-serif`;
  ctx.fillText(`${trade.symbol}  ${trade.side.toUpperCase()}`, x + 22, y + 40);
  ctx.fillStyle = trade.pnl >= 0 ? "#5dcaa5" : "#e07a72";
  ctx.font = `600 ${Math.max(14, Math.floor(h * 0.07))}px 'IBM Plex Mono', ui-monospace, monospace`;
  ctx.fillText(`${signedMoney(trade.pnl)}   ${signedR(trade.r)}`, x + 22, y + 68);
  ctx.restore();
}

export async function renderTradePost(opts: {
  trade: JournalEntry;
  candles: { o: number; h: number; l: number; c: number }[];
  scene: MockupScene;
}): Promise<Blob> {
  const spec = MOCKUPS[opts.scene];
  const img = await loadImage(spec.src);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable.");
  ctx.drawImage(img, 0, 0);
  const x = img.width * spec.screen.x;
  const y = img.height * spec.screen.y;
  const w = img.width * spec.screen.w;
  const h = img.height * spec.screen.h;
  paintScreenChart(ctx, x, y, w, h, opts.candles, opts.trade);
  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not build trade post."));
    }, "image/jpeg", 0.92);
  });
}
