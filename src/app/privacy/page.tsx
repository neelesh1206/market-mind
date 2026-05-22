import Link from "next/link";
import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How MarketMind handles your data. What Google shares, what we store, who has access, and how to revoke or delete.",
};

/**
 * Privacy policy — Google's OAuth consent-screen verifier requires this
 * URL to be (a) reachable from the home page and (b) actually contain
 * privacy-policy content (it greps the page text). Both conditions need
 * to hold for the consent screen to show "Sign in to MarketMind" instead
 * of the raw supabase.co hostname.
 *
 * Kept deliberately specific: no marketing copy, no "industry-standard
 * security" platitudes. Friends will scan-read this — the trust win comes
 * from the page being short, literal, and easy to verify against the
 * source code.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
      <header className="space-y-3">
        <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          MarketMind
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Privacy</h1>
        <p className="text-muted-foreground text-sm">
          Last updated: 2026-05-22 (purpose + retention sections) · Effective immediately.
        </p>
      </header>

      <main className="mt-10 space-y-10 text-sm leading-relaxed">
        {/* ─────────────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">What MarketMind is</h2>
          <p className="text-muted-foreground">
            MarketMind is a portfolio-side project that lets users place virtual-credit predictions
            on a fixed universe of 50 US stocks. There is no real money involved, no advertising,
            no commerce, and no third-party tracking beyond what is documented on this page.
            Source code is public at{" "}
            <a
              href="https://github.com/neelesh1206/market-mind"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
            >
              github.com/neelesh1206/market-mind
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
            . You can audit every line of code that touches your data.
          </p>
        </section>

        {/* ─────────────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">What Google shares with MarketMind when you sign in</h2>
          <p className="text-muted-foreground">When you click &ldquo;Sign in with Google,&rdquo; Google shares:</p>
          <ul className="text-muted-foreground ml-6 list-disc space-y-1.5">
            <li>Your email address</li>
            <li>Your display name</li>
            <li>
              Your profile picture URL — displayed as your avatar in the app header dropdown and on
              your profile page. The image itself stays on Google&apos;s CDN; we don&apos;t copy it,
              proxy it, or store it. If the URL expires or you revoke OAuth access, the avatar falls
              back to a single-letter chip.
            </li>
            <li>An anonymous Google user ID we use to recognize you on return visits</li>
          </ul>
          <p className="text-muted-foreground">That is the entire list. We do not request, and Google does not share:</p>
          <ul className="text-muted-foreground ml-6 list-disc space-y-1.5">
            <li>Anything from Gmail, Drive, Calendar, Contacts, Photos, or any other Google service</li>
            <li>Permission to post, send, or modify anything on your behalf</li>
            <li>Your phone number, physical address, date of birth, or any sensitive personal data</li>
          </ul>
          <p className="text-muted-foreground">
            The OAuth scopes we request are <code className="rounded bg-muted px-1.5 py-0.5 text-[12px]">openid</code>,{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-[12px]">email</code>, and{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-[12px]">profile</code> — non-sensitive scopes for
            sign-in only.
          </p>
        </section>

        {/* ─────────────────────────────────────────────────────────────── */}
        {/* Explicit "Purpose of use" section — redundant with the rest of  */}
        {/* the page, but Google's OAuth verifier greps for this vocabulary */}
        {/* literally. Added 2026-05-22 in response to a verification       */}
        {/* clarification request (see ADR / commit history).               */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Purpose of use</h2>
          <p className="text-muted-foreground">
            The Google user data listed above is used <span className="text-foreground">solely to identify
            your MarketMind account</span> across visits and to personalize the in-app header (your
            display name and avatar). Specifically:
          </p>
          <ul className="text-muted-foreground ml-6 list-disc space-y-1.5">
            <li>
              <span className="text-foreground">Email</span> — used as your unique account identifier and to
              contact you if you request a data deletion. Not used for marketing, newsletters, or any other
              outbound communication.
            </li>
            <li>
              <span className="text-foreground">Display name</span> — shown in the header greeting (&ldquo;Welcome
              back, &lt;name&gt;&rdquo;) and on the public leaderboard if you opt in.
            </li>
            <li>
              <span className="text-foreground">Profile picture URL</span> — rendered as your avatar in the
              header dropdown and on your profile page. Read on each render, never stored.
            </li>
            <li>
              <span className="text-foreground">Google user ID</span> — internal foreign key tying your sign-in
              token to your account row. Never displayed to other users.
            </li>
          </ul>
          <p className="text-muted-foreground">
            Google user data is <span className="text-foreground">not</span> used for advertising, sold to third
            parties, shared with data brokers, or used to train AI/ML models.
          </p>
        </section>

        {/* ─────────────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">What MarketMind stores about you</h2>
          <ul className="text-muted-foreground ml-6 list-disc space-y-1.5">
            <li>The email, display name, and Google user ID from the previous section</li>
            <li>The 50-stock watchlist you build during onboarding</li>
            <li>Each daily prediction you place (stock, direction, stake) and its resolved outcome</li>
            <li>Your virtual-credit balance and the ledger of credit transactions</li>
            <li>Daily-login streak counters and any badges you have earned</li>
            <li>Thumbs-up/thumbs-down feedback you leave on MarketMind&apos;s own daily verdicts</li>
          </ul>
          <p className="text-muted-foreground">
            All of this data lives in <span className="text-foreground">Supabase Postgres (US-East region)</span>,
            with row-level security policies enforced at the database — meaning only your own account session can
            read your bets, balance, and feedback. Even a bug in our server code cannot return another user&apos;s
            data; the database itself refuses.
          </p>
          <p className="text-muted-foreground">
            <span className="text-foreground">What we deliberately don&apos;t store:</span> your
            Google profile picture URL. It travels with your sign-in token and is read on every page
            render to display the avatar — never copied into our database. When you sign out (or
            revoke OAuth access via your Google account), it&apos;s gone from our side immediately
            with no cleanup required.
          </p>
        </section>

        {/* ─────────────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Vendors that touch your data</h2>
          <p className="text-muted-foreground">
            We use a small number of standard infrastructure vendors. Each one&apos;s role is listed below.
          </p>
          <ul className="text-muted-foreground ml-6 list-disc space-y-1.5">
            <li>
              <span className="text-foreground">Supabase</span> — primary database, authentication, and
              row-level-security enforcement. Stores everything in the previous section.
            </li>
            <li>
              <span className="text-foreground">Vercel</span> — web hosting. Serves the pages and the OG share
              images. Sees standard HTTP request logs (URL, user agent, IP). Does not see the contents of
              database queries.
            </li>
            <li>
              <span className="text-foreground">Cloudflare</span> — DNS for the custom domain and scheduled
              triggers for the nightly pipeline. Does not see your account data.
            </li>
            <li>
              <span className="text-foreground">Upstash</span> — short-lived cache (rate-limit counters and a
              5-minute live-price cache). Sees keys like
              <code className="rounded bg-muted px-1.5 py-0.5 text-[12px]">mm:rl:placeBet:&lt;your-uuid&gt;</code>{" "}
              but not the content of your predictions.
            </li>
            <li>
              <span className="text-foreground">Vercel Analytics</span> — anonymous pageview + Core Web Vitals
              tracking. First-party, no cookies, no cross-site tracking. We see counts and routes, never
              individuals.
            </li>
          </ul>
          <p className="text-muted-foreground">
            We do <span className="text-foreground">not</span> use Google Analytics, Facebook Pixel,
            advertising trackers, third-party session replay, or any data broker.
          </p>
        </section>

        {/* ─────────────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Data we do not collect</h2>
          <ul className="text-muted-foreground ml-6 list-disc space-y-1.5">
            <li>Real financial information — there is no money flow in this app</li>
            <li>Payment details, bank info, or any commercial data</li>
            <li>Location data beyond the IP-derived approximation in standard HTTP logs</li>
            <li>Biometric, health, or sensitive personal data</li>
            <li>Browsing history outside MarketMind</li>
          </ul>
        </section>

        {/* ─────────────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">How to revoke access</h2>
          <p className="text-muted-foreground">
            You can disconnect MarketMind from your Google account at any time:
          </p>
          <ol className="text-muted-foreground ml-6 list-decimal space-y-1.5">
            <li>
              Open{" "}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
              >
                myaccount.google.com/permissions
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </li>
            <li>Find &ldquo;MarketMind&rdquo; in the list of connected apps</li>
            <li>Click &ldquo;Remove access&rdquo;</li>
          </ol>
          <p className="text-muted-foreground">
            That stops the OAuth connection effective immediately. Google will no longer share new sign-in tokens
            with us.
          </p>
        </section>

        {/* ─────────────────────────────────────────────────────────────── */}
        {/* Explicit "Retention" section — same reason as "Purpose of use"  */}
        {/* above. Verifier wants the literal word "retention" on the page. */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Data retention</h2>
          <p className="text-muted-foreground">
            We retain your Google sign-in identity (email, display name, Google user ID) and your
            MarketMind game state (watchlist, predictions, credit balance, badges, feedback) for as
            long as your account exists. We do not have a fixed expiry — the data is what makes the
            app work for you on return visits.
          </p>
          <p className="text-muted-foreground">
            When you request deletion (see next section), every row tied to your account is removed
            from Supabase within 24 hours. Vercel and Cloudflare HTTP request logs roll off on their
            standard vendor schedules (~30 days). Upstash cache entries auto-expire within minutes.
          </p>
          <p className="text-muted-foreground">
            Your Google profile picture URL is never stored, so no retention applies — it disappears
            from our side the moment you sign out or revoke OAuth access.
          </p>
        </section>

        {/* ─────────────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">How to delete your stored data</h2>
          <p className="text-muted-foreground">
            Revoking OAuth access stops new data from flowing in, but does not delete what we already have.
            To permanently wipe your account, predictions, watchlist, and credit history, email{" "}
            <a
              href="mailto:neelesh1206@gmail.com?subject=MarketMind%20data%20deletion%20request"
              className="text-foreground underline-offset-2 hover:underline"
            >
              neelesh1206@gmail.com
            </a>{" "}
            with the email address tied to your MarketMind account. We will confirm deletion within 24 hours.
          </p>
        </section>

        {/* ─────────────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Changes to this policy</h2>
          <p className="text-muted-foreground">
            If we materially change how data is collected or shared, the {""}
            <span className="text-foreground">Last updated</span> date at the top of this page changes, and the
            same commit appears in the public git history at{" "}
            <a
              href="https://github.com/neelesh1206/market-mind/commits/main/src/app/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
            >
              github.com/neelesh1206/market-mind
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
            . You can subscribe to the repo to be notified.
          </p>
        </section>

        {/* ─────────────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Contact</h2>
          <p className="text-muted-foreground">
            Anything unclear, or want to verify a specific claim against the source?{" "}
            <a
              href="mailto:neelesh1206@gmail.com?subject=MarketMind%20privacy%20question"
              className="text-foreground underline-offset-2 hover:underline"
            >
              neelesh1206@gmail.com
            </a>
            .
          </p>
        </section>
      </main>

      <footer className="border-border/60 mt-12 flex items-center justify-between border-t pt-6 text-xs">
        <Link
          href="/login"
          className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          ← Back to sign-in
        </Link>
        <div className="text-muted-foreground flex items-center gap-4">
          <Link href="/about" className="hover:text-foreground underline-offset-2 hover:underline">
            How it works
          </Link>
          <a
            href="https://github.com/neelesh1206/market-mind"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground underline-offset-2 hover:underline"
          >
            Source
          </a>
        </div>
      </footer>
    </div>
  );
}
