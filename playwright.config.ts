import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — smoke tests against unauthenticated public surfaces.
 *
 * `baseURL` defaults to the prod deploy. CI overrides to the per-PR Vercel
 * preview URL via the PLAYWRIGHT_BASE_URL env var. Local devs can override
 * to http://localhost:3000 by exporting the same.
 *
 * Why no `webServer` block: we deliberately test against deployed builds
 * (preview or prod), not a local `next dev` server. This catches a class
 * of regressions that only manifest in the production bundle — env-var
 * inlining, OG image generation, edge-runtime quirks — without re-paying
 * the build cost in CI.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "https://marketmind.neeleshkakaraparthi.dev",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Mobile is the most-likely-broken surface; smoke a Pixel viewport too.
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],
});
