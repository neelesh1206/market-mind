import type { SupabaseClient } from "@supabase/supabase-js";

/** Aggregate count for one verdict. Zeros when nobody has voted yet. */
export type FeedbackSummary = {
  helpfulCount: number;
  totalCount: number;
};

/**
 * Public aggregate count of feedback on a verdict. Goes through the
 * `get_feedback_summary` SECURITY DEFINER RPC so anon visitors can read
 * the aggregate even though the per-user vote rows are RLS-protected.
 *
 * Defensive: returns zeros on any error (e.g. function not yet migrated)
 * so the calling page never breaks.
 */
export async function fetchPredictionFeedbackSummary(
  client: SupabaseClient,
  predictionId: string,
): Promise<FeedbackSummary> {
  const { data, error } = await client.rpc("get_feedback_summary", {
    p_prediction_id: predictionId,
  });

  if (error) {
    console.warn(
      `[feedback] get_feedback_summary failed (likely migration not applied): ${error.message}`,
    );
    return { helpfulCount: 0, totalCount: 0 };
  }

  // The function returns a single-row table; .rpc returns it as an array
  // by default unless we use .single(). Pick the first.
  const row = Array.isArray(data) ? data[0] : data;
  return {
    helpfulCount: row?.helpful_count ?? 0,
    totalCount: row?.total_count ?? 0,
  };
}

/**
 * The current user's existing vote on a verdict, if any. Returns null
 * when there's no user (anon) or no row.
 *
 * Reads directly from `prediction_feedback` — RLS scopes to the caller's
 * own rows so this is safe.
 */
export async function fetchUserPredictionFeedback(
  client: SupabaseClient,
  userId: string | null,
  predictionId: string,
): Promise<{ helpful: boolean } | null> {
  if (!userId) return null;
  const { data, error } = await client
    .from("prediction_feedback")
    .select("helpful")
    .eq("user_id", userId)
    .eq("marketmind_prediction_id", predictionId)
    .maybeSingle();

  if (error) {
    console.warn(`[feedback] fetchUserPredictionFeedback failed: ${error.message}`);
    return null;
  }
  if (!data) return null;
  return { helpful: data.helpful };
}
