import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";

export default async function Home() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/login");
  }

  const email = (data.claims.email ?? data.claims.sub) as string;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("display_name, credit_balance, current_streak")
    .eq("id", data.claims.sub)
    .maybeSingle();

  const credits = profile?.credit_balance ?? 0;
  const streak = profile?.current_streak ?? 0;
  const name = profile?.display_name ?? email;
  const initial = (name?.[0] ?? "?").toUpperCase();

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

          <div className="flex items-center gap-3">
            <div className="border-border/60 bg-card/40 hidden items-center gap-2 rounded-full border px-3 py-1.5 sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="text-xs font-medium tabular-nums">
                {credits.toLocaleString()} credits
              </span>
            </div>
            <div
              className="bg-secondary text-secondary-foreground flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium"
              title={email}
            >
              {initial}
            </div>
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-12">
        <section className="space-y-2">
          <p className="text-muted-foreground text-sm">
            Welcome back, <span className="text-foreground font-medium">{name}</span>
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Your daily ritual starts here.
          </h1>
        </section>

        {/* Stat grid */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Credits" value={credits.toLocaleString()} hint="Virtual currency" />
          <Stat
            label="Current streak"
            value={streak.toString()}
            hint={streak > 0 ? "Keep it going" : "Predict tomorrow to start"}
          />
          <Stat label="Predictions today" value="0" hint="Window opens at 8 PM ET" />
        </section>

        {/* Coming-soon placeholder */}
        <section className="border-border/60 bg-card/30 flex flex-col items-start gap-3 rounded-xl border p-8">
          <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            Coming next
          </span>
          <h2 className="text-xl font-semibold">Stock cards, signals, and predictions</h2>
          <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
            Day 3 of the build will surface the 50-stock pool with full signal breakdowns,
            real-time-ish insights, and the bet sheet. Until then, the pipeline is being wired up
            behind the scenes.
          </p>
        </section>
      </main>

      <footer className="border-border/60 border-t">
        <div className="text-muted-foreground/70 mx-auto w-full max-w-5xl px-6 py-4 text-xs">
          For educational purposes only. Not investment advice.
        </div>
      </footer>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="border-border/60 bg-card/30 rounded-xl border p-5">
      <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
      <p className="text-muted-foreground/80 mt-1 text-xs">{hint}</p>
    </div>
  );
}
