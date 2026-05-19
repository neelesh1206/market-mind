import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    // Session replays are powerful but bandwidth-heavy. Sample only on error
    // for now — 100% of sessions where something broke, 0% of clean sessions.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "dev",
    environment:
      process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    integrations: [
      Sentry.replayIntegration({
        // Mask sensitive UI by default — bet amounts, ticker positions etc.
        // can be PII-adjacent. Toggle off later if we want richer replays.
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    // Drop known-noise errors that aren't actionable:
    //   - ResizeObserver loop limit (Chrome): benign, recovers automatically
    //   - AbortError from intentional cancellation
    //   - Cross-origin script errors from browser extensions
    ignoreErrors: [
      /ResizeObserver loop/,
      /AbortError/,
      /Non-Error promise rejection captured/,
      /^Script error\.$/,
    ],
    denyUrls: [
      /extensions\//i,
      /^chrome:\/\//i,
      /^chrome-extension:\/\//i,
      /^moz-extension:\/\//i,
    ],
  });
}

// Hook for Next.js client-side navigation transitions. The named export must
// be present — Next's instrumentation expects it to track route changes for
// performance tracing.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
