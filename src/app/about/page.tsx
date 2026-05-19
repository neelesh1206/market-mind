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
  const [tr30, tr90] = await Promise.all([
    fetchTrackRecord(supabase, 30),
    fetchTrackRecord(supabase, 90),
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

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-6 py-12">
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

        {/* Track record */}
        <section className="border-border/60 bg-card/30 space-y-3 rounded-xl border p-6">
          <h2 className="text-base font-semibold">Our track record</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            MarketMind&apos;s daily verdicts are resolved against actual market close. We publish
            the score for accountability — small samples are noisy, so we always show the
            denominator.
          </p>
          <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:gap-6">
            <TrackRecordBadge
              total={tr30.total}
              correct={tr30.correct}
              accuracy={tr30.accuracy}
              windowLabel="30 days"
            />
            <TrackRecordBadge
              total={tr90.total}
              correct={tr90.correct}
              accuracy={tr90.accuracy}
              windowLabel="90 days"
            />
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

        {/* The four signal buckets */}
        <section className="space-y-6">
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
              "Massive (news API)",
              "Finnhub (company news)",
              "MarketWatch (best-effort, when reachable)",
              "FinBERT (sentiment classification)",
              "Llama-3 (per-article summaries on stock detail page)",
            ]}
            inputs={[
              "Up to ~20 recent articles per stock",
              "FinBERT classifies each as positive / neutral / negative",
              "Recency-weighted: today's news matters more than week-old news",
              'Cross-source agreement is reported (e.g. "4 of 5 sources agree")',
            ]}
            formula="Weighted average of per-article sentiment scores, scaled by source agreement to avoid noisy single-source spikes."
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
            description="What retail traders are saying — both the wisdom of crowds and the noise."
            sources={[
              "StockTwits (bullish/bearish ratio from tagged messages)",
              "ApeWisdom (r/wallstreetbets mention aggregation)",
              "Reddit API (when configured)",
            ]}
            inputs={[
              "StockTwits bullish percentage among tagged messages",
              "ApeWisdom rank in top-mentioned tickers",
              "Reddit mention delta vs 7-day average",
            ]}
            formula="Bullish ratio (centered at 50%) plus mention-spike bonus, capped to avoid memestock distortion."
          />
        </section>

        {/* How the verdict works */}
        <section className="border-border/60 bg-card/30 space-y-3 rounded-xl border p-6">
          <h2 className="text-base font-semibold">How MarketMind&apos;s daily call works</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Each day the four bucket scores get combined into a single weighted score:
          </p>
          <pre className="bg-muted/50 overflow-x-auto rounded-md p-3 font-mono text-xs leading-relaxed">
            {`combined = 0.30 * technical
         + 0.25 * sentiment
         + 0.30 * professional
         + 0.15 * social

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
              <span className="text-foreground font-mono">8:00 PM ET</span> — pipeline runs. Fresh
              insights for the next trading day are computed and written.
            </li>
            <li>
              <span className="text-foreground font-mono">9:15 AM ET</span> — bet window closes for
              the day.
            </li>
            <li>
              <span className="text-foreground font-mono">4:15 PM ET</span> — resolution job
              evaluates the day&apos;s predictions against market close.
            </li>
          </ul>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Stock prices are 15-minute delayed (Massive Starter tier). News articles surface within
            1-2 hours of publication.
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
              misclassify finance-specific irony or jargon. Cross-source agreement helps but
              doesn&apos;t eliminate the problem.
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
