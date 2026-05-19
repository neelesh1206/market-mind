import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchAllStocks, fetchUserWatchlist } from "@/lib/watchlist";
import { ThemeToggle } from "@/components/theme-toggle";
import { StockPicker } from "./picker";

export const metadata = {
  title: "Manage your stocks",
};

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    redirect("/login");
  }

  // Same page serves both first-time setup AND ongoing edits.
  // We pre-fill the picker with the user's existing selections so they can
  // add/remove without starting from scratch.
  const [stocks, existing] = await Promise.all([
    fetchAllStocks(supabase),
    fetchUserWatchlist(supabase, user.id),
  ]);

  const isFirstTime = existing.length === 0;
  const initialSelected = existing.map((s) => s.id);

  return (
    <div className="bg-background min-h-screen">
      <header className="border-border/60 border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
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
          </Link>
          <div className="flex items-center gap-3">
            {!isFirstTime && (
              <Link
                href="/"
                className="text-muted-foreground hover:text-foreground text-xs transition-colors"
              >
                Cancel
              </Link>
            )}
            <span className="text-muted-foreground hidden text-xs sm:inline">
              {isFirstTime ? "Step 1 of 1 · Setup" : "Edit watchlist"}
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
        <section className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {isFirstTime ? "Pick the stocks you want to follow" : "Manage your stocks"}
          </h1>
          <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
            {isFirstTime ? (
              <>
                Choose between <span className="text-foreground font-medium">3 and 15</span> stocks
                from the 50-stock pool. You&apos;ll see daily signals, news, and prediction cards
                for these stocks in your home feed. You can change picks anytime.
              </>
            ) : (
              <>
                Add or remove stocks from your watchlist. Keep{" "}
                <span className="text-foreground font-medium">3 to 15</span> picks. Changes save
                when you click Save below.
              </>
            )}
          </p>
        </section>

        <StockPicker stocks={stocks} initialSelected={initialSelected} isFirstTime={isFirstTime} />
      </main>
    </div>
  );
}
