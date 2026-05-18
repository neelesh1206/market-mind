"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const params = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("error") === "oauth" ? "Sign-in failed. Try again." : null,
  );

  async function signInWithGoogle() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const next = params.get("next") ?? "/";
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (oauthError) {
      setError(oauthError.message);
      setLoading(false);
    }
    // On success, Supabase redirects away — the browser never returns here.
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">MarketMind</h1>
        <p className="text-muted-foreground text-sm">
          Multi-source stock intelligence. Sign in to start predicting.
        </p>
      </header>

      <Button onClick={signInWithGoogle} disabled={loading} className="w-full" size="lg">
        {loading ? "Signing in…" : "Continue with Google"}
      </Button>

      {error && (
        <p className="text-destructive text-center text-sm" role="alert">
          {error}
        </p>
      )}

      <p className="text-muted-foreground text-center text-xs">
        By signing in you get 1,000 starter credits.
      </p>
    </div>
  );
}
