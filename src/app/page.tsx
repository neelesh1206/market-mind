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

  return (
    <main className="bg-background flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <section className="w-full max-w-md space-y-6 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">MarketMind</h1>
        <p className="text-muted-foreground text-sm">Signed in as {name}</p>

        <div className="grid grid-cols-2 gap-4">
          <div className="border-border bg-card rounded-lg border p-4">
            <p className="text-muted-foreground text-xs tracking-wide uppercase">Credits</p>
            <p className="text-3xl font-semibold tabular-nums">{credits.toLocaleString()}</p>
          </div>
          <div className="border-border bg-card rounded-lg border p-4">
            <p className="text-muted-foreground text-xs tracking-wide uppercase">Streak</p>
            <p className="text-3xl font-semibold tabular-nums">{streak}</p>
          </div>
        </div>

        <p className="text-muted-foreground text-xs">
          Stock cards, insights, and predictions land here on Day 3.
        </p>

        <SignOutButton />
      </section>
    </main>
  );
}
