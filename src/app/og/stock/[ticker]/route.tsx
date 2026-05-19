import { ImageResponse } from "next/og";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";
import { fetchStockDetail } from "@/lib/stock-detail";
import { fetchTrackRecord } from "@/lib/feed";

export const runtime = "edge";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };

export const revalidate = 300;

type RouteParams = Promise<{ ticker: string }>;

/**
 * Dynamic OG image for /stock/[ticker]. Layout:
 *
 *   [logo MarketMind]                         [track-record pill]
 *
 *   AAPL              ┌──────────────────────┐
 *   Apple Inc.        │  ↑                   │
 *   +1.24% today      │  UP                  │
 *                     │  32% confidence      │
 *                     └──────────────────────┘
 *
 *   Technical    ─────|████─                          -0.10
 *   Sentiment    ─────|████──                         +0.28
 *   Professional ─────|████████                       +0.69
 *   Social       ─────|██████─                        +0.50
 *
 *   Multi-source signal intelligence              marketmind.app
 *
 * Rendered via next/og's edge `ImageResponse`. Satori (the engine under the
 * hood) only supports a flexbox subset of CSS — every multi-child div needs
 * explicit `display: flex`, and text interpolations need to be flattened to
 * single strings (not [text, value, text] JSX children).
 */
export async function GET(_req: Request, { params }: { params: RouteParams }) {
  const { ticker } = await params;

  const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });

  const [detail, trackRecord] = await Promise.all([
    fetchStockDetail(supabase, ticker),
    fetchTrackRecord(supabase, 30),
  ]);

  if (!detail) {
    return new Response("Not found", { status: 404 });
  }

  const { stock, insight, verdict } = detail;

  // Verdict palette
  const verdictPalette =
    verdict?.direction === "UP"
      ? { color: "#34d399", bg: "rgba(16, 185, 129, 0.10)", border: "rgba(16, 185, 129, 0.45)", glow: "rgba(16, 185, 129, 0.35)" }
      : verdict?.direction === "DOWN"
        ? { color: "#fb7185", bg: "rgba(244, 63, 94, 0.10)", border: "rgba(244, 63, 94, 0.45)", glow: "rgba(244, 63, 94, 0.30)" }
        : { color: "#d4d4d4", bg: "rgba(163, 163, 163, 0.08)", border: "rgba(163, 163, 163, 0.30)", glow: "rgba(163, 163, 163, 0.20)" };

  const directionGlyph =
    verdict?.direction === "UP" ? "↑" : verdict?.direction === "DOWN" ? "↓" : "→";

  const dayChange = insight?.day_change_pct ?? null;
  const dayChangeTone =
    dayChange === null ? "#737373" : dayChange >= 0 ? "#34d399" : "#fb7185";

  const buckets: { label: string; value: number | null }[] = [
    { label: "Technical", value: insight?.technical_score ?? null },
    { label: "Sentiment", value: insight?.sentiment_score ?? null },
    { label: "Professional", value: insight?.professional_score ?? null },
    { label: "Social", value: insight?.social_score ?? null },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #0a0a0a 0%, #0f172a 50%, #0a0a0a 100%)",
          color: "#fafafa",
          padding: "42px 64px 48px",
          display: "flex",
          flexDirection: "column",
          fontFamily: "system-ui, -apple-system, sans-serif",
          position: "relative",
        }}
      >
        {/* Subtle radial glow behind the verdict — tints the canvas toward
            the call's color without dominating. */}
        <div
          style={{
            position: "absolute",
            right: -120,
            top: 80,
            width: 700,
            height: 700,
            borderRadius: 999,
            background: `radial-gradient(circle, ${verdictPalette.glow} 0%, transparent 65%)`,
            opacity: 0.6,
            display: "flex",
          }}
        />

        {/* Header row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            zIndex: 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 10,
                background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 8px 24px rgba(16, 185, 129, 0.35)",
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M3 17L9 11L13 15L21 7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M15 7H21V13" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.01em" }}>
              MarketMind
            </div>
          </div>

          {trackRecord.total > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                borderRadius: 999,
                border: "1px solid rgba(255, 255, 255, 0.10)",
                background: "rgba(255, 255, 255, 0.04)",
                fontSize: 16,
              }}
            >
              <span style={{ color: "#a3a3a3" }}>30-day</span>
              <span style={{ color: "#34d399", fontWeight: 700 }}>
                {`${Math.round((trackRecord.accuracy ?? 0) * 100)}% accurate`}
              </span>
              <span style={{ color: "#737373" }}>
                {`(${trackRecord.correct}/${trackRecord.total})`}
              </span>
            </div>
          )}
        </div>

        {/* Body — two columns */}
        <div
          style={{
            marginTop: 28,
            display: "flex",
            gap: 36,
            alignItems: "flex-start",
            zIndex: 1,
          }}
        >
          {/* Left column: ticker + company + day change */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
            <div
              style={{
                fontSize: 108,
                fontWeight: 800,
                letterSpacing: "-0.05em",
                lineHeight: 0.9,
              }}
            >
              {stock.ticker}
            </div>
            <div style={{ fontSize: 24, color: "#a3a3a3", letterSpacing: "-0.01em" }}>
              {stock.name}
            </div>
            {dayChange !== null && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 6,
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: `1px solid ${dayChange >= 0 ? "rgba(16, 185, 129, 0.3)" : "rgba(244, 63, 94, 0.3)"}`,
                  background: dayChange >= 0 ? "rgba(16, 185, 129, 0.08)" : "rgba(244, 63, 94, 0.08)",
                  alignSelf: "flex-start",
                }}
              >
                <span style={{ fontSize: 18, color: dayChangeTone, fontWeight: 700 }}>
                  {`${dayChange >= 0 ? "+" : ""}${dayChange.toFixed(2)}%`}
                </span>
                <span style={{ fontSize: 14, color: "#a3a3a3" }}>today</span>
              </div>
            )}
          </div>

          {/* Right column: BIG verdict card */}
          {verdict && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                padding: "22px 28px",
                borderRadius: 16,
                border: `2px solid ${verdictPalette.border}`,
                background: verdictPalette.bg,
                color: verdictPalette.color,
                minWidth: 300,
                boxShadow: `0 12px 48px ${verdictPalette.glow}`,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "#a3a3a3",
                }}
              >
                MarketMind&apos;s read
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  marginTop: 6,
                }}
              >
                <div style={{ fontSize: 68, lineHeight: 1, fontWeight: 800 }}>
                  {directionGlyph}
                </div>
                <div
                  style={{
                    fontSize: 60,
                    fontWeight: 800,
                    letterSpacing: "-0.03em",
                    lineHeight: 1,
                  }}
                >
                  {verdict.direction}
                </div>
              </div>
              <div style={{ marginTop: 8, fontSize: 18, color: "#d4d4d4" }}>
                {`${Math.round(verdict.confidence * 100)}% confidence`}
              </div>
            </div>
          )}
        </div>

        {/* Reasoning quote — the LLM's one-line "why" behind the verdict.
            Trimmed to ~130 chars so it stays a one-liner at this width. */}
        {verdict?.reasoning && (
          <div
            style={{
              marginTop: 18,
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              paddingLeft: 14,
              borderLeft: `3px solid ${verdictPalette.border}`,
              zIndex: 1,
            }}
          >
            <div
              style={{
                fontSize: 18,
                lineHeight: 1.3,
                color: "#d4d4d4",
                fontStyle: "italic",
                letterSpacing: "-0.005em",
                display: "flex",
              }}
            >
              {truncate(verdict.reasoning, 130)}
            </div>
          </div>
        )}

        {/* Signal bars */}
        <div
          style={{
            marginTop: verdict?.reasoning ? 18 : 28,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            zIndex: 1,
          }}
        >
          {buckets.map((b) => (
            <SignalRow key={b.label} label={b.label} value={b.value} />
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: "auto",
            paddingTop: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            fontSize: 17,
            color: "#a3a3a3",
            zIndex: 1,
          }}
        >
          <div style={{ display: "flex" }}>Multi-source signal intelligence · 10+ sources</div>
          <div style={{ display: "flex" }}>marketmind.app</div>
        </div>
      </div>
    ),
    {
      ...size,
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=600, stale-while-revalidate=3600",
      },
    },
  );
}

