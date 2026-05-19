"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import type { PriceBar } from "@/lib/price-history";

type Props = {
  bars: PriceBar[];
  /** Optional tone override; otherwise inferred from net change over the window. */
  tone?: "up" | "down" | "neutral";
};

/**
 * 30-day price sparkline for the stock detail page.
 *
 * Deliberately minimal — no axes, no grid, no legend. Just the line + a faint
 * area fill that tints the chart toward the period's direction. The number
 * matters more than the visual flair; the chart is a feeling, not a tool.
 *
 * Hover tooltip shows the per-day date + close in the app's mono font.
 */
export function StockSparkline({ bars, tone }: Props) {
  if (bars.length < 2) {
    return (
      <div className="text-muted-foreground border-border/40 flex h-[140px] items-center justify-center rounded-lg border border-dashed text-xs">
        Price history unavailable
      </div>
    );
  }

  const first = bars[0]!.close;
  const last = bars[bars.length - 1]!.close;
  const inferredTone = last > first ? "up" : last < first ? "down" : "neutral";
  const resolvedTone = tone ?? inferredTone;

  const color =
    resolvedTone === "up" ? "#10b981" : resolvedTone === "down" ? "#f43f5e" : "#737373";

  // Min/max with a small breathing room so the line doesn't kiss the edges.
  const closes = bars.map((b) => b.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const pad = (max - min) * 0.08 || 0.5;

  return (
    <div className="w-full">
      {/* `aspect` keeps the chart's 8:1 ratio across container widths and
          gives Recharts a definite size on first paint, which avoids the
          -1×-1 measurement warning that fires when a flex parent's width
          hasn't settled yet. */}
      <ResponsiveContainer width="100%" aspect={8} minWidth={0}>
        <AreaChart data={bars} margin={{ top: 8, right: 4, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id={`spark-${resolvedTone}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[min - pad, max + pad]} />
          <Tooltip
            cursor={{ stroke: "rgba(255,255,255,0.15)", strokeWidth: 1 }}
            content={<SparkTooltip />}
          />
          <Area
            type="monotone"
            dataKey="close"
            stroke={color}
            strokeWidth={2}
            fill={`url(#spark-${resolvedTone})`}
            isAnimationActive={false}
            activeDot={{ r: 3, stroke: color, strokeWidth: 2, fill: "#0a0a0a" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

type TooltipPayload = {
  active?: boolean;
  payload?: { payload: PriceBar }[];
};

function SparkTooltip({ active, payload }: TooltipPayload) {
  if (!active || !payload || payload.length === 0) return null;
  const bar = payload[0]!.payload;
  return (
    <div
      className={cn(
        "border-border/60 bg-card/95 rounded-md border px-2.5 py-1.5 shadow-lg backdrop-blur",
        "font-mono text-[11px] tabular-nums",
      )}
    >
      <div className="text-muted-foreground">{formatDate(bar.date)}</div>
      <div className="text-foreground font-semibold">${bar.close.toFixed(2)}</div>
    </div>
  );
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
