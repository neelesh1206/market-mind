import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests focus on the pure-logic surfaces of `live-prices.ts`:
 *   - Polygon snapshot parsing (which fields win, what we fall back to)
 *   - Empty-input short-circuit
 *   - Graceful handling of fetch failures
 *
 * The cache/Redis path is intentionally not exercised here — that would
 * require either a live Upstash test instance (slow, network-dependent)
 * or a deep stub of @upstash/redis. We rely on the type-level contract:
 * if Redis isn't configured, `redis` is null and the code falls through
 * to direct Polygon fetches, which is exactly the path these tests cover.
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
  process.env.MASSIVE_API_KEY = "test-key";
});
afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("getLivePrices", () => {
  it("returns an empty map for empty input without hitting Polygon", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { getLivePrices } = await import("../live-prices");
    const result = await getLivePrices([]);
    expect(result.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("parses lastTrade.p + todaysChangePerc when both present", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ticker: {
            lastTrade: { p: 175.42 },
            todaysChangePerc: 1.23,
            prevDay: { c: 173.30 },
          },
        }),
        { status: 200 },
      ),
    );
    const { getLivePrices } = await import("../live-prices");
    const m = await getLivePrices(["AAPL"]);
    const aapl = m.get("AAPL");
    expect(aapl).toBeDefined();
    expect(aapl?.price).toBeCloseTo(175.42, 2);
    expect(aapl?.changePct).toBeCloseTo(1.23, 2);
    expect(aapl?.fromCache).toBe(false);
  });

  it("falls back to min.c when lastTrade is missing (extended-hours quiet)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ticker: { min: { c: 50.5 }, todaysChangePerc: -0.5 } }),
        { status: 200 },
      ),
    );
    const { getLivePrices } = await import("../live-prices");
    const m = await getLivePrices(["PG"]);
    expect(m.get("PG")?.price).toBe(50.5);
    expect(m.get("PG")?.changePct).toBe(-0.5);
  });

  it("derives changePct from price vs prevDay.c when todaysChangePerc is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ticker: { lastTrade: { p: 110 }, prevDay: { c: 100 } },
        }),
        { status: 200 },
      ),
    );
    const { getLivePrices } = await import("../live-prices");
    const m = await getLivePrices(["NVDA"]);
    // (110 - 100) / 100 * 100 = 10%
    expect(m.get("NVDA")?.changePct).toBeCloseTo(10, 3);
  });

  it("returns null price+changePct when Polygon returns no usable fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ticker: {} }), { status: 200 }),
    );
    const { getLivePrices } = await import("../live-prices");
    const m = await getLivePrices(["XXXX"]);
    const x = m.get("XXXX");
    // Entry exists (caller can render placeholder) but values are null —
    // critically, no NaN, no exception, no missing-key crash.
    expect(x).toBeDefined();
    expect(x?.price).toBeNull();
    expect(x?.changePct).toBeNull();
  });

  it("returns nulls when Polygon errors out (4xx/5xx)", async () => {
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

  it("returns nulls (no fetch attempted) when MASSIVE_API_KEY is unset", async () => {
    delete process.env.MASSIVE_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { getLivePrices } = await import("../live-prices");
    const m = await getLivePrices(["AAPL"]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(m.get("AAPL")?.price).toBeNull();
  });

  it("dedupes the input list — same ticker passed twice = one Polygon call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ticker: { lastTrade: { p: 100 } } }), {
        status: 200,
      }),
    );
    const { getLivePrices } = await import("../live-prices");
    await getLivePrices(["AAPL", "AAPL", "aapl"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("preserves the input ticker shape on the returned map (BRK.B vs BRK-B)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ticker: { lastTrade: { p: 412.5 } } }), {
        status: 200,
      }),
    );
    const { getLivePrices } = await import("../live-prices");
    const m = await getLivePrices(["BRK.B"]);
    // Caller passed dotted form (matches our DB) — result keyed by the
    // input shape so the caller can do `m.get(stock.ticker)`.
    expect(m.get("BRK.B")?.price).toBe(412.5);
    expect(m.get("BRK-B")).toBeUndefined();
  });

  it("rewrites dotted tickers to Polygon's dash form on the request URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ticker: { lastTrade: { p: 1 } } }), { status: 200 }),
    );
    const { getLivePrices } = await import("../live-prices");
    await getLivePrices(["BRK.B"]);
    const url = (fetchSpy.mock.calls[0]?.[0] ?? "").toString();
    expect(url).toContain("/BRK-B");
    expect(url).not.toContain("BRK.B");
  });
});

describe("getLivePrice", () => {
  it("delegates to getLivePrices and returns the single entry", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ticker: { lastTrade: { p: 42 } } }), {
        status: 200,
      }),
    );
    const { getLivePrice } = await import("../live-prices");
    const p = await getLivePrice("MSFT");
    expect(p?.price).toBe(42);
  });

  it("returns null when the ticker has no live data and no error path", async () => {
    delete process.env.MASSIVE_API_KEY;
    const { getLivePrice } = await import("../live-prices");
    const p = await getLivePrice("AAPL");
    // We deliberately return the LivePrice envelope with null values
    // rather than `null` — UI renders the row either way, just with "—".
    expect(p).not.toBeNull();
    expect(p?.price).toBeNull();
  });
});
