import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  computeBetStats,
  fetchCreditLedger,
  fetchUserBetHistory,
} from "@/lib/bets";
import { fetchUserWatchlist } from "@/lib/watchlist";
import { etCalendarDate } from "@/lib/market-schedule";
import { ProfileMenu } from "@/components/profile-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { BetHistoryList } from "@/components/bet-history-list";
import { CreditLedgerList } from "@/components/credit-ledger-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata = {
  title: "Your bets",
};

/**
 * History of every bet the user has placed + the underlying credit ledger.
 *
 * Two tabs land in #68 (Tabs primitive + ProfileMenu link). This commit
 * scaffolds the page + data fetch so the lists in #66 / #67 have a home.
 */
export default async function BetsPage() {
  const supabase = await createClient();
  const { data: claims, error: authErr } = await supabase.auth.getClaims();
  if (authErr || !claims?.claims) {
    redirect("/login");
  }
  const userId = claims.claims.sub as string;
  const email = (claims.claims.email ?? userId) as string;

  const [history, ledger, watchlist, profileRes] = await Promise.all([
    fetchUserBetHistory(supabase, userId, { limit: 200 }),
    fetchCreditLedger(supabase, userId, 200),
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
  const stats = computeBetStats(history);
  const todayEt = etCalendarDate();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border/60 bg-background/60 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-3">
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

      <main id="main" className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10">
        <section className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Your bets</h1>
          <p className="text-muted-foreground text-sm">
            Every prediction you&apos;ve made, plus the credit movements behind them.
          </p>
        </section>

        {/* Stats strip — populated; visual polish lands with the list in #66 */}
        <section className="border-border/60 bg-card/30 grid grid-cols-2 gap-4 rounded-xl border p-4 sm:grid-cols-4">
          <Stat label="Total bets" value={stats.total.toLocaleString()} />
          <Stat label="Pending" value={stats.pending.toLocaleString()} />
          <Stat
            label="Accuracy"
            value={
              stats.accuracy === null
                ? "—"
                : `${Math.round(stats.accuracy * 100)}%`
            }
            sub={
              stats.accuracy === null
                ? "No resolved bets yet"
                : `${stats.wins} W · ${stats.losses} L${stats.voids ? ` · ${stats.voids} void` : ""}`
            }
          />
          <Stat
            label="Net credits"
            value={`${stats.netCredits >= 0 ? "+" : ""}${stats.netCredits.toLocaleString()}`}
            sub="Resolved bets only"
          />
        </section>

        <Tabs defaultValue="bets" className="space-y-4">
          <TabsList>
            <TabsTrigger value="bets">
              Bets
              <span className="text-muted-foreground ml-1.5 text-[11px] tabular-nums">
                {history.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="credits">
              Credits
              <span className="text-muted-foreground ml-1.5 text-[11px] tabular-nums">
                {ledger.length}
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="bets" className="space-y-3">
            <BetHistoryList rows={history} todayEt={todayEt} />
          </TabsContent>

          <TabsContent value="credits" className="space-y-3">
            <p className="text-muted-foreground text-xs">
              Every credit movement on your account, append-only. Read down to reconcile any
              balance change back to its source.
            </p>
            <CreditLedgerList rows={ledger} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
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
