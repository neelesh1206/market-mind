import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllStocks, fetchUserWatchlist, WATCHLIST_MAX } from "@/lib/watchlist";
import {
  fetchTopStockRequests,
  fetchUserStockRequests,
  fetchUserWeeklyRequestCount,
} from "@/lib/stock-requests";
import { CreditsChip } from "@/components/credits-chip";
import { ProfileMenu } from "@/components/profile-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { StockBrowser } from "@/components/stock-browser";
import { StockRequestPanel } from "@/components/stock-request-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata = { title: "Manage stocks" };

// Aggregate-count freshness: each visit re-fetches. Requests are low-volume,
// so the cost is negligible and votes feel responsive.
export const revalidate = 0;

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

  const [
    allStocks,
    watchlist,
    profileRes,
    topRequests,
    userVotes,
    weeklyUsed,
  ] = await Promise.all([
    fetchAllStocks(supabase),
    fetchUserWatchlist(supabase, userId),
    supabase
      .from("user_profiles")
      .select("display_name, credit_balance")
      .eq("id", userId)
      .maybeSingle(),
    fetchTopStockRequests(supabase, 100),
    fetchUserStockRequests(supabase, userId),
    fetchUserWeeklyRequestCount(supabase),
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
            <CreditsChip credits={credits} />
            <ThemeToggle />
            <ProfileMenu email={email} displayName={name} watchlistCount={watchlist.length} />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
        <section className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Manage stocks</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {allStocks.length} stocks in the universe. Add up to {WATCHLIST_MAX} to your watchlist —
            or request a new ticker to be added.
          </p>
        </section>

        <Tabs defaultValue="browse" className="space-y-5">
          <TabsList>
            <TabsTrigger value="browse">
              Browse available
              <span className="text-muted-foreground ml-1.5 font-mono text-[10px] tabular-nums">
                {allStocks.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="request">
              Request to be added
              {topRequests.length > 0 && (
                <span className="text-muted-foreground ml-1.5 font-mono text-[10px] tabular-nums">
                  {topRequests.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="browse" className="space-y-4">
            <StockBrowser
              stocks={allStocks}
              initialWatchlistIds={watchlistIds}
              watchlistMax={WATCHLIST_MAX}
            />
          </TabsContent>

          <TabsContent value="request" className="space-y-4">
            <p className="text-muted-foreground text-xs leading-relaxed">
              Each weekend, the most-requested tickers replace inactive stocks (zero watchlists,
              zero recent bets). Universe size stays fixed at {allStocks.length}. We accept
              US-listed common stocks at or above $2B market cap.
            </p>
            <StockRequestPanel
              topRequests={topRequests}
              userVotes={Array.from(userVotes)}
              weeklyUsed={weeklyUsed}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
