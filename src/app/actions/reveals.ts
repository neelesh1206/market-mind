"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MarkRevealedResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

/**
 * Mark one or more resolved predictions as "revealed" — the user has seen
 * the reveal animation, so don't surface them again. Wraps the
 * `mark_predictions_revealed` Postgres RPC which does the bulk update
 * authorization-scoped to auth.uid().
 *
 * No window gate (you can always mark as seen; the bet is already resolved).
 */
export async function markRevealed(predictionIds: string[]): Promise<MarkRevealedResult> {
  if (!Array.isArray(predictionIds) || predictionIds.length === 0) {
    return { ok: true, count: 0 };
  }
  if (!predictionIds.every((id) => typeof id === "string" && UUID_RE.test(id))) {
    return { ok: false, error: "Invalid prediction id in payload" };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return { ok: false, error: "Not authenticated" };
  }

  const { data, error } = await supabase.rpc("mark_predictions_revealed", {
    p_ids: predictionIds,
  });

  if (error) {
    console.error("markRevealed: rpc failed", {
      code: error.code,
      message: error.message,
    });
    if (error.code === "PGRST202") {
      return { ok: false, error: "Reveals aren't enabled on the server yet (migration pending)" };
    }
    return { ok: false, error: "Couldn't save reveal state — try again" };
  }

  revalidatePath("/");
  revalidatePath("/bets");

  return { ok: true, count: (data as number | null) ?? 0 };
}
