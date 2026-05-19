import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllStocks, fetchUserWatchlist, WATCHLIST_MAX } from "@/lib/watchlist";
import { ProfileMenu } from "@/components/profile-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { StockBrowser } from "@/components/stock-browser";

export const metadata = { title: "Browse stocks" };

/**
 * Browse-the-pool page. Lists all active stocks with sector filter +
 * search + per-row add/remove watchlist toggle. Server fetches the full
 * pool + current watchlist; client handles filter + toggle UX.
 */
export default async function StocksPage() {
  const supabase = await createClient();
  const { data: claims, error: authErr } = await supabase.auth.getClaims();
  if (authErr || !claims?.claims) {
    redirect("/login");
  }
  const userId = claims.claims.sub as string;
  const email = (claims.claims.email ?? userId) as string;

  const [allStocks, watchlist, profileRes] = await Promise.all([
    fetchAllStocks(supabase),
    fetchUserWatchlist(supabase, userId),
    supabase
      .from("user_profiles")
      .select("display_name, credit_balance")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  const profile = profileRes.data;
  const credits = profile?.credit_balance ?? 0;
  const name = profile?.display_name ?? email;
  const watchlistIds = watchlist.map((s) => s.id);

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

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
        <section className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Browse stocks</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            All {allStocks.length} stocks in the MarketMind pool. Add up to {WATCHLIST_MAX} to
            your watchlist — they&apos;ll show up on your home feed with the day&apos;s signals.
          </p>
        </section>

        <StockBrowser
          stocks={allStocks}
          initialWatchlistIds={watchlistIds}
          watchlistMax={WATCHLIST_MAX}
        />
      </main>
    </div>
  );
}
