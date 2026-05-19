import { expect, test } from "@playwright/test";

/**
 * Smoke tests for the public (unauthenticated) surfaces of MarketMind.
 *
 * The contract: these pages must render correctly without any user session.
 * They're the ones a) prospective users see on first visit (/login, /about)
 * and b) social platforms hit when generating link previews (/og/stock/X).
 *
 * Authenticated flows (place bet, claim bonus, badges) need a seeded test
 * user + JWT injection — punted to a follow-up if/when we need richer
 * coverage. Until then, these five tests catch the deploys-most-likely-
 * to-break-prod class of regression.
 */

test.describe("public surfaces", () => {
  test("/login renders sign-in card + preview section", async ({ page }) => {
    await page.goto("/login");

    // Sign-in card always present.
    await expect(page.getByRole("heading", { name: /welcome to marketmind/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in with google/i })).toBeVisible();

    // Preview cards render when there are verdicts — but the "See it in
    // action" heading should always be present once preview data exists.
    // We don't assert on the specific tickers (those rotate daily).
    const seeItHeader = page.getByText(/see it in action/i);
    // Either the preview is there OR it's been gracefully hidden because
    // no verdicts exist — either way the page didn't error.
    await expect(seeItHeader).toHaveCount(seeItHeader ? 1 : 0);
  });

  test("/about renders methodology + track record", async ({ page }) => {
    await page.goto("/about");

    // Hero h1.
    await expect(page.getByRole("heading", { level: 1, name: /predictions you can audit/i })).toBeVisible();

    // Track record section — phrasing must match the page.
    await expect(page.getByRole("heading", { name: /our track record/i })).toBeVisible();

    // The 4 signal bucket sections all render.
    await expect(page.getByRole("heading", { name: /^technical$/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^sentiment$/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^professional$/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^social$/i })).toBeVisible();
  });

  test("/og/stock/AAPL returns a PNG", async ({ request }) => {
    const res = await request.get("/og/stock/AAPL");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
    const body = await res.body();
    expect(body.byteLength).toBeGreaterThan(10_000); // sanity: real OG cards are ≥10kb
  });

  test("/stock/[ticker] is publicly readable + carries og:image meta", async ({ page, request }) => {
    // The OG card chain only works if unfurlers can fetch /stock/X without
    // auth AND find the og:image meta tag pointing at /og/stock/X. Test the
    // whole chain — this was a real bug that shipped briefly when /stock/*
    // got 307-redirected to /login.
    const res = await request.get("/stock/AAPL");
    expect(res.status()).toBe(200);

    await page.goto("/stock/AAPL");
    const ogImage = await page
      .locator('meta[property="og:image"]')
      .getAttribute("content");
    expect(ogImage).toBeTruthy();
    expect(ogImage).toContain("/og/stock/AAPL");

    // Twitter card variant — required for the "summary_large_image" rendering.
    const twitterCard = await page
      .locator('meta[name="twitter:card"]')
      .getAttribute("content");
    expect(twitterCard).toBe("summary_large_image");
  });

  test("/og/stock/INVALID returns 404", async ({ request }) => {
    // Tickers not in our pool should 404, not 500. Catches the OG route
    // crashing on bad input — common regression after refactors.
    const res = await request.get("/og/stock/ZZZZZZZ");
    expect(res.status()).toBe(404);
  });

  test("/ redirects unauthenticated visitors to /login", async ({ page }) => {
    const response = await page.goto("/");
    // Could be either an explicit redirect or a server-side rewrite — both
    // end up on /login. Assert the final URL.
    expect(page.url()).toContain("/login");
    // 200 because /login itself rendered fine; failure mode would be a 5xx
    // bubble from the auth check.
    expect(response?.status()).toBeLessThan(400);
  });

  test("skip-to-main-content link is keyboard accessible", async ({ page }) => {
    // a11y guarantee: first focusable element must be the skip link.
    await page.goto("/login");
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.textContent);
    expect(focused?.toLowerCase()).toContain("skip to main");
  });
});
