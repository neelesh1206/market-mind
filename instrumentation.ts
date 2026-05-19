/**
 * Next.js instrumentation hook — runs once at server startup.
 *
 * Conditionally imports the runtime-specific Sentry config so server + edge
 * code paths get the right SDK. Reading NEXT_RUNTIME at module init avoids
 * pulling the Node-only SDK into edge bundles (and vice versa).
 *
 * No-ops cleanly when `NEXT_PUBLIC_SENTRY_DSN` is unset — local dev doesn't
 * need Sentry, and prod-without-DSN just emits a one-time console warning
 * from `Sentry.init`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Required export for Next.js to forward request errors into Sentry.
// In current SDK versions this is named `captureRequestError`; older docs
// referenced `onRequestError` which has since been renamed.
export { captureRequestError as onRequestError } from "@sentry/nextjs";
