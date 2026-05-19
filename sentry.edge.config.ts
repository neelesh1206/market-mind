import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Edge bundles are tiny + cold-start sensitive; keep tracing modest.
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.05 : 1.0,
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
    environment:
      process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
  });
}
