import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Landmark,
  LineChart,
  MessageSquare,
  Newspaper,
  type LucideIcon,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { TrackRecordBadge } from "@/components/track-record-badge";
import { createClient } from "@/lib/supabase/server";
import { fetchTrackRecord } from "@/lib/feed";

export const revalidate = 60; // refresh track-record every minute

/** Inline GitHub mark — Lucide dropped the brand icon. */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.114 2.504.336 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

export const metadata = {
  title: "How MarketMind works",
  description:
    "How we compute the daily UP/DOWN call, what data sources we use, our published track record, and our honest limitations.",
};

/**
 * Methodology + trust page. Accessible to logged-out users too — it's the
 * front door for anyone who lands on a shared stock link and wants to know
 * what they're looking at.
 */
export default async function AboutPage() {
  // Track-record is public read (anon allowed by RLS).
  const supabase = await createClient();
  // Multi-window stats for the "How we're doing" section. All-time uses a
  // 5-year window which is comfortably larger than the project's lifespan;
  // we'll widen it the day that becomes a constraint.
  const [tr7, tr30, tr90, trAll] = await Promise.all([
    fetchTrackRecord(supabase, 7),
    fetchTrackRecord(supabase, 30),
    fetchTrackRecord(supabase, 90),
    fetchTrackRecord(supabase, 365 * 5),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border/60 bg-background/60 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-3">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            <span>Back</span>
          </Link>
          <div className="flex items-center gap-2">
            <a
              href="https://github.com/neelesh1206/market-mind"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm transition-colors"
              aria-label="View source on GitHub"
            >
              <GithubMark className="h-4 w-4" />
              <span className="hidden sm:inline">GitHub</span>
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-6 py-12">
        {/* Hero */}
        <section className="space-y-4">
          <p className="text-xs font-medium tracking-wider text-emerald-500 uppercase">
            How MarketMind works
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            Predictions you can <span className="text-muted-foreground">audit.</span>
          </h1>
          <p className="text-muted-foreground max-w-2xl text-base leading-relaxed">
            MarketMind aggregates 10+ sources into four signals per stock, combines them into a
            daily UP/DOWN call, and publishes the track record so you can see exactly how often
            we&apos;re right. Every score links back to its sources — no black boxes.
          </p>
        </section>

        {/* How we're doing — multi-window track record with honest framing.
            `data-testid` is the e2e contract — Playwright targets this instead
            of the heading copy so a future rename (this section has already
            been renamed once: "Our track record" → "How we're doing") doesn't
            flap CI. Don't remove without updating tests/e2e/public-surfaces.spec.ts. */}
        <section
          data-testid="track-record-section"
          className="border-border/60 bg-card/30 space-y-4 rounded-xl border p-6"
        >
          <header className="space-y-1.5">
            <h2 className="text-base font-semibold">How we&apos;re doing</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              MarketMind&apos;s daily verdicts are resolved against actual market close. We publish
              the score for accountability — and the 95% confidence interval (the range in
              parentheses) so you can see how much to trust the headline number.
            </p>
          </header>

          {/* Honesty caption — sample-size-aware framing in front of the numbers */}
          <div className="border-border/40 bg-background/40 rounded-md border-l-2 border-l-amber-500/60 px-3 py-2">
            <p className="text-muted-foreground text-xs leading-relaxed">
              <span className="text-foreground font-medium">A note on sample size: </span>
              {honestyCaption(trAll.total)}
            </p>
          </div>

          {/* Per-window grid */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <WindowCell windowLabel="last 7 days" {...tr7} />
            <WindowCell windowLabel="last 30 days" {...tr30} />
            <WindowCell windowLabel="last 90 days" {...tr90} />
            <WindowCell windowLabel="all-time" {...trAll} />
          </div>

          {/* What the CI actually means — one short explanation */}
          <details className="group cursor-pointer">
            <summary className="text-muted-foreground hover:text-foreground text-xs leading-relaxed select-none">
              What does the 95% confidence interval actually mean?
            </summary>
            <p className="text-muted-foreground mt-2 pl-4 text-xs leading-relaxed">
              It&apos;s the range that the <span className="text-foreground italic">true</span>{" "}
              accuracy most likely sits in, given the limited sample we&apos;ve resolved so far. A
              60% headline with a (40–80%) CI means: with this much data, anything from 40% to 80%
              is statistically consistent with what we&apos;ve seen. As more predictions resolve,
              the CI shrinks — that&apos;s how you know the number is becoming trustworthy. (We use
              the{" "}
              <a
                href="https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval#Wilson_score_interval"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline-offset-2 hover:underline"
              >
                Wilson score interval
              </a>
              , the standard for binomial proportions at small N.)
            </p>
          </details>

          {/* Feedback prompt — a real way for users to tell us this is/isn't helping */}
          <div className="border-border/40 border-t pt-3">
            <p className="text-muted-foreground text-xs leading-relaxed">
              <span className="text-foreground">Have feedback?</span> Tell us what&apos;s missing,
              confusing, or wrong —{" "}
              <a
                href="https://github.com/neelesh1206/market-mind/issues/new?labels=feedback&title=Feedback%3A%20"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
              >
                open a GitHub issue
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>{" "}
              or email{" "}
              <a
                href="mailto:neelesh1206@gmail.com?subject=MarketMind%20feedback"
                className="text-foreground underline-offset-2 hover:underline"
              >
                neelesh1206@gmail.com
              </a>
              . Honest critique on whether the calls are helping you make sense of the market is
              the single most valuable input we can get right now.
            </p>
          </div>
        </section>

        {/* What we don't do */}
        <section className="border-border/60 bg-card/30 space-y-3 rounded-xl border p-6">
          <h2 className="text-base font-semibold">What MarketMind is not</h2>
          <ul className="text-muted-foreground space-y-1.5 text-sm leading-relaxed">
            <li>
              <span className="text-foreground">Not</span> investment advice or a trading
              recommendation.
            </li>
            <li>
              <span className="text-foreground">Not</span> a real-money platform — every credit is
              virtual.
            </li>
            <li>
              <span className="text-foreground">Not</span> a black-box model that hides reasoning —
              every score links back to its sources.
            </li>
            <li>
              <span className="text-foreground">Not</span> a real-time trading tool — the pipeline
              runs nightly, not tick-by-tick.
            </li>
          </ul>
        </section>

        {/* Where the numbers come from */}
        <section className="space-y-4">
          <header className="space-y-1">
            <h2 className="text-2xl font-semibold">Where the numbers come from</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              The signals you see on every stock card are not computed in your browser. A nightly
              Python job does the work — here&apos;s what it does and why.
            </p>
          </header>

          <div className="border-border/60 bg-card/30 space-y-3 rounded-xl border p-6">
            <p className="text-foreground/90 text-sm font-medium">The 90-second version</p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Every weeknight at 8 PM ET, a Python pipeline runs on GitHub&apos;s servers and acts
              like a research analyst: it visits ~10 data sources for each of our 50 stocks, scores
              everything, and writes the result to the database. In the morning, the app just reads
              those pre-computed rows. The signals you see were computed once overnight — not when
              you opened the page.
            </p>
          </div>

          <div className="border-border/60 bg-card/30 space-y-3 rounded-xl border p-6">
            <p className="text-foreground/90 text-sm font-medium">What gets pulled per stock</p>
            <ul className="text-muted-foreground space-y-1.5 text-sm leading-relaxed">
              <li>
                <span className="text-foreground font-medium">Prices &amp; technicals</span> — one
                year of daily OHLCV bars from Yahoo Finance, then RSI / MACD / moving averages
                computed locally.
              </li>
              <li>
                <span className="text-foreground font-medium">News headlines</span> — up to ~20
                articles per stock from Massive (formerly Polygon.io). Each article ships with
                Polygon&apos;s ticker-specific relevance + sentiment metadata, which we use to
                drop passing mentions before they hit the pipeline.
              </li>
              <li>
                <span className="text-foreground font-medium">Analyst ratings</span> —
                buy/hold/sell consensus plus price targets from Finnhub.
              </li>
              <li>
                <span className="text-foreground font-medium">Insider activity</span> — Form 4
                transactions plus 8-K material events straight from SEC EDGAR (free, government
                source).
              </li>
              <li>
                <span className="text-foreground font-medium">Social mentions</span> — StockTwits
                bullish %, r/wallstreetbets attention, Reddit mention deltas.
              </li>
              <li>
                <span className="text-foreground font-medium">Macro context</span> — VIX level and
                sector ETF performance from FRED.
              </li>
            </ul>
          </div>

          <div className="border-border/60 bg-card/30 space-y-3 rounded-xl border p-6">
            <p className="text-foreground/90 text-sm font-medium">
              Two AI models do the parts math can&apos;t
            </p>
            <ul className="text-muted-foreground space-y-2 text-sm leading-relaxed">
              <li>
                <span className="text-foreground font-medium">FinBERT</span> reads each news
                article and decides if it&apos;s positive / neutral / negative. We use it instead
                of keyword matching because financial language depends on context —{" "}
                <span className="text-foreground italic">&ldquo;raised guidance&rdquo;</span> is
                bullish, but{" "}
                <span className="text-foreground italic">&ldquo;raised concerns&rdquo;</span> is
                bearish. Its continuous score is then blended with Polygon&apos;s categorical
                per-ticker sentiment so the final number captures both how the article reads
                overall and how it pertains to this specific stock.
              </li>
              <li>
                <span className="text-foreground font-medium">Llama-3 / Mistral</span> turns the
                math (the four bucket scores) into the one-sentence English explanation under the
                verdict chip — &ldquo;Bullish — driven by strong analyst upgrades and rising
                technical momentum.&rdquo; It also writes each article&apos;s TL;DR, seeded with
                Polygon&apos;s ticker-specific reasoning so the summary stays focused on this
                stock instead of the broader article.
              </li>
            </ul>
            <p className="text-muted-foreground text-sm leading-relaxed">
              FinBERT runs locally on the pipeline runner — model and tokenizer load once,
              inference happens in-process, no network round-trips per article. The Llama / Mistral
              call still goes over HuggingFace&apos;s inference API because 7B-parameter models
              don&apos;t fit on a free CI runner. If the LLM call fails or times out, the pipeline
              degrades gracefully: verdict reasoning falls back to a rule-based template. A shared
              circuit breaker bounds the cost of an HF outage to a handful of calls before the rest
              of the run short-circuits to the fallback path. The numerical signal is never blocked
              by an LLM hiccup.
            </p>
          </div>

          <div className="border-border/60 bg-card/30 space-y-3 rounded-xl border p-6">
            <p className="text-foreground/90 text-sm font-medium">The audit trail is public</p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Every signal carries its sources — which fetchers contributed, when the data was
              fetched, whether they agreed or disagreed. This is the moat against the
              &ldquo;robo-advisor&rdquo; framing: data is shown to you, not interpreted for you.
              The code that does all of this is open source —{" "}
              <a
                href="https://github.com/neelesh1206/market-mind/tree/main/pipeline"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
              >
                pipeline/
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
              .
            </p>
          </div>
        </section>

        {/* The four signal buckets */}
        <section id="signals" className="space-y-6 scroll-mt-24">
          <header className="space-y-1">
            <h2 className="text-2xl font-semibold">The four signal buckets</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Each stock gets four independent scores in <code>[-1, +1]</code>. Positive = bullish
              for the next trading day, negative = bearish, zero = neutral. No single bucket is
              &ldquo;right&rdquo; — they often disagree, and that&apos;s the point.
            </p>
          </header>

          <SignalSection
            icon={LineChart}
            title="Technical"
            color="text-blue-500"
            description="Pure price + volume action over the last 200 trading days. No opinion, just math."
            sources={["yfinance OHLCV", "ta-lib indicators"]}
            inputs={[
              "RSI (14-day relative strength)",
              "MACD crossover detection",
              "Price vs 20-day and 50-day moving averages",
              "Bollinger Band position",
              "Volume trend (5-day vs 20-day average)",
            ]}
            formula="Each indicator contributes a sub-score; the bucket is the weighted average with a volume-trend multiplier."
          />

          <SignalSection
            icon={Newspaper}
            title="Sentiment"
            color="text-emerald-500"
            description="What financial journalists are saying about this stock right now."
            sources={[
              "Massive (news API) — including Polygon's per-ticker insights",
              "Finnhub (company news)",
              "MarketWatch (best-effort, when reachable)",
              "FinBERT (sentiment classification)",
              "Llama-3 (per-article summaries on stock detail page)",
            ]}
            inputs={[
              "Up to ~20 recent articles per stock",
              "Polygon's per-ticker relevance gate drops articles that don't specifically discuss this stock (sector pieces, comparables, M&A coverage)",
              "FinBERT classifies each surviving article as positive / neutral / negative",
              "FinBERT's continuous score is averaged with Polygon's categorical per-ticker sentiment",
              "Recency-weighted: today's news matters more than week-old news",
              'Cross-source agreement is reported (e.g. "4 of 5 sources agree")',
            ]}
            formula="Weighted average of per-article (FinBERT-blended-with-Polygon) sentiment scores, scaled by source agreement to avoid noisy single-source spikes."
          />

          <SignalSection
            icon={Landmark}
            title="Professional"
            color="text-amber-500"
            description="What people who do this for a living think — analysts and insiders."
            sources={[
              "Finnhub analyst recommendations",
              "SEC EDGAR Form 4 (insider transactions)",
              "SEC EDGAR 8-K (material events)",
            ]}
            inputs={[
              "Buy / Hold / Sell consensus among covering analysts",
              "Consensus price target vs current price",
              "Recent insider transaction count (last 14 days)",
              "Recent 8-K filings (last 24 hours)",
              "Days until next earnings call",
            ]}
            formula="Analyst buy-share net of sells, plus insider activity bonus, amplified within 3 days of earnings."
          />

          <SignalSection
            icon={MessageSquare}
            title="Social"
            color="text-rose-500"
            description="What retail traders are saying — weighted against the herd effect. The academic literature is clear that retail attention spikes precede underperformance for non-meme tickers (Barber & Odean 2008; Da, Engelberg & Gao 2011), so we fade the crowd rather than follow it."
            sources={[
              "StockTwits (bullish/bearish ratio from tagged messages)",
              "ApeWisdom (r/wallstreetbets mention aggregation)",
              "Reddit API (when configured)",
            ]}
            inputs={[
              "Reddit mention delta vs 7-day average → fade signal at spikes",
              "ApeWisdom rank in top-mentioned tickers → fade signal at top-10",
              "StockTwits bullish percentage → directional signal, but damped when message volume is high",
              "Herding intensity (0..1) computed from the above, damps the directional read further when the crowd is loud",
            ]}
            formula="Herding contribution is negative (fade the crowd); StockTwits bullish ratio contributes positively, scaled down when message count is high or when herding intensity is at peak. See ADR 0013 for the academic basis and exact magnitudes."
          />
        </section>

        {/* How the verdict works */}
        <section className="border-border/60 bg-card/30 space-y-3 rounded-xl border p-6">
          <h2 className="text-base font-semibold">How MarketMind&apos;s daily call works</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Each day the four bucket scores get combined into a single weighted score:
          </p>
          <pre className="bg-muted/50 overflow-x-auto rounded-md p-3 font-mono text-xs leading-relaxed">
            {`# Per-bucket weights
w = { technical: 0.30, sentiment: 0.25,
      professional: 0.30, social: 0.15 }

# Only buckets with actual data contribute.
# Missing buckets are EXCLUDED and weights renormalize over the rest —
# absence of evidence is not evidence of zero.
present   = { k: v for k, v in buckets if v is not None }
combined  = Σ(present[k] * w[k]) / Σ(w[k] for k in present)

direction = "UP"      if combined >  0.15
          | "DOWN"    if combined < -0.15
          | "NEUTRAL" otherwise

confidence = min(|combined|, 1.0)`}
          </pre>
          <p className="text-muted-foreground text-sm leading-relaxed">
            NEUTRAL is a legitimate verdict — when buckets disagree we say so, not force a call. The
            weights are an initial heuristic; as track-record data accumulates, we tune them based
            on what combinations correlate with WIN outcomes (versioned so accuracy maps to specific
            weight cohorts).
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            The renormalization step matters for less-covered tickers. If we have a strong technical
            read but no analyst coverage, the technical bucket carries the call on its own instead
            of getting diluted toward zero by the missing professional input.{" "}
            <a
              href="https://github.com/neelesh1206/market-mind/blob/main/docs/adr/0011-signal-quality-p0-fixes.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
            >
              ADR 0011 <ExternalLink className="h-3 w-3" aria-hidden />
            </a>{" "}
            covers the math.
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            The 0.15 threshold is also <span className="text-foreground">scaled per-stock by
            realized volatility</span>: a low-vol name like PG (daily σ ≈ 0.9%) needs only{" "}
            <span className="text-foreground font-mono">|combined| &gt; 0.075</span> to flip
            directional, while a high-vol name like NVDA (σ ≈ 3.5%) needs{" "}
            <span className="text-foreground font-mono">|combined| &gt; 0.26</span>. Same signal
            magnitude is less informative on noisy stocks, so we require more of it before making a
            call.{" "}
            <a
              href="https://github.com/neelesh1206/market-mind/blob/main/docs/adr/0014-vol-normalize-direction-threshold.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
            >
              ADR 0014 <ExternalLink className="h-3 w-3" aria-hidden />
            </a>{" "}
            documents the design.
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Alongside the per-stock verdict, every prediction also carries a{" "}
            <span className="text-foreground">rank within the day&apos;s universe</span>: rank 1 is
            the strongest bullish call across all 50 stocks, rank N is the strongest bearish. The
            absolute combined score is sensitive to formula choices and bucket scaling; the rank
            is the more honest unit of conviction — &ldquo;today&apos;s top 5 long calls&rdquo;
            is what a long-short factor model would care about.{" "}
            <a
              href="https://github.com/neelesh1206/market-mind/blob/main/docs/adr/0015-cross-sectional-ranking.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
            >
              ADR 0015 <ExternalLink className="h-3 w-3" aria-hidden />
            </a>{" "}
            explains why ranks beat absolute scores.
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            <a
              href="https://github.com/neelesh1206/market-mind/blob/main/docs/adr/0007-verdict-with-track-record.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
            >
              Read ADR 0007 — the full design <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </p>
        </section>

        {/* When does DOWN appear */}
        <section className="space-y-4">
          <header className="space-y-1">
            <h2 className="text-2xl font-semibold">When does the verdict show DOWN?</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              The most common question we get: &ldquo;Why is everything UP?&rdquo; The answer is in
              the math — and in the kinds of stocks people pick. Here&apos;s exactly what it takes.
            </p>
          </header>

          {/* Threshold */}
          <div className="border-border/60 bg-card/30 space-y-2 rounded-xl border p-5">
            <p className="text-foreground/90 text-sm font-medium">The DOWN threshold</p>
            <pre className="bg-muted/50 overflow-x-auto rounded-md p-3 font-mono text-xs leading-relaxed">
              {`combined = 0.30·Tech + 0.25·Sent + 0.30·Prof + 0.15·Soc

if combined > +0.15   →  UP
if combined < -0.15   →  DOWN
otherwise             →  NEUTRAL`}
            </pre>
            <p className="text-muted-foreground text-sm leading-relaxed">
              You need the weighted sum below{" "}
              <span className="text-foreground font-mono">-0.15</span> for a DOWN call. Practically
              that means at least two buckets meaningfully bearish, or one bucket very deeply
              bearish.
            </p>
          </div>

          {/* Scenario table */}
          <div className="border-border/60 bg-card/30 overflow-x-auto rounded-xl border p-5">
            <p className="text-foreground/90 mb-3 text-sm font-medium">
              What different signal mixes produce
            </p>
            <table className="w-full font-mono text-[11px] tabular-nums">
              <thead>
                <tr className="border-border/40 text-muted-foreground border-b text-[10px] tracking-wider uppercase">
                  <th className="px-2 py-1.5 text-left font-medium">Scenario</th>
                  <th className="px-2 py-1.5 text-right font-medium">Tech</th>
                  <th className="px-2 py-1.5 text-right font-medium">Sent</th>
                  <th className="px-2 py-1.5 text-right font-medium">Prof</th>
                  <th className="px-2 py-1.5 text-right font-medium">Soc</th>
                  <th className="px-2 py-1.5 text-right font-medium">= Net</th>
                  <th className="px-2 py-1.5 text-right font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody className="text-foreground/80">
                <ScenarioRow
                  label="Mega-cap normal day"
                  tech={-0.1}
                  sent={0.3}
                  prof={0.7}
                  soc={0.5}
                  net={0.32}
                  verdict="UP"
                />
                <ScenarioRow
                  label="Mixed signals"
                  tech={-0.3}
                  sent={-0.2}
                  prof={0.3}
                  soc={-0.2}
                  net={-0.08}
                  verdict="NEUTRAL"
                />
                <ScenarioRow
                  label="Earnings miss"
                  tech={-0.4}
                  sent={-0.5}
                  prof={-0.3}
                  soc={-0.4}
                  net={-0.4}
                  verdict="DOWN"
                />
                <ScenarioRow
                  label="Big downgrade wave"
                  tech={0.1}
                  sent={-0.2}
                  prof={-0.7}
                  soc={-0.3}
                  net={-0.25}
                  verdict="DOWN"
                />
                <ScenarioRow
                  label="RSI overbought only"
                  tech={-0.7}
                  sent={0.2}
                  prof={0.5}
                  soc={0.4}
                  net={0.05}
                  verdict="NEUTRAL"
                />
              </tbody>
            </table>
          </div>

          {/* Why feeds lean UP */}
          <div className="border-border/60 bg-card/30 space-y-3 rounded-xl border p-5">
            <p className="text-foreground/90 text-sm font-medium">
              Why your feed probably leans UP
            </p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              If you picked mega-caps (AAPL, NVDA, MSFT, GOOGL, META…), the bullish bias is
              structural — not a bug. Mega-caps have a different signal distribution than the
              broader market:
            </p>
            <ul className="text-muted-foreground space-y-1.5 text-sm leading-relaxed">
              <li>
                <span className="text-foreground font-medium">Professional (30% weight):</span>{" "}
                Analysts rate mega-caps Buy/Hold roughly 85% of the time. Sell ratings are
                vanishingly rare.
              </li>
              <li>
                <span className="text-foreground font-medium">Sentiment (25% weight):</span>{" "}
                Coverage is mostly favorable — earnings beats, AI hype, expansion stories. Major
                negative coverage requires a real catalyst.
              </li>
              <li>
                <span className="text-foreground font-medium">Social (15% weight):</span> High
                retail attention typically comes with bullish framing.
              </li>
              <li>
                <span className="text-foreground font-medium">Technical (30% weight):</span> The
                only bucket that swings both ways equally — but one bearish technical contribution
                alone caps at -0.30, not enough to push past the threshold.
              </li>
            </ul>
            <p className="text-muted-foreground text-sm leading-relaxed">
              That&apos;s why <span className="text-foreground font-mono">COIN</span> with Technical{" "}
              <span className="font-mono text-red-500">-0.50</span> still shows{" "}
              <span className="text-foreground font-mono">NEUTRAL</span> when Professional{" "}
              <span className="font-mono text-emerald-500">+0.58</span> + Social{" "}
              <span className="font-mono text-emerald-500">+0.42</span> neutralize the bearish
              technical. The math is doing exactly what it should.
            </p>
          </div>

          {/* Real scenarios that flip DOWN */}
          <div className="border-border/60 bg-card/30 space-y-3 rounded-xl border p-5">
            <p className="text-foreground/90 text-sm font-medium">
              Real-world triggers for DOWN verdicts
            </p>
            <ul className="text-muted-foreground space-y-1.5 text-sm leading-relaxed">
              <li>
                <span className="text-foreground font-medium">Day after a bad earnings miss</span> —
                Sentiment crashes, Technical follows, often Professional downgrades pile on within
                24-48 hours
              </li>
              <li>
                <span className="text-foreground font-medium">Analyst downgrade wave</span> —
                Professional is the biggest single weight; a 30% drop here moves the needle hard
              </li>
              <li>
                <span className="text-foreground font-medium">Regulatory bombshell</span> — FTC
                suit, FDA rejection, DOJ probe — flips Sentiment + Professional in one news cycle
              </li>
              <li>
                <span className="text-foreground font-medium">Insider sell cluster</span> — multiple
                Form 4 filings within a few days flips Professional to negative even before analysts
                react
              </li>
              <li>
                <span className="text-foreground font-medium">Broad macro selloff</span> — Technical
                breaks down across the board, VIX spikes; mega-caps less affected than small-caps
              </li>
            </ul>
          </div>

          {/* How to see DOWN naturally */}
          <div className="border-border/60 bg-card/30 space-y-3 rounded-xl border p-5">
            <p className="text-foreground/90 text-sm font-medium">
              Want to see DOWN verdicts in your feed?
            </p>
            <ol className="text-muted-foreground ml-4 list-decimal space-y-1.5 text-sm leading-relaxed">
              <li>
                Add some <span className="text-foreground">volatile or struggling tickers</span> to
                your watchlist alongside the mega-caps — names like RIVN, LCID, GME, AFRM often skew
                bearish on technical setups.
              </li>
              <li>
                Watch your watchlist during <span className="text-foreground">earnings season</span>{" "}
                — post-miss days are when the system genuinely calls DOWN.
              </li>
              <li>
                Don&apos;t expect daily DOWN calls on diversified mega-cap watchlists. When DOWN
                does show up there, it&apos;s a stronger signal precisely{" "}
                <span className="text-foreground italic">because</span> it&apos;s rare.
              </li>
            </ol>
          </div>
        </section>

        {/* Cadence + freshness */}
        <section className="space-y-3">
          <h2 className="text-2xl font-semibold">Update cadence</h2>
          <ul className="text-muted-foreground space-y-1.5 text-sm leading-relaxed">
            <li>
              <span className="text-foreground font-mono">8:00 PM ET</span> — pipeline kicks off the
              night before. Crunching ~50 stocks (news, social, technicals, FinBERT, Llama
              summaries) typically takes 15–25 minutes.
            </li>
            <li>
              <span className="text-foreground font-mono">~8:25 PM ET</span> — pipeline completes.
              Fresh insights + verdict for the next trading day are live; bet window opens.
            </li>
            <li>
              <span className="text-foreground font-mono">9:30 AM ET</span> — market opens. Bet
              window stays open — you can place bets while watching live price action.
            </li>
            <li>
              <span className="text-foreground font-mono">1:00 PM ET</span> — bet window locks (= 10
              AM PT). Late bettors trade prediction time for confirmation. The verdict was made the
              night before — only the user&apos;s call is informed by intraday moves.
            </li>
            <li>
              <span className="text-foreground font-mono">4:00 PM ET</span> — market closes.
            </li>
            <li>
              <span className="text-foreground font-mono">4:15 PM ET</span> — resolution job runs.
              Three scoring windows depending on what&apos;s being resolved and when the user bet:
              <ul className="text-muted-foreground mt-1.5 ml-5 list-disc space-y-1.5 text-sm leading-relaxed">
                <li>
                  <span className="text-foreground">MarketMind&apos;s daily verdict</span> is scored{" "}
                  <span className="text-foreground font-mono">sign(close − prev_close)</span> — the
                  window matches when the call was made (8 PM the night before), so the overnight
                  gap is part of the prediction.
                </li>
                <li>
                  <span className="text-foreground">Pre-market user bets</span> (placed any time
                  from 8 PM the night before up to 9:30 AM ET) are scored{" "}
                  <span className="text-foreground font-mono">sign(close − open)</span> — neither
                  the user nor the verdict had a real intraday price to anchor on, so the open is
                  the only equitable bar.
                </li>
                <li>
                  <span className="text-foreground">In-market user bets</span> (placed between
                  9:30 AM and 1 PM ET) are scored{" "}
                  <span className="text-foreground font-mono">sign(close − entry)</span> — where
                  <em> entry</em> is the live price (Finnhub real-time quote) at the moment the bet
                  landed. This was a fairness change in May 2026: with a single open-based bar, a
                  user betting UP at 12:30 PM with the stock already up 2% only needed the close
                  to <em>stay</em> above the open — a much easier call than the 8 PM bettor who
                  had to predict the whole day. Anchoring in-market bets to the user&apos;s actual
                  entry price puts both bettors on equal footing.
                </li>
              </ul>
            </li>
          </ul>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Stock quotes are <span className="text-foreground">real-time</span> for the live price
            on cards and detail pages (Finnhub free tier, ~5 min Upstash cache). News articles
            surface within 1-2 hours of publication. See{" "}
            <a
              href="https://github.com/neelesh1206/market-mind/blob/main/docs/adr/0008-bet-window-into-market-hours.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
            >
              ADR 0008
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>{" "}
            for why the bet window extends past market open,{" "}
            <a
              href="https://github.com/neelesh1206/market-mind/blob/main/docs/adr/0017-entry-vs-close-resolution-for-in-market-bets.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
            >
              ADR 0017
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>{" "}
            for the two-mode resolution model that fixed the inequity, and{" "}
            <a
              href="https://github.com/neelesh1206/market-mind/blob/main/docs/adr/0011-signal-quality-p0-fixes.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
            >
              ADR 0011
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>{" "}
            for why MarketMind&apos;s own verdict uses a different window than user bets.
          </p>
        </section>

        {/* Limitations */}
        <section className="space-y-3">
          <h2 className="text-2xl font-semibold">Honest limitations</h2>
          <ul className="text-muted-foreground space-y-2 text-sm leading-relaxed">
            <li>
              <span className="text-foreground">No backtest yet.</span> The signal formulas are
              based on conventional technical analysis and standard financial NLP, but we
              haven&apos;t published historical accuracy. That ships when we have it.
            </li>
            <li>
              <span className="text-foreground">50-stock pool.</span> Curated mega-caps and popular
              tickers — not the full market.
            </li>
            <li>
              <span className="text-foreground">Daily, not real-time.</span> Designed for overnight
              prediction, not intraday trading.
            </li>
            <li>
              <span className="text-foreground">English-language sources only.</span> Non-US news
              gets less coverage.
            </li>
            <li>
              <span className="text-foreground">FinBERT is good, not perfect.</span> It can
              misclassify finance-specific irony or jargon. Blending with Polygon&apos;s
              per-ticker sentiment + cross-source agreement helps but doesn&apos;t eliminate
              the problem.
            </li>
          </ul>
        </section>

        {/* Project */}
        <section className="border-border/60 bg-card/30 space-y-3 rounded-xl border p-6">
          <h2 className="text-base font-semibold">About the project</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            MarketMind is a personal showcase project built by{" "}
            <a
              href="https://neeleshkakaraparthi.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline-offset-2 hover:underline"
            >
              Neelesh Kakaraparthi
            </a>
            . The full architecture, design decisions (ADRs), and pipeline code are open source on
            GitHub.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <a
              href="https://github.com/neelesh1206/market-mind"
              target="_blank"
              rel="noopener noreferrer"
              className="border-border/60 bg-card text-foreground hover:bg-card/80 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
            >
              <GithubMark className="h-3.5 w-3.5" />
              Source on GitHub
            </a>
            <a
              href="https://github.com/neelesh1206/market-mind/tree/main/docs/adr"
              target="_blank"
              rel="noopener noreferrer"
              className="border-border/60 bg-card text-foreground hover:bg-card/80 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              Architecture Decision Records
            </a>
          </div>
        </section>
      </main>

      <footer className="border-border/60 border-t">
        <div className="text-muted-foreground/70 mx-auto w-full max-w-3xl px-6 py-4 text-xs">
          For educational purposes only. Not investment advice. No real money is involved.
        </div>
      </footer>
    </div>
  );
}

function SignalSection({
  icon: Icon,
  title,
  color,
  description,
  sources,
  inputs,
  formula,
}: {
  icon: LucideIcon;
  title: string;
  color: string;
  description: string;
  sources: string[];
  inputs: string[];
  formula: string;
}) {
  return (
    <article className="border-border/60 bg-card/30 space-y-4 rounded-xl border p-6">
      <header className="flex items-center gap-2">
        <Icon className={`${color} h-5 w-5`} aria-hidden />
        <h3 className="text-lg font-semibold">{title}</h3>
      </header>
      <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
            Sources
          </p>
          <ul className="mt-1.5 space-y-0.5 text-sm">
            {sources.map((s) => (
              <li key={s} className="text-foreground/80">
                · {s}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
            What goes in
          </p>
          <ul className="mt-1.5 space-y-0.5 text-sm">
            {inputs.map((i) => (
              <li key={i} className="text-foreground/80">
                · {i}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="border-border/40 text-muted-foreground border-t pt-3 text-xs leading-relaxed">
        <span className="text-foreground font-medium">Scoring:</span> {formula}
      </p>
    </article>
  );
}

function ScenarioRow({
  label,
  tech,
  sent,
  prof,
  soc,
  net,
  verdict,
}: {
  label: string;
  tech: number;
  sent: number;
  prof: number;
  soc: number;
  net: number;
  verdict: "UP" | "DOWN" | "NEUTRAL";
}) {
  const fmt = (n: number) => (n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2));
  const tone = (n: number) =>
    n > 0.05 ? "text-emerald-500" : n < -0.05 ? "text-red-500" : "text-muted-foreground";
  const vClass =
    verdict === "UP"
      ? "text-emerald-500"
      : verdict === "DOWN"
        ? "text-red-500"
        : "text-muted-foreground";
  return (
    <tr className="border-border/30 border-b last:border-b-0">
      <td className="text-foreground/90 px-2 py-1.5 font-sans text-xs normal-case">{label}</td>
      <td className={`px-2 py-1.5 text-right ${tone(tech)}`}>{fmt(tech)}</td>
      <td className={`px-2 py-1.5 text-right ${tone(sent)}`}>{fmt(sent)}</td>
      <td className={`px-2 py-1.5 text-right ${tone(prof)}`}>{fmt(prof)}</td>
      <td className={`px-2 py-1.5 text-right ${tone(soc)}`}>{fmt(soc)}</td>
      <td className={`px-2 py-1.5 text-right font-semibold ${tone(net)}`}>{fmt(net)}</td>
      <td className={`px-2 py-1.5 text-right font-semibold ${vClass}`}>{verdict}</td>
    </tr>
  );
}

/**
 * Sample-size-aware framing in front of the multi-window track-record grid.
 * The thresholds (30, 100) are heuristic — they correspond to roughly the
 * sample sizes where the Wilson CI half-width drops below 0.15 and 0.10
 * respectively at 50% accuracy.
 */
function honestyCaption(allTimeTotal: number): string {
  if (allTimeTotal === 0) {
    return "No predictions have resolved yet. The first day's worth of accuracy data lands the trading day after launch.";
  }
  if (allTimeTotal < 30) {
    return `Only ${allTimeTotal} resolved predictions so far — the confidence interval is wide on purpose. With this little data, the headline accuracy number is mostly noise. We need ~100+ resolutions before it starts to mean something stable.`;
  }
  if (allTimeTotal < 100) {
    return `${allTimeTotal} resolved predictions in. The CI is still wide; we'd want at least 100 before claiming the accuracy number is stable. Keep watching it narrow.`;
  }
  return `${allTimeTotal} resolved predictions and counting. The confidence interval has narrowed enough that the headline accuracy is a defensible estimate — but still bounded by the CI, not equal to the point estimate.`;
}

/**
 * One cell in the multi-window track-record grid. Renders a window label
 * + the badge with CI inline. Empty windows show "Building track record"
 * (handled by the badge itself).
 */
function WindowCell({
  windowLabel,
  total,
  correct,
  accuracy,
  ciLower,
  ciUpper,
}: {
  windowLabel: string;
  total: number;
  correct: number;
  accuracy: number | null;
  ciLower: number | null;
  ciUpper: number | null;
}) {
  return (
    <div className="border-border/40 bg-background/40 rounded-md border px-3 py-2.5">
      <p className="text-muted-foreground mb-1.5 text-[10px] tracking-wider uppercase">
        {windowLabel}
      </p>
      <TrackRecordBadge
        total={total}
        correct={correct}
        accuracy={accuracy}
        ciLower={ciLower}
        ciUpper={ciUpper}
      />
    </div>
  );
}
