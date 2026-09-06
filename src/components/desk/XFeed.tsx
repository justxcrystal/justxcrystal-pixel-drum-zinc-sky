import { useEffect, useState } from "react";
import { sessionBoard, sessionClocks } from "@/lib/desk/market";
import { cn } from "@/lib/utils";

const ROWS = [
  { key: "asia" as const, name: "Asia", hours: "7:00 PM – 4:00 AM ET" },
  { key: "london" as const, name: "London", hours: "3:00 AM – 12:00 PM ET" },
  { key: "ny" as const, name: "New York", hours: "8:00 AM – 5:00 PM ET" },
];

export function SessionStrip() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const board = sessionBoard(now);
  const clocks = sessionClocks(now);

  return (
    <section className="overflow-hidden rounded-3xl bg-surface px-4 py-3 shadow-border">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="font-mono text-2xs tracking-label text-faint uppercase">Sessions</p>
        <p className="font-mono text-2xs tabular-nums text-faint">
          {board.overlap ? "London / New York overlap" : board.clock}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {ROWS.map((row) => {
          const on = board[row.key];
          return (
            <div
              key={row.key}
              className={cn(
                "rounded-2xl px-2 py-2.5 text-center shadow-border",
                on ? "bg-primary/15" : "bg-surface-2",
              )}
            >
              <p className="font-mono text-2xs tracking-label uppercase text-faint">{row.name}</p>
              <p
                className={cn(
                  "mt-1 font-mono text-xs tracking-label uppercase",
                  on ? "text-primary" : "text-muted",
                )}
              >
                {on ? "Open" : "Closed"}
              </p>
              <p className="mt-1 font-mono text-2xs tabular-nums text-faint">{clocks[row.key]}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
