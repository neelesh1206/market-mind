import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

// Sentry wrapper — uploads source maps for unminified stack traces, hides
// them from the public bundle, tags each deploy with the git SHA.
// No-ops when SENTRY_AUTH_TOKEN is unset (which is fine for local builds).
export default withSentryConfig(nextConfig, {
  // Suppress all output from the Sentry CLI while building, except in CI
  // where we want the upload diagnostics in the build log.
  silent: !process.env.CI,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Source maps: upload to Sentry for unminified stack traces, but strip
  // the .map.js references from the public bundle so the maps themselves
  // aren't served from the CDN.
  widenClientFileUpload: true,
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },

  // Reduces SDK logger noise in production builds.
  disableLogger: true,

  // Don't break the build if Sentry CLI fails (missing token, network, etc.)
  // — surface the warning, ship the build.
  errorHandler: (err) => {
    console.warn(`[sentry-build] non-fatal: ${err.message}`);
  },
});
