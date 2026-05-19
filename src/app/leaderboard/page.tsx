import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { fetchUserWatchlist } from "@/lib/watchlist";
import { fetchLatestLeaderboard } from "@/lib/leaderboard";
import { ProfileMenu } from "@/components/profile-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { LeaderboardTable } from "@/components/leaderboard-table";

export const metadata = { title: "Leaderboard" };

export default async function LeaderboardPage() {
  const supabase = await createClient();
  const { data: claims, error: authErr } = await supabase.auth.getClaims();
  if (authErr || !claims?.claims) {
    redirect("/login");
  }
  const userId = claims.claims.sub as string;
  const email = (claims.claims.email ?? userId) as string;

  const [profileRes, watchlist, snapshot] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("display_name, credit_balance")
      .eq("id", userId)
      .maybeSingle(),
    fetchUserWatchlist(supabase, userId),
    fetchLatestLeaderboard(supabase, 20),
  ]);

  const profile = profileRes.data;
  const credits = profile?.credit_balance ?? 0;
  const name = profile?.display_name ?? email;

  const weekLabel = snapshot.weekStart ? formatWeekRange(snapshot.weekStart) : null;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border/60 bg-background/60 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-3">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            <span>Back to feed</span>
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

      <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
        <section className="space-y-2">
          <p className="text-xs font-medium tracking-wider text-emerald-500 uppercase">
            <Trophy className="mr-1 inline h-3.5 w-3.5" aria-hidden /> Weekly leaderboard
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {weekLabel ? `Week of ${weekLabel}` : "Leaderboard"}
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Ranked by accuracy on resolved bets — minimum 5 decisive (WIN or LOSS) calls to
            qualify. VOIDs don&apos;t count toward the denominator. Recomputes every Sunday
            evening UTC.
          </p>
        </section>

        <LeaderboardTable rows={snapshot.rows} currentUserId={userId} />

        {snapshot.weekStart === null && (
          <p className="text-muted-foreground text-center text-xs">
            First snapshot lands the Sunday after enough users hit 5 resolved bets in a week.
          </p>
        )}
      </main>
    </div>
  );
}

function formatWeekRange(weekStart: string): string {
  const [y, m, d] = weekStart.split("-").map(Number);
  if (!y || !m || !d) return weekStart;
  const start = new Date(Date.UTC(y, m - 1, d));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);

  const fmt = (dt: Date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
    }).format(dt);

  return `${fmt(start)} – ${fmt(end)}`;
}
