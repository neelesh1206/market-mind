import { cn } from "@/lib/utils";
import type { StockInsight } from "@/types/insight";

type Bucket = "technical" | "sentiment" | "professional" | "social";

const WEIGHTS_V1: Record<Bucket, number> = {
  technical: 0.3,
  sentiment: 0.25,
  professional: 0.3,
  social: 0.15,
};

const LABELS: Record<Bucket, string> = {
  technical: "Tech",
  sentiment: "Sent",
  professional: "Prof",
  social: "Soc",
};

type Props = {
  insight: StockInsight;
  /** Compact = single line; full = stacked rows with weighted bars. */
  variant?: "compact" | "full";
};

/**
 * Shows the per-bucket weighted contribution that built today's verdict.
 *
 *   Compact:  "Prof +0.21 · Soc +0.08 · Sent +0.07 · Tech -0.03 = +0.32"
 *   Full:     stacked rows with weighted contribution bars
 *
 * The point is **auditability**: if the verdict says UP and one bucket bar is
 * red, users should be able to see *why* the math still resolved bullish.
 */
export function VerdictBreakdown({ insight, variant = "compact" }: Props) {
  const contributions = buildContributions(insight);
  const net = contributions.reduce((sum, c) => sum + c.contribution, 0);

  if (variant === "compact") {
    return (
      <p className="text-muted-foreground font-mono text-[11px] leading-snug">
        <span className="opacity-70">Math:</span>{" "}
        {contributions.map((c, i) => (
          <span key={c.key}>
            {i > 0 && <span className="opacity-50"> · </span>}
            <span className="opacity-70">{LABELS[c.key]} </span>
            <span className={contribClass(c.contribution)}>{formatSigned(c.contribution)}</span>
          </span>
        ))}
        <span className="opacity-50"> = </span>
        <span className={cn("font-semibold", contribClass(net))}>{formatSigned(net)}</span>
      </p>
    );
  }

  // Full view — vertical bar per bucket, weighted by the bucket's weight
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-[10px] tracking-wider uppercase">
        Weighted contributions
      </p>
      <div className="space-y-1.5">
        {contributions.map((c) => (
          <div key={c.key} className="grid grid-cols-[60px_1fr_70px] items-center gap-2">
            <span className="text-foreground/80 text-xs">{LABELS[c.key]}</span>
            <ContribBar contribution={c.contribution} />
            <span
              className={cn(
                "text-right font-mono text-xs tabular-nums",
                contribClass(c.contribution),
              )}
            >
              {formatSigned(c.contribution)}
            </span>
          </div>
        ))}
        <div className="border-border/40 grid grid-cols-[60px_1fr_70px] items-center gap-2 border-t pt-1.5">
          <span className="text-foreground/90 text-xs font-semibold">Net</span>
          <span />
          <span
            className={cn(
              "text-right font-mono text-sm font-semibold tabular-nums",
              contribClass(net),
            )}
          >
            {formatSigned(net)}
          </span>
        </div>
      </div>
    </div>
  );
}

function buildContributions(insight: StockInsight) {
  const raw: Record<Bucket, number> = {
    technical: insight.technical_score ?? 0,
    sentiment: insight.sentiment_score ?? 0,
    professional: insight.professional_score ?? 0,
    social: insight.social_score ?? 0,
  };
  return (Object.keys(raw) as Bucket[])
    .map((key) => ({
      key,
      raw: raw[key],
      weight: WEIGHTS_V1[key],
      contribution: raw[key] * WEIGHTS_V1[key],
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

function ContribBar({ contribution }: { contribution: number }) {
  // Max possible weighted contribution per bucket is the weight itself (when raw = ±1).
  // For visual scale, we use 0.3 as the max span — slightly bigger than the largest weight.
  const maxAbs = 0.3;
  const pct = Math.min(Math.abs(contribution) / maxAbs, 1) * 50;
  const positive = contribution > 0;
  return (
    <div className="bg-muted relative h-1.5 w-full overflow-hidden rounded-full">
      <div className="bg-border absolute top-0 left-1/2 h-full w-px -translate-x-1/2" aria-hidden />
      <div
        className={cn(
          "absolute top-0 h-full rounded-full",
          positive ? "bg-emerald-500" : "bg-red-500",
        )}
        style={{
          left: positive ? "50%" : `${50 - pct}%`,
          width: `${pct}%`,
        }}
        aria-hidden
      />
    </div>
  );
}

function contribClass(v: number): string {
  if (v > 0.005) return "text-emerald-500";
  if (v < -0.005) return "text-red-500";
  return "text-muted-foreground";
}

function formatSigned(v: number): string {
  const rounded = Math.round(v * 100) / 100;
  return rounded > 0 ? `+${rounded.toFixed(2)}` : rounded.toFixed(2);
}
