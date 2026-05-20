import { describe, expect, it, vi } from "vitest";
import {
  fetchPredictionFeedbackSummary,
  fetchUserPredictionFeedback,
} from "../feedback";

/**
 * Tests focus on:
 *  - the small shape-mapping each helper does (RPC array → object, etc.)
 *  - the graceful-degradation paths (RPC missing, query error)
 *  - the early returns (anon user → no vote query at all)
 *
 * The Supabase client is mocked just enough to exercise the surface we
 * actually use; we don't try to reproduce its full chained-builder API.
 */

function makeSupabaseStub(opts: {
  rpc?: { data?: unknown; error?: { message: string; code?: string } | null };
  maybeSingle?: { data?: unknown; error?: { message: string } | null };
}) {
  return {
    rpc: vi.fn().mockResolvedValue({
      data: opts.rpc?.data ?? null,
      error: opts.rpc?.error ?? null,
    }),
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: opts.maybeSingle?.data ?? null,
        error: opts.maybeSingle?.error ?? null,
      }),
    }),
  };
}

describe("fetchPredictionFeedbackSummary", () => {
  it("maps the RPC's array-wrapped row to a flat object", async () => {
    const client = makeSupabaseStub({
      rpc: { data: [{ helpful_count: 9, total_count: 13 }] },
    });
    const out = await fetchPredictionFeedbackSummary(
      client as never,
      "11111111-1111-1111-1111-111111111111",
    );
    expect(out).toEqual({ helpfulCount: 9, totalCount: 13 });
  });

  it("also accepts a non-array RPC response (defensive)", async () => {
    const client = makeSupabaseStub({
      rpc: { data: { helpful_count: 2, total_count: 5 } },
    });
    const out = await fetchPredictionFeedbackSummary(client as never, "id");
    expect(out).toEqual({ helpfulCount: 2, totalCount: 5 });
  });

  it("returns zeros (not nulls) when there's no feedback yet", async () => {
    const client = makeSupabaseStub({
      rpc: { data: [{ helpful_count: 0, total_count: 0 }] },
    });
    const out = await fetchPredictionFeedbackSummary(client as never, "id");
    expect(out).toEqual({ helpfulCount: 0, totalCount: 0 });
  });

  it("falls back to zeros when the RPC errors (e.g. migration pending)", async () => {
    const client = makeSupabaseStub({
      rpc: { error: { message: "function not found" } },
    });
    const out = await fetchPredictionFeedbackSummary(client as never, "id");
    expect(out).toEqual({ helpfulCount: 0, totalCount: 0 });
  });
});

describe("fetchUserPredictionFeedback", () => {
  it("returns null immediately when userId is null (anon)", async () => {
    const client = makeSupabaseStub({});
    const out = await fetchUserPredictionFeedback(client as never, null, "id");
    expect(out).toBeNull();
    // Should NOT have queried the table at all
    expect(client.from).not.toHaveBeenCalled();
  });

  it("returns the user's vote when present", async () => {
    const client = makeSupabaseStub({
      maybeSingle: { data: { helpful: true } },
    });
    const out = await fetchUserPredictionFeedback(client as never, "user-1", "pred-1");
    expect(out).toEqual({ helpful: true });
  });

  it("returns null when the user has no vote yet", async () => {
    const client = makeSupabaseStub({ maybeSingle: { data: null } });
    const out = await fetchUserPredictionFeedback(client as never, "user-1", "pred-1");
    expect(out).toBeNull();
  });

  it("returns null on query error (logs, doesn't throw)", async () => {
    const client = makeSupabaseStub({
      maybeSingle: { error: { message: "permission denied" } },
    });
    const out = await fetchUserPredictionFeedback(client as never, "user-1", "pred-1");
    expect(out).toBeNull();
  });
});
