"use client";

import { SignalBar, type SignalVariant } from "@/components/signal-bar";
import { cn } from "@/lib/utils";

type Props = {
  variant: SignalVariant;
  label: string;
  score: number | null;
  /** Key/value pairs for the detail grid — one row per signal contributor. */
  rows: Array<{ label: string; value: string | number | null; muted?: boolean }>;
};

/**
 * Expanded signal section used on the stock detail page.
 * Re-uses the same SignalBar at the top, then renders a key/value
 * grid of all contributing signals (RSI, MACD, analyst counts, etc).
 */
export function SignalDetail({ variant, label, score, rows }: Props) {
  const populated = rows.filter((r) => r.value !== null && r.value !== "" && r.value !== "—");

  return (
    <section className="border-border/60 bg-card/30 space-y-4 rounded-xl border p-5">
      <SignalBar variant={variant} label={label} score={score} />
      {populated.length > 0 ? (
        <dl className="border-border/40 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 sm:grid-cols-3">
          {populated.map((row) => (
            <div key={row.label} className="space-y-0.5">
              <dt className="text-muted-foreground text-[10px] tracking-wider uppercase">
                {row.label}
              </dt>
              <dd
                className={cn(
                  "font-mono text-sm tabular-nums",
                  row.muted && "text-muted-foreground",
                )}
              >
                {row.value === null ? "—" : row.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-muted-foreground/70 border-border/40 border-t pt-3 text-xs">
          No detail rows for this bucket yet.
        </p>
      )}
    </section>
  );
}
