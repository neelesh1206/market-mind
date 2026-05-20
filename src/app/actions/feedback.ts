"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";

export type SubmitFeedbackResult = { ok: true } | { ok: false; error: string };

/**
 * Submit thumbs feedback on a MarketMind verdict.
 *
 * Wraps the `submit_prediction_feedback` RPC which idempotently upserts
 * keyed on (auth.uid(), prediction_id). Re-calling with a different
 * `helpful` value flips the user's vote.
 *
 * Re-validates `/stock/[ticker]` so the aggregate count refreshes.
 */
export async function submitPredictionFeedback({
  predictionId,
  ticker,
  helpful,
  comment,
}: {
  predictionId: string;
  ticker: string;
  helpful: boolean;
  comment?: string;
}): Promise<SubmitFeedbackResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return { ok: false, error: "Sign in to share feedback" };
  }

  // Per-user soft cap. Feedback is cheap but unbounded; same pattern as
  // the other mutation actions.
  const rl = await rateLimit("submitFeedback", user.id);
  if (!rl.ok) {
    return { ok: false, error: `Slow down — try again in ${rl.retryAfter}s` };
  }

  const { error } = await supabase.rpc("submit_prediction_feedback", {
    p_prediction_id: predictionId,
    p_helpful: helpful,
    p_comment: comment ?? null,
  });

  if (error) {
    console.error("[feedback] submit_prediction_feedback failed:", error);
    // Map known errcodes to user copy
    if (error.message.includes("verdict_missing")) {
      return { ok: false, error: "Verdict not found" };
    }
    if (error.code === "PGRST202" || error.message.includes("function") && error.message.includes("does not exist")) {
      return { ok: false, error: "Feedback isn't enabled on the server yet (migration pending)" };
    }
    return { ok: false, error: "Couldn't save feedback. Try again?" };
  }

  // Refresh aggregate count on the page
  revalidatePath(`/stock/${ticker.toUpperCase()}`);
  return { ok: true };
}
