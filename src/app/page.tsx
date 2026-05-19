import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchUserWatchlist } from "@/lib/watchlist";
import { fetchHomeFeed, fetchTrackRecord, rankFeed } from "@/lib/feed";
import { ProfileMenu } from "@/components/profile-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { StockCard } from "@/components/stock-card";
import { TrackRecordBadge } from "@/components/track-record-badge";

export default async function Home() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/login");
  }

  const userId = data.claims.sub as string;
  const email = (data.claims.email ?? userId) as string;

  // New users with no watchlist → send to onboarding
  const watchlist = await fetchUserWatchlist(supabase, userId);
  if (watchlist.length === 0) {
    redirect("/onboarding");
  }

  // Fetch latest insights + top articles for the watchlist + track record
  const [feedUnsorted, trackRecord] = await Promise.all([
    fetchHomeFeed(supabase, watchlist),
    fetchTrackRecord(supabase, 30),
  ]);
  const feed = rankFeed(feedUnsorted);

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("display_name, credit_balance, current_streak")
    .eq("id", userId)
    .maybeSingle();

  const credits = profile?.credit_balance ?? 0;
  const streak = profile?.current_streak ?? 0;
  const name = profile?.display_name ?? email;

  const cardsWithInsight = feed.filter((d) => d.insight !== null);
  const cardsAwaiting = feed.filter((d) => d.insight === null);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="border-border/60 bg-background/60 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-emerald-500 to-emerald-700">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-4 w-4 text-white"
                aria-hidden="true"
              >
                <path
                  d="M3 17L9 11L13 15L21 7"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M15 7H21V13"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <span className="text-lg font-semibold tracking-tight">MarketMind</span>
          </div>

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

      {/* Main */}
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-10">
        <section className="space-y-2">
          <p className="text-muted-foreground text-sm">
            Welcome back, <span className="text-foreground font-medium">{name}</span>
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Today&apos;s feed</h1>
          <div className="pt-1">
            <TrackRecordBadge
              total={trackRecord.total}
              correct={trackRecord.correct}
              accuracy={trackRecord.accuracy}
              windowLabel="30 days"
            />
          </div>
        </section>

        {/* Quick stats row */}
        <section className="grid grid-cols-3 gap-3">
          <Stat label="Credits" value={credits.toLocaleString()} />
          <Stat label="Streak" value={streak.toString()} />
          <Stat label="Watchlist" value={watchlist.length.toString()} />
        </section>

        {/* Cards with insights */}
        {cardsWithInsight.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                Ranked by signal strength
              </h2>
              <span className="text-muted-foreground text-[11px]">
                {cardsWithInsight.length} stocks
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {cardsWithInsight.map((card) => (
                <StockCard key={card.stock.id} data={card} />
              ))}
            </div>
          </section>
        )}

        {/* Awaiting-pipeline cards */}
        {cardsAwaiting.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              Awaiting next pipeline run
            </h2>
            <p className="text-muted-foreground text-sm">
              {cardsAwaiting.length} stocks on your watchlist don&apos;t have insights computed yet.
              The pipeline runs nightly at 8 PM ET; trigger it manually from{" "}
              <a
                href="https://github.com/neelesh1206/market-mind/actions/workflows/fetch-insights.yml"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline-offset-2 hover:underline"
              >
                Actions → Fetch Insights
              </a>{" "}
              to backfill.
            </p>
            <div className="flex flex-wrap gap-2">
              {cardsAwaiting.map((c) => (
                <span
                  key={c.stock.id}
                  className="border-border/60 bg-card/30 text-muted-foreground rounded-md border px-2 py-1 font-mono text-xs"
                >
                  {c.stock.ticker}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Bet-window note */}
        <section className="border-border/60 bg-card/20 flex flex-col items-start gap-2 rounded-xl border p-5">
          <span className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
            Bet window
          </span>
          <p className="text-sm leading-relaxed">
            Predictions for the next trading day open at{" "}
            <span className="font-mono">8:00 PM ET</span> and lock at{" "}
            <span className="font-mono">9:15 AM ET</span> the next morning. The UP/DOWN buttons on
            each card go live once the bet sheet ships.
          </p>
        </section>
      </main>

      <footer className="border-border/60 border-t">
        <div className="text-muted-foreground/70 mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-6 py-4 text-xs">
          <span>For educational purposes only. Not investment advice.</span>
          <Link href="/about" className="hover:text-foreground underline-offset-2 hover:underline">
            How signals are computed →
          </Link>
        </div>
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border/60 bg-card/30 rounded-xl border p-4">
      <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
