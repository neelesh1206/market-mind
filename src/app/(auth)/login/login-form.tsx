"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
// `Github` was removed from lucide's brand-icon set in v0.500+; `Code`
// reads cleanly for "Source on GitHub" since the value is the code, not
// the platform logo.
import { Code, Lock } from "lucide-react";
import { toast } from "sonner";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const params = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("error") === "oauth" ? "Sign-in failed. Try again." : null,
  );

  // Surface OAuth-redirect errors via toast too, not just the inline banner.
  // Users coming back from Google may not immediately notice the banner;
  // a toast catches the eye and stays for the default ~5s.
  useEffect(() => {
    if (params.get("error") === "oauth") {
      toast.error("Sign-in failed. Try again.");
    }
  }, [params]);

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
      toast.error(oauthError.message);
      setLoading(false);
    }
    // On success, Supabase redirects away — the browser never returns here.
  }

  return (
    <div id="signin" className="w-full max-w-sm scroll-mt-12">
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

          {/* Trust signals directly below the sign-in button. Single-line
              reassurance + a "Why it's safe" link to the privacy page.
              The privacy link is also load-bearing for Google's OAuth
              consent-screen verifier — they crawl this page looking for
              a visible link to the policy URL we registered. */}
          <div className="text-muted-foreground space-y-1.5 text-center text-[11px] leading-relaxed">
            <p className="flex items-center justify-center gap-1.5">
              <Lock className="h-3 w-3" aria-hidden />
              <span>
                We only read your name + email — never Gmail, Drive, or anything else
              </span>
            </p>
            <Link
              href="/privacy"
              className="text-foreground/80 hover:text-foreground inline-block underline-offset-2 hover:underline"
            >
              Why it&apos;s safe →
            </Link>
          </div>

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

      {/* Footer row below the card: GitHub + methodology + privacy links.
          Open-source visibility is the single strongest trust signal — a
          friend can audit every line of code before committing to sign in.
          Privacy link is duplicated here AND under the button so Google's
          crawler picks it up regardless of where it lands on the page. */}
      <div className="text-muted-foreground/70 mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center text-[11px]">
        <a
          href="https://github.com/neelesh1206/market-mind"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
        >
          <Code className="h-3 w-3" aria-hidden />
          Source on GitHub
        </a>
        <span className="opacity-50">·</span>
        <Link href="/about" className="hover:text-foreground underline-offset-2 hover:underline">
          How it works
        </Link>
        <span className="opacity-50">·</span>
        <Link href="/privacy" className="hover:text-foreground underline-offset-2 hover:underline">
          Privacy
        </Link>
      </div>

      <p className="text-muted-foreground/60 mt-4 text-center text-[11px]">
        For educational purposes only. Not investment advice.
      </p>
    </div>
  );
}
