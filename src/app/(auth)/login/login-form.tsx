"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
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
    <div className="w-full max-w-sm">
      <div className="border-border/60 bg-card/40 space-y-8 rounded-2xl border p-8 shadow-2xl backdrop-blur">
        <header className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-lg shadow-emerald-900/40">
            <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-white" aria-hidden="true">
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

          <h1 className="text-3xl font-semibold tracking-tight">Welcome to MarketMind</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Multi-source signal intelligence for 50 curated stocks.
            <br />
            Sign in to start your daily prediction ritual.
          </p>
        </header>

        <div className="space-y-4">
          <GoogleSignInButton onClick={signInWithGoogle} loading={loading} />

          {error && (
            <p
              role="alert"
              className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-center text-xs"
            >
              {error}
            </p>
          )}
        </div>

        <div className="border-border/60 space-y-2 border-t pt-6 text-center">
          <p className="text-muted-foreground text-xs">
            🎁 Starter bonus: <span className="text-foreground font-medium">1,000 credits</span> on
            signup
          </p>
          <p className="text-muted-foreground/70 text-[10px] tracking-wider uppercase">
            Virtual currency · no real money
          </p>
        </div>
      </div>

      <p className="text-muted-foreground/60 mt-6 text-center text-[11px]">
        For educational purposes only. Not investment advice.
      </p>
    </div>
  );
}
