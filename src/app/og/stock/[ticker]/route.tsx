import { ImageResponse } from "next/og";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";
import { fetchStockDetail } from "@/lib/stock-detail";
import { fetchTrackRecord } from "@/lib/feed";

export const runtime = "edge";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };

// Re-rendered when the pipeline produces new data; otherwise CDN-cached.
export const revalidate = 300;

type RouteParams = Promise<{ ticker: string }>;

/**
 * Dynamic OG image for /stock/[ticker] — what Twitter / LinkedIn / iMessage
 * preview when someone shares the URL. Renders with `next/og`'s edge-runtime
 * `ImageResponse` (Satori under the hood, so we get JSX-style layout but only
 * a flexbox subset of CSS).
 *
 * Visual identity matches the app: dark canvas, emerald MarketMind logo,
 * mono ticker, signal bars + verdict chip + track record. Same data the user
 * would see when they actually visit the page — the preview *is* the product.
 */
export async function GET(_req: Request, { params }: { params: RouteParams }) {
  const { ticker } = await params;

  // Anon client — all relevant tables have public_read RLS. We bypass the
  // cookie-aware createClient because OG generation runs at the edge without
  // request context.
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

  const verdictTone =
    verdict?.direction === "UP"
      ? { color: "#10b981", bg: "rgba(16, 185, 129, 0.12)", border: "rgba(16, 185, 129, 0.4)" }
      : verdict?.direction === "DOWN"
        ? { color: "#f43f5e", bg: "rgba(244, 63, 94, 0.12)", border: "rgba(244, 63, 94, 0.4)" }
        : { color: "#a3a3a3", bg: "rgba(163, 163, 163, 0.10)", border: "rgba(163, 163, 163, 0.3)" };

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
          background: "linear-gradient(135deg, #0a0a0a 0%, #111827 100%)",
          color: "#fafafa",
          padding: "60px 70px",
          display: "flex",
          flexDirection: "column",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Header — logo + brand */}
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
            {/* Chart-up mark */}
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path
                d="M3 17L9 11L13 15L21 7"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M15 7H21V13"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.01em" }}>MarketMind</div>
        </div>

        {/* Ticker + name */}
        <div style={{ marginTop: 48, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 110, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1 }}>
            {stock.ticker}
          </div>
          <div style={{ fontSize: 28, color: "#a3a3a3", letterSpacing: "-0.01em" }}>
            {stock.name}
          </div>
        </div>

        {/* Verdict chip — only rendered if we have one */}
        {verdict && (
          <div
            style={{
              marginTop: 28,
              alignSelf: "flex-start",
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 18px",
              borderRadius: 10,
              border: `1px solid ${verdictTone.border}`,
              background: verdictTone.bg,
              color: verdictTone.color,
            }}
          >
            <div style={{ fontSize: 14, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              MarketMind&apos;s read
            </div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>
              {verdict.direction === "UP" ? "↑" : verdict.direction === "DOWN" ? "↓" : "→"}{" "}
              {verdict.direction}
            </div>
            <div style={{ fontSize: 20, opacity: 0.8 }}>
              · {Math.round(verdict.confidence * 100)}%
            </div>
          </div>
        )}

        {/* Signal bars */}
        <div
          style={{
            marginTop: 40,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {buckets.map((b) => (
            <SignalRow key={b.label} label={b.label} value={b.value} />
          ))}
        </div>

        {/* Footer — track record badge + URL */}
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            paddingTop: 24,
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
          }}
        >
          {trackRecord.total > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 18 }}>
              <span style={{ color: "#a3a3a3" }}>30-day track record</span>
              <span style={{ color: "#10b981", fontWeight: 600 }}>
                {Math.round((trackRecord.accuracy ?? 0) * 100)}%
              </span>
              <span style={{ color: "#737373" }}>
                ({trackRecord.correct}/{trackRecord.total})
              </span>
            </div>
          ) : (
            <div style={{ fontSize: 18, color: "#a3a3a3" }}>
              Multi-source signal intelligence
            </div>
          )}
          <div style={{ fontSize: 18, color: "#a3a3a3" }}>marketmind.app</div>
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

function SignalRow({ label, value }: { label: string; value: number | null }) {
  // Width as % of half the bar (center origin → +1 fills right, -1 fills left).
  // Satori doesn't support transforms reliably; we render two halves explicitly.
  const v = value ?? 0;
  const absPct = Math.min(Math.abs(v), 1) * 100;
  const positive = v > 0;
  const negative = v < 0;
  const tone = positive ? "#10b981" : negative ? "#f43f5e" : "#525252";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ width: 160, fontSize: 18, color: "#a3a3a3" }}>{label}</div>
      <div
        style={{
          flex: 1,
          height: 10,
          borderRadius: 999,
          background: "rgba(255, 255, 255, 0.06)",
          display: "flex",
          position: "relative",
        }}
      >
        {/* Center line */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: -3,
            bottom: -3,
            width: 1,
            background: "rgba(255, 255, 255, 0.18)",
          }}
        />
        {/* Filled portion — anchored at center */}
        {value !== null && (
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              borderRadius: 999,
              background: tone,
              ...(positive
                ? { left: "50%", width: `${absPct / 2}%` }
                : { right: "50%", width: `${absPct / 2}%` }),
            }}
          />
        )}
      </div>
      <div
        style={{
          width: 72,
          textAlign: "right",
          fontSize: 18,
          fontWeight: 600,
          color: value === null ? "#525252" : tone,
        }}
      >
        {value === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}`}
      </div>
    </div>
  );
}
