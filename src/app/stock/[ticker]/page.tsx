import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Calendar, TrendingUp } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProfileMenu } from "@/components/profile-menu";
import { SignalDetail } from "@/components/signal-detail";
import { ArticleDetail } from "@/components/article-detail";
import { AnalystBar } from "@/components/analyst-bar";
import { SignalStrip } from "@/components/signal-strip";
import { StrongSignalBadge } from "@/components/strong-signal-badge";
import { PredictionFeedback } from "@/components/prediction-feedback";
import { TrackRecordBadge } from "@/components/track-record-badge";
import { VerdictBreakdown } from "@/components/verdict-breakdown";
import { VerdictChip } from "@/components/verdict-chip";
import { createClient } from "@/lib/supabase/server";
import { fetchUserWatchlist } from "@/lib/watchlist";
import { fetchStockDetail } from "@/lib/stock-detail";
import { fetchStockTrackRecord } from "@/lib/feed";
import {
  fetchPredictionFeedbackSummary,
  fetchUserPredictionFeedback,
} from "@/lib/feedback";
import { fetchBetsForTradingDay } from "@/lib/bets";
import { fetchDailyBars } from "@/lib/price-history";
import { getLivePrice } from "@/lib/live-prices";
import { etCalendarDate, getMarketSchedule } from "@/lib/market-schedule";
import { BetCta } from "@/components/bet-cta";
import { StockSparkline } from "@/components/stock-sparkline";
import { cn } from "@/lib/utils";

