import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { fetchUserWatchlist } from "@/lib/watchlist";
import { fetchUserBadges, BADGE_CATALOG } from "@/lib/badges";
import { CreditsChip } from "@/components/credits-chip";
import { ProfileMenu } from "@/components/profile-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { BadgeGrid } from "@/components/badge-grid";

export const metadata = { title: "Profile" };

/**
 * User profile — stats header + badge grid.
 *
 * Stats are read straight from `user_profiles`. Badges come through the
 * catalog filter in `fetchUserBadges`, so orphaned legacy types don't crash
 * the page.
 */
export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: claims, error: authErr } = await supabase.auth.getClaims();
  if (authErr || !claims?.claims) {
    redirect("/login");
  }
  const userId = claims.claims.sub as string;
  const email = (claims.claims.email ?? userId) as string;

  const [profileRes, watchlist, badges] = await Promise.all([
    supabase
      .from("user_profiles")
      .select(
        "display_name, credit_balance, total_predictions, correct_predictions, current_streak, longest_streak, created_at",
      )
      .eq("id", userId)
      .maybeSingle(),
    fetchUserWatchlist(supabase, userId),
    fetchUserBadges(supabase, userId),
  ]);

  const profile = profileRes.data;
  const credits = profile?.credit_balance ?? 0;
  const name = profile?.display_name ?? email;
  const total = profile?.total_predictions ?? 0;
  const correct = profile?.correct_predictions ?? 0;
  const currentStreak = profile?.current_streak ?? 0;
  const longestStreak = profile?.longest_streak ?? 0;
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : null;
  const memberSince = profile?.created_at
    ? new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
        new Date(profile.created_at),
      )
    : null;

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
            <CreditsChip credits={credits} />
            <ThemeToggle />
            <ProfileMenu email={email} displayName={name} watchlistCount={watchlist.length} />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
        {/* Identity */}
        <section className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">{name}</h1>
          {memberSince && (
            <p className="text-muted-foreground text-sm">Member since {memberSince}</p>
          )}
        </section>

        {/* Stats */}
        <section className="border-border/60 bg-card/30 grid grid-cols-2 gap-4 rounded-xl border p-4 sm:grid-cols-4">
          <Stat label="Predictions" value={total.toLocaleString()} />
          <Stat
            label="Accuracy"
            value={accuracy === null ? "—" : `${accuracy}%`}
            sub={accuracy === null ? "No resolved bets" : `${correct} / ${total}`}
          />
          <Stat
            label="Current streak"
            value={`${currentStreak}d`}
            sub={currentStreak > 0 ? "Keep it alive" : "Claim daily to start"}
          />
          <Stat
            label="Longest streak"
            value={`${longestStreak}d`}
            sub={longestStreak > currentStreak ? "Personal best" : "Today is the best"}
          />
        </section>

        {/* Badges */}
        <section className="space-y-3">
          <header className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold">Badges</h2>
            <p className="text-muted-foreground text-xs tabular-nums">
              {badges.length} / {BADGE_CATALOG.length}
            </p>
          </header>
          <BadgeGrid earned={badges} />
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
        {label}
      </p>
      <p className="font-mono text-xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-muted-foreground text-[11px]">{sub}</p>}
    </div>
  );
}
