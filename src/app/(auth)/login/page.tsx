import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchTopVerdictsForPreview } from "@/lib/feed";
import { getLivePrices } from "@/lib/live-prices";
import { StockCard } from "@/components/stock-card";
import { LoginForm } from "./login-form";

// Top-verdict picks change once a day (when the pipeline runs). Cache the
// page for 5 min — fresh enough for new visitors, easy on the DB during
// traffic spikes. Conveniently this also matches the Upstash live-price
// TTL, so first-time visitors see prices that align with our cache.
export const revalidate = 300;

export default async function LoginPage() {
  const supabase = await createClient();
  const preview = await fetchTopVerdictsForPreview(supabase, 2);
  // Live prices for the preview cards. First-time visitors landing here
  // see real-time quotes alongside the verdict — sets the expectation
  // that MarketMind is a live product, not a static daily report.
  // Fails-soft to `prev_close` per the StockCard fallback chain.
  const livePrices = await getLivePrices(preview.map((p) => p.stock.ticker));

  return (
    <div className="flex w-full max-w-5xl flex-col items-center gap-12">
      <Suspense fallback={<div className="text-muted-foreground text-sm">Loading…</div>}>
        <LoginForm />
      </Suspense>

      {preview.length > 0 && (
        <section className="w-full space-y-4">
          <header className="space-y-1 text-center">
            <p className="text-xs font-medium tracking-wider text-emerald-500 uppercase">
              See it in action
            </p>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Today&apos;s highest-conviction calls
            </h2>
            <p className="text-muted-foreground text-sm">
              Live picks from the pipeline — sign in to bet, manage your watchlist, and see the
              full breakdown.
            </p>
          </header>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {preview.map((card) => (
              <StockCard
                key={card.stock.id}
                data={card}
                livePrice={livePrices.get(card.stock.ticker) ?? null}
                preview
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
