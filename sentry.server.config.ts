import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Tracing for server actions + RSC + route handlers. 10% in prod is
    // enough signal without a huge ingest bill; 100% locally if dev opts in.
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    // Tie events to the deploy. VERCEL_GIT_COMMIT_SHA is set automatically
    // on Vercel; falls back to "dev" locally.
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
    environment:
      process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    // Server-side breadcrumbs are noisy (every fetch, every console.log).
    // Keep errors + spans; drop the chatty stuff.
    integrations: (defaults) =>
      defaults.filter((i) => i.name !== "Console"),
  });
}