/** Truncate at a word boundary if possible — avoids mid-word cuts in the OG. */
function truncate(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  return `${slice.slice(0, lastSpace > max - 30 ? lastSpace : max - 1)}…`;
}

function SignalRow({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  const absPct = Math.min(Math.abs(v), 1) * 100;
  const positive = v > 0;
  const negative = v < 0;
  const tone = positive ? "#34d399" : negative ? "#fb7185" : "#525252";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <div
        style={{
          width: 170,
          fontSize: 19,
          color: "#d4d4d4",
          letterSpacing: "0.02em",
          display: "flex",
        }}
      >
        {label}
      </div>
      <div
        style={{
          flex: 1,
          height: 14,
          borderRadius: 999,
          background: "rgba(255, 255, 255, 0.05)",
          display: "flex",
          position: "relative",
        }}
      >
        {/* Center anchor — a small notch, more grounded than a thin line */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: -4,
            bottom: -4,
            width: 2,
            marginLeft: -1,
            background: "rgba(255, 255, 255, 0.20)",
            borderRadius: 1,
            display: "flex",
          }}
        />
        {value !== null && (
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              borderRadius: 999,
              background: tone,
              boxShadow: `0 0 12px ${tone}66`,
              display: "flex",
              ...(positive
                ? { left: "50%", width: `${absPct / 2}%` }
                : { right: "50%", width: `${absPct / 2}%` }),
            }}
          />
        )}
      </div>
      <div
        style={{
          width: 96,
          textAlign: "right",
          fontSize: 22,
          fontWeight: 700,
          color: value === null ? "#525252" : tone,
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
        {value === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}`}
      </div>
    </div>
  );
}
