import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowDown, ArrowUp, Calendar, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProfileMenu } from "@/components/profile-menu";
import { SignalDetail } from "@/components/signal-detail";
import { ArticleDetail } from "@/components/article-detail";
import { AnalystBar } from "@/components/analyst-bar";
import { SignalStrip } from "@/components/signal-strip";
import { StrongSignalBadge } from "@/components/strong-signal-badge";
import { createClient } from "@/lib/supabase/server";
import { fetchUserWatchlist } from "@/lib/watchlist";
import { fetchStockDetail } from "@/lib/stock-detail";
import { cn } from "@/lib/utils";

type Params = Promise<{ ticker: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { ticker } = await params;
  return { title: `${ticker.toUpperCase()} signals` };
}

export default async function StockDetailPage({ params }: { params: Params }) {
  const { ticker } = await params;
  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) {
    redirect("/login");
  }

  const userId = claims.claims.sub as string;
  const email = (claims.claims.email ?? userId) as string;

  const [detail, watchlist, profileRes] = await Promise.all([
    fetchStockDetail(supabase, ticker),
    fetchUserWatchlist(supabase, userId),
    supabase
      .from("user_profiles")
      .select("display_name, credit_balance")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  if (!detail) {
    notFound();
  }

  const profile = profileRes.data;
  const credits = profile?.credit_balance ?? 0;
  const name = profile?.display_name ?? email;
  const { stock, insight, articles } = detail;

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
            <div className="border-border/60 bg-card/40 flex items-center gap-2 rounded-full border px-2.5 py-1 sm:px-3 sm:py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="text-xs font-medium tabular-nums">
                {credits.toLocaleString()}
                <span className="text-muted-foreground hidden sm:inline"> credits</span>
              </span>
            </div>
            <ThemeToggle />
            <ProfileMenu email={email} displayName={name} watchlistCount={watchlist.length} />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-8">
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
                {insight.prev_close != null ? `$${insight.prev_close.toFixed(2)}` : "—"}
              </span>
              <PctChange label="day" value={insight.day_change_pct} />
              <PctChange label="week" value={insight.week_change_pct} />
              <PctChange label="month" value={insight.month_change_pct} />
              <PctChange label="YTD" value={insight.ytd_change_pct} />
            </div>
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
            <p className="text-sm font-medium">Your prediction</p>
            <p className="text-muted-foreground text-xs">
              Bet window opens at 8 PM ET, locks at 9:15 AM the next morning.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="lg"
              disabled
              className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-600/90"
            >
              <ArrowUp className="h-4 w-4" /> UP
            </Button>
            <Button
              size="lg"
              variant="outline"
              disabled
              className="gap-1.5 border-red-500/50 text-red-500 hover:bg-red-500/10"
            >
              <ArrowDown className="h-4 w-4" /> DOWN
            </Button>
          </div>
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