type Params = Promise<{ ticker: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { ticker } = await params;
  const upper = ticker.toUpperCase();
  // Site URL: prefer the deployment's public origin; falls back to localhost
  // in dev. Social crawlers need an absolute URL for og:image.
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const ogImage = `${siteUrl}/og/stock/${upper}`;
  const title = `${upper} signals`;
  const description = `MarketMind's read on ${upper}: technical, sentiment, professional, and social signals — with a published track record.`;

  return {
    title,
    description,
    openGraph: {
      title: `${upper} · MarketMind`,
      description,
      url: `${siteUrl}/stock/${upper}`,
      siteName: "MarketMind",
      images: [{ url: ogImage, width: 1200, height: 630, alt: `${upper} signal breakdown` }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `${upper} · MarketMind`,
      description,
      images: [ogImage],
    },
  };
}

export default async function StockDetailPage({ params }: { params: Params }) {
  const { ticker } = await params;
  const supabase = await createClient();

  // The page is **publicly readable** — anonymous visitors land here from
  // social unfurls (Twitter, LinkedIn etc), shared links, or SEO crawl. The
  // og:image meta tag lives in this page's HTML, so unfurlers must be able
  // to reach it without auth. Auth-gated affordances (bet CTA, locked-in
  // chip, daily bonus) are hidden when `userId` is null; everything else
  // — signals, verdict, articles, sparkline — renders for everyone.
  const { data: claims } = await supabase.auth.getClaims();
  const userId = (claims?.claims?.sub as string | undefined) ?? null;
  const email = (claims?.claims?.email as string | undefined) ?? null;

  const schedule = getMarketSchedule();

  // Build the parallel-fetch list. Skip user-scoped queries when anonymous.
  const detailP = fetchStockDetail(supabase, ticker);
  const priceBarsP = fetchDailyBars(ticker, 30);
  // Cached snapshot (15-min delayed via Polygon, 5-min Upstash TTL) — shown
  // in the header price block. Failures degrade gracefully to prev_close.
  const livePriceP = getLivePrice(ticker);
  const watchlistP = userId
    ? fetchUserWatchlist(supabase, userId)
    : Promise.resolve([]);
  const profileP = userId
    ? supabase
        .from("user_profiles")
        .select("display_name, credit_balance")
        .eq("id", userId)
        .maybeSingle()
    : Promise.resolve({ data: null });
  const betsP = userId
    ? fetchBetsForTradingDay(supabase, userId, schedule.tradingDayLabel)
    : Promise.resolve({} as Record<string, never>);

  const [detail, watchlist, profileRes, betsByStockId, priceBars, livePrice] = await Promise.all([
    detailP,
    watchlistP,
    profileP,
    betsP,
    priceBarsP,
    livePriceP,
  ]);

  if (!detail) {
    notFound();
  }

  const profile = profileRes.data;
  const credits = profile?.credit_balance ?? 0;
  const name = profile?.display_name ?? email ?? null;
  const { stock, insight, articles, verdict } = detail;
  const userBet = userId ? (betsByStockId[stock.id] ?? null) : null;
  const isAnon = userId === null;

  // Per-stock track record + feedback rows — fired after detail resolves
  // so we know the stock_id / verdict_id. Single extra round-trip each;
  // cached via Next's fetch when the page is revalidated. Failures degrade
  // gracefully (empty aggregates, "Building track record" state).
  const [stockTrackRecord, feedbackSummary, userFeedback] = await Promise.all([
    fetchStockTrackRecord(supabase, stock.id),
    verdict
      ? fetchPredictionFeedbackSummary(supabase, verdict.id)
      : Promise.resolve({ helpfulCount: 0, totalCount: 0 }),
    verdict
      ? fetchUserPredictionFeedback(supabase, userId, verdict.id)
      : Promise.resolve(null),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="border-border/60 bg-background/60 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-3">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            <span>Feed</span>
          </Link>

          <div className="flex items-center gap-2 sm:gap-3">
            {!isAnon && (
              <div className="border-border/60 bg-card/40 flex items-center gap-2 rounded-full border px-2.5 py-1 sm:px-3 sm:py-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span className="text-xs font-medium tabular-nums">
                  {credits.toLocaleString()}
                  <span className="text-muted-foreground hidden sm:inline"> credits</span>
                </span>
              </div>
            )}
            <ThemeToggle />
            {isAnon ? (
              <Link
                href="/login"
                className="bg-foreground text-background hover:bg-foreground/90 inline-flex h-8 items-center rounded-md px-3 text-xs font-semibold transition-colors"
              >
                Sign in
              </Link>
            ) : (
              <ProfileMenu
                email={email ?? ""}
                displayName={name ?? "You"}
                watchlistCount={watchlist.length}
              />
            )}
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-8">
        {/* Stock hero */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="font-mono text-3xl font-semibold tracking-tight sm:text-4xl">
              {stock.ticker}
            </h1>
            <p className="text-muted-foreground text-base">{stock.name}</p>
            {insight && (
              <StrongSignalBadge
                scores={[
                  insight.technical_score,
                  insight.sentiment_score,
                  insight.professional_score,
                  insight.social_score,
                ]}
              />
            )}
            {insight && (
              <SignalStrip
                technical={insight.technical_score}
                sentiment={insight.sentiment_score}
                professional={insight.professional_score}
                social={insight.social_score}
              />
            )}
          </div>
          <p className="text-muted-foreground text-[11px] tracking-wider uppercase">
            {stock.sector}
            {stock.sub_sector && <span className="mx-1.5 opacity-50">·</span>}
            {stock.sub_sector}
            {stock.market_cap_tier && (
              <>
                <span className="mx-1.5 opacity-50">·</span>
                {stock.market_cap_tier} cap
              </>
            )}
          </p>

          {insight && (
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 pt-2">
              <span className="font-mono text-2xl font-semibold tabular-nums">
                {/* Prefer live snapshot when available; fall back to the
                    pipeline's pinned prev_close otherwise. */}
                {(livePrice?.price ?? insight.prev_close) != null
                  ? `$${(livePrice?.price ?? insight.prev_close)!.toFixed(2)}`
                  : "—"}
              </span>
              {/* When we have live data, show today's % change (live);
                  the pipeline's day_change is from yesterday's bar so it
                  goes stale during market hours. Other windows are still
                  trailing/calendar so they remain accurate. */}
              {livePrice?.changePct != null ? (
                <PctChange label="day (live)" value={livePrice.changePct} />
              ) : (
                <PctChange label="day" value={insight.day_change_pct} />
              )}
              <PctChange label="week" value={insight.week_change_pct} />
              <PctChange label="month" value={insight.month_change_pct} />
              <PctChange label="YTD" value={insight.ytd_change_pct} />
            </div>
          )}
          {livePrice?.price != null && (
            <p
              className="text-muted-foreground/70 text-[10px] tracking-wider uppercase"
              title="Finnhub real-time US equity quote, cached 5 min via Upstash Redis to stay under rate limits."
            >
              Live · Finnhub
            </p>
          )}

          {insight &&
            (insight.fifty_two_week_high != null || insight.fifty_two_week_low != null) && (
              <p className="text-muted-foreground pt-1 text-xs">
                52-week range:{" "}
                <span className="text-foreground font-mono tabular-nums">
                  ${insight.fifty_two_week_low?.toFixed(2) ?? "—"} — $
                  {insight.fifty_two_week_high?.toFixed(2) ?? "—"}
                </span>
              </p>
            )}
        </section>

        {!insight && (
          <section className="border-border/60 bg-card/30 flex flex-col items-start gap-2 rounded-xl border p-6">
            <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              No insight yet
            </span>
            <p className="text-sm leading-relaxed">
              {stock.ticker} hasn&apos;t been pipelined yet. Run{" "}
              <a
                href={`https://github.com/neelesh1206/market-mind/actions/workflows/fetch-insights.yml`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline-offset-2 hover:underline"
              >
                Fetch Insights
              </a>{" "}
              with this ticker (or limit ≥ {stock.ticker.length} stocks) to populate.
            </p>
          </section>
        )}

        {/* 30-day price sparkline — between header and verdict so the chart
            grounds the rest of the page before we dive into signals. Renders
            an empty-state line when Massive key is missing or fetch failed. */}
        {priceBars.length >= 2 && (
          <section className="border-border/60 bg-card/40 space-y-3 rounded-xl border p-5">
            <header className="flex items-baseline justify-between gap-3">
              <div>
                <p className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
                  30-day price
                </p>
                <p className="font-mono text-lg font-semibold">
                  ${priceBars[priceBars.length - 1]!.close.toFixed(2)}
                </p>
              </div>
              {(() => {
                const first = priceBars[0]!.close;
                const last = priceBars[priceBars.length - 1]!.close;
                const pct = ((last - first) / first) * 100;
                const tone =
                  pct > 0 ? "text-emerald-500" : pct < 0 ? "text-rose-500" : "text-muted-foreground";
                return (
                  <p className={cn("font-mono text-sm font-semibold tabular-nums", tone)}>
                    {`${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% · ${priceBars.length}d`}
                  </p>
                );
              })()}
            </header>
            <StockSparkline bars={priceBars} />
          </section>
        )}

        {/* MarketMind verdict + math */}
        {verdict && insight && (
          <section className="border-border/60 bg-card/40 space-y-4 rounded-xl border p-5">
            <VerdictChip verdict={verdict} showReasoning />
            {/* Per-stock track record — accountability per ADR 0007.
                "MarketMind has been right N of M on AAPL". Wilson 95% CI
                visible so users see uncertainty at small samples. */}
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-muted-foreground/70 uppercase tracking-wider">
                On {stock.ticker}:
              </span>
              <TrackRecordBadge
                total={stockTrackRecord.total}
                correct={stockTrackRecord.correct}
                accuracy={stockTrackRecord.accuracy}
                ciLower={stockTrackRecord.ciLower}
                ciUpper={stockTrackRecord.ciUpper}
              />
            </div>
            {/* Thumbs feedback on this verdict — closes the loop with users.
                Anon viewers see the aggregate + sign-in CTA; signed-in users
                can vote and the count updates optimistically. */}
            <PredictionFeedback
              predictionId={verdict.id}
              ticker={stock.ticker}
              signedIn={!isAnon}
              initialUserVote={userFeedback?.helpful ?? null}
              initialSummary={feedbackSummary}
            />
            <div className="border-border/40 border-t pt-4">
              <VerdictBreakdown insight={insight} variant="full" />
            </div>
          </section>
        )}

        {/* Catalysts row */}
        {insight && (insight.earnings_date || insight.has_recent_8k || insight.insider_detail) && (
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {insight.earnings_date && (
              <CatalystCard
                icon={Calendar}
                label="Earnings"
                value={
                  insight.earnings_in_days != null
                    ? `In ${insight.earnings_in_days}d`
                    : insight.earnings_date
                }
                hint={new Date(insight.earnings_date).toDateString()}
              />
            )}
            {insight.has_recent_8k && (
              <CatalystCard
                icon={TrendingUp}
                label="Material event"
                value="8-K filed"
                hint="Within the last 24h on SEC EDGAR"
              />
            )}
            {insight.insider_detail && (
              <CatalystCard
                icon={TrendingUp}
                label="Insider activity"
                value={insight.insider_activity ?? "—"}
                hint={insight.insider_detail}
              />
            )}
          </section>
        )}

        {/* Analyst consensus bar (separate from signal breakdown for prominence) */}
        {insight && (insight.analyst_buy || insight.analyst_hold || insight.analyst_sell) && (
          <section className="border-border/60 bg-card/30 rounded-xl border p-5">
            <AnalystBar
              buy={insight.analyst_buy}
              hold={insight.analyst_hold}
              sell={insight.analyst_sell}
            />
            {insight.analyst_price_target != null && (
              <p className="text-muted-foreground mt-3 text-xs">
                Consensus price target:{" "}
                <span className="text-foreground font-mono tabular-nums">
                  ${insight.analyst_price_target.toFixed(2)}
                </span>
                {insight.prev_close != null && (
                  <>
                    {" "}
                    ·{" "}
                    <span
                      className={
                        insight.analyst_price_target > insight.prev_close
                          ? "text-emerald-500"
                          : "text-red-500"
                      }
                    >
                      {(
                        ((insight.analyst_price_target - insight.prev_close) / insight.prev_close) *
                        100
                      ).toFixed(1)}
                      % from current
                    </span>
                  </>
                )}
              </p>
            )}
          </section>
        )}

        {/* Signal detail sections */}
        {insight && (
          <section className="space-y-3">
            <h2 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              Signal breakdown
            </h2>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <SignalDetail
                variant="technical"
                label="Technical"
                score={insight.technical_score}
                rows={[
                  { label: "RSI (14)", value: insight.rsi_14?.toFixed(1) ?? null },
                  { label: "MACD", value: insight.macd_signal?.replace("_", " ") ?? null },
                  { label: "vs 20-MA", value: insight.price_vs_20ma ?? null },
                  { label: "vs 50-MA", value: insight.price_vs_50ma ?? null },
                  { label: "Bollinger", value: insight.bollinger_position ?? null },
                  { label: "Volume", value: insight.volume_trend ?? null },
                ]}
              />
              <SignalDetail
                variant="sentiment"
                label="Sentiment"
                score={insight.sentiment_score}
                rows={[
                  {
                    label: "Articles",
                    value: insight.news_article_count?.toString() ?? null,
                  },
                  {
                    label: "Source agreement",
                    value:
                      insight.sources_agree_count != null && insight.sources_total_count != null
                        ? `${insight.sources_agree_count} / ${insight.sources_total_count}`
                        : null,
                  },
                  {
                    label: "Top source",
                    value: insight.top_headline_source ?? null,
                  },
                ]}
              />
              <SignalDetail
                variant="professional"
                label="Professional"
                score={insight.professional_score}
                rows={[
                  { label: "Analysts", value: insight.analyst_count?.toString() ?? null },
                  { label: "Buy", value: insight.analyst_buy?.toString() ?? null },
                  { label: "Hold", value: insight.analyst_hold?.toString() ?? null },
                  { label: "Sell", value: insight.analyst_sell?.toString() ?? null },
                  {
                    label: "Price target",
                    value:
                      insight.analyst_price_target != null
                        ? `$${insight.analyst_price_target.toFixed(2)}`
                        : null,
                  },
                  { label: "Rating change", value: insight.analyst_rating_change ?? null },
                ]}
              />
              <SignalDetail
                variant="social"
                label="Social"
                score={insight.social_score}
                rows={[
                  {
                    label: "StockTwits",
                    value:
                      insight.stocktwits_bullish != null
                        ? `${insight.stocktwits_bullish.toFixed(0)}% bullish`
                        : null,
                  },
                  {
                    label: "Messages",
                    value: insight.stocktwits_messages?.toString() ?? null,
                  },
                  {
                    label: "WSB rank",
                    value: insight.apewisdom_rank != null ? `#${insight.apewisdom_rank}` : null,
                  },
                  {
                    label: "Reddit Δ",
                    value:
                      insight.reddit_mention_delta != null
                        ? `${insight.reddit_mention_delta > 0 ? "+" : ""}${insight.reddit_mention_delta.toFixed(0)}%`
                        : null,
                  },
                ]}
              />
            </div>
          </section>
        )}

        {/* Articles */}
        {articles.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              Top articles ({articles.length})
            </h2>
            <div className="space-y-3">
              {articles.map((a) => (
                <ArticleDetail key={a.id} article={a} />
              ))}
            </div>
          </section>
        )}

        {/* Bet CTAs */}
        <section className="border-border/60 bg-card/20 flex flex-wrap items-center justify-between gap-4 rounded-xl border p-5">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">
              {isAnon
                ? "Want to put credits behind this call?"
                : userBet
                  ? "Your bet for today"
                  : "Your prediction"}
            </p>
            <p className="text-muted-foreground text-xs">
              {isAnon
                ? "Sign in to place a virtual-credit bet — bet window 8 PM ET → 1 PM ET next trading day."
                : "Bet window: 8 PM ET → 1 PM ET next trading day. Resolves at 4:15 PM ET."}
            </p>
          </div>
          {isAnon ? (
            <Link
              href="/login"
              className="inline-flex h-10 items-center gap-1.5 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-600/90"
            >
              Sign in to bet →
            </Link>
          ) : (
            <BetCta
              stock={{ id: stock.id, ticker: stock.ticker, name: stock.name }}
              verdict={verdict}
              userBet={userBet}
              userCredits={credits}
              betWindowOpen={schedule.betWindowOpen}
              betWindowClosesAt={schedule.betWindowClosesAt}
              betWindowOpensAt={schedule.betWindowOpensAt}
              resolutionAt={schedule.resolutionAt}
              todayEt={etCalendarDate()}
              size="lg"
            />
          )}
        </section>

        {/* Methodology link */}
        <section className="text-muted-foreground border-border/40 border-t pt-4 text-xs">
          Signals are derived from {insight?.sources_total_count ?? "multiple"} sources combining
          price/technical indicators (yfinance + ta-lib), news sentiment (FinBERT), professional
          opinion (Finnhub + SEC EDGAR), and social mentions (StockTwits + ApeWisdom + Reddit).{" "}
          <Link href="/about" className="text-foreground underline-offset-2 hover:underline">
            Read the full methodology →
          </Link>
        </section>
      </main>

      <footer className="border-border/60 border-t">
        <div className="text-muted-foreground/70 mx-auto w-full max-w-5xl px-6 py-4 text-xs">
          For educational purposes only. Not investment advice.
        </div>
      </footer>
    </div>
  );
}

function PctChange({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null;
  const up = value > 0;
  const flat = Math.abs(value) < 0.005;
  return (
    <span className="flex items-baseline gap-1 font-mono text-sm tabular-nums">
      <span
        className={cn(flat ? "text-muted-foreground" : up ? "text-emerald-500" : "text-red-500")}
      >
        {up && !flat ? "▲" : !flat ? "▼" : ""} {up ? "+" : ""}
        {value.toFixed(2)}%
      </span>
      <span className="text-muted-foreground text-xs">{label}</span>
    </span>
  );
}

function CatalystCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Calendar;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="border-border/60 bg-card/30 space-y-1 rounded-xl border p-4">
      <div className="text-muted-foreground flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        <span className="text-[10px] tracking-wider uppercase">{label}</span>
      </div>
      <p className="text-base font-semibold">{value}</p>
      {hint && <p className="text-muted-foreground text-[11px] leading-snug">{hint}</p>}
    </div>
  );
}
