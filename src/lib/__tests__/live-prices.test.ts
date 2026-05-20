import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests focus on the pure-logic surfaces of `live-prices.ts`:
 *   - Finnhub quote parsing (which fields win, how zeros are handled)
 *   - Empty-input short-circuit
 *   - Graceful handling of fetch failures
 *
 * The cache/Redis path is intentionally not exercised here — that would
 * require either a live Upstash test instance (slow, network-dependent)
 * or a deep stub of @upstash/redis. We rely on the type-level contract:
 * if Redis isn't configured, `redis` is null and the code falls through
 * to direct Finnhub fetches, which is exactly the path these tests cover.
 */

// IMPORTANT: stub Upstash before importing the module under test, since
// the module reads UPSTASH_REDIS_REST_URL at import time. Leaving it
// unset forces the "no cache" code path.
vi.mock("@upstash/redis", () => ({
  Redis: class {
    /* placeholder — never instantiated in these tests */
  },
}));

// Ensure env vars are pristine for each test so module import behavior
// is deterministic.
const originalEnv = { ...process.env };
beforeEach(() => {
  vi.resetModules();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.FINNHUB_API_KEY = "test-key";
});
afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("getLivePrices", () => {
  it("returns an empty map for empty input without hitting Finnhub", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { getLivePrices } = await import("../live-prices");
    const result = await getLivePrices([]);
    expect(result.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("parses c (current price) + dp (change %) from Finnhub /quote", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          c: 263.32,
          d: 3.98,
          dp: 1.5343,
          h: 264.84,
          l: 260.05,
          o: 260.05,
          pc: 259.34,
          t: 1779292260,
        }),
        { status: 200 },
      ),
    );
    const { getLivePrices } = await import("../live-prices");
    const m = await getLivePrices(["AMZN"]);
    const amzn = m.get("AMZN");
    expect(amzn).toBeDefined();
    expect(amzn?.price).toBeCloseTo(263.32, 2);
    expect(amzn?.changePct).toBeCloseTo(1.5343, 3);
    expect(amzn?.fromCache).toBe(false);
  });

  it("derives changePct from c vs pc when dp is absent or null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ c: 110, pc: 100 }), { status: 200 }),
    );
    const { getLivePrices } = await import("../live-prices");
    const m = await getLivePrices(["NVDA"]);
    // (110 - 100) / 100 * 100 = 10%
    expect(m.get("NVDA")?.changePct).toBeCloseTo(10, 3);
  });

  it("treats c=0 as missing data (Finnhub's signal for unknown ticker)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ c: 0, d: 0, dp: 0, h: 0, l: 0, o: 0, pc: 0, t: 0 }),
        { status: 200 },
      ),
    );
    const { getLivePrices } = await import("../live-prices");
    const m = await getLivePrices(["XXXX"]);
    const x = m.get("XXXX");
    // Entry exists (caller can render placeholder) but price is null —
    // critically, no "$0.00" rendered, no NaN, no missing-key crash.
    expect(x).toBeDefined();
    expect(x?.price).toBeNull();
  });

  it("returns nulls when Finnhub errors out (4xx/5xx)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("rate limited", { status: 429, statusText: "Too Many Requests" }),
    );
    const { getLivePrices } = await import("../live-prices");
    const m = await getLivePrices(["AAPL"]);
    expect(m.get("AAPL")?.price).toBeNull();
  });

  it("returns nulls when fetch itself throws (network error / abort)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNRESET"));
    const { getLivePrices } = await import("../live-prices");
    const m = await getLivePrices(["AAPL"]);
    expect(m.get("AAPL")?.price).toBeNull();
    expect(m.get("AAPL")?.changePct).toBeNull();
  });

  it("returns nulls (no fetch attempted) when FINNHUB_API_KEY is unset", async () => {
    delete process.env.FINNHUB_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { getLivePrices } = await import("../live-prices");
    const m = await getLivePrices(["AAPL"]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(m.get("AAPL")?.price).toBeNull();
  });

  it("dedupes the input list — same ticker passed twice = one Finnhub call", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ c: 100, pc: 99 }), { status: 200 }));
    const { getLivePrices } = await import("../live-prices");
    await getLivePrices(["AAPL", "AAPL", "aapl"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("preserves the input ticker shape on the returned map (BRK.B vs BRK-B)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ c: 412.5, pc: 410 }), { status: 200 }),
    );
    const { getLivePrices } = await import("../live-prices");
    const m = await getLivePrices(["BRK.B"]);
    // Caller passed dotted form (matches our DB) — result keyed by the
    // input shape so the caller can do `m.get(stock.ticker)`.
    expect(m.get("BRK.B")?.price).toBe(412.5);
    expect(m.get("BRK-B")).toBeUndefined();
  });

  it("rewrites dotted tickers to dash form on the outbound URL", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ c: 1, pc: 1 }), { status: 200 }));
    const { getLivePrices } = await import("../live-prices");
    await getLivePrices(["BRK.B"]);
    const url = (fetchSpy.mock.calls[0]?.[0] ?? "").toString();
    // URL-encoded `BRK-B` may appear as either `BRK-B` (hyphen is not
    // reserved) or `BRK%2DB`. Accept either; what matters is no dot.
    expect(url).toMatch(/BRK[-]B|BRK%2DB/);
    expect(url).not.toContain("BRK.B");
  });

  it("does not leak the api key into thrown errors or logs", async () => {
    // Defensive: if Finnhub ever returns an error containing the URL,
    // we should not echo the key. Verify our error surface is the
    // status code only.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("nope", { status: 401, statusText: "Unauthorized" }),
    );
    const { getLivePrices } = await import("../live-prices");
    await getLivePrices(["AAPL"]);
    const logged = warnSpy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("test-key");
    expect(logged).not.toContain("token=");
  });
});

describe("getLivePrice", () => {
  it("delegates to getLivePrices and returns the single entry", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ c: 42, pc: 40 }), { status: 200 }),
    );
    const { getLivePrice } = await import("../live-prices");
    const p = await getLivePrice("MSFT");
    expect(p?.price).toBe(42);
  });

  it("returns the envelope with null price when no quote available", async () => {
    delete process.env.FINNHUB_API_KEY;
    const { getLivePrice } = await import("../live-prices");
    const p = await getLivePrice("AAPL");
    // We deliberately return the LivePrice envelope with null values
    // rather than `null` — UI renders the row either way, just with "—".
    expect(p).not.toBeNull();
    expect(p?.price).toBeNull();
  });
});
