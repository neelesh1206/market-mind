import type { SupabaseClient } from "@supabase/supabase-js";

export type Prediction = {
  id: string;
  user_id: string;
  stock_id: string;
  prediction_date: string;
  direction: "UP" | "DOWN";
  credits_wagered: number;
  locked_at: string;
  resolved: boolean;
  outcome: "WIN" | "LOSS" | "VOID" | null;
  open_price: number | null;
  close_price: number | null;
  payout: number | null;
  resolved_at: string | null;
  created_at: string;
};

/**
 * All of the user's bets for a given trading day, keyed by stock_id for O(1)
 * lookup from the home feed.
 *
 * `tradingDayLabel` should come from `getMarketSchedule().tradingDayLabel` so
 * the answer matches whatever the UI is showing. We deliberately don't use
 * the server's local date — that drifts from the ET trading day after 9 PM PT.
 */
export async function fetchBetsForTradingDay(
  client: SupabaseClient,
  userId: string,
  tradingDayLabel: string,
): Promise<Record<string, Prediction>> {
  const { data, error } = await client
    .from("predictions")
    .select(
      "id, user_id, stock_id, prediction_date, direction, credits_wagered, locked_at, resolved, outcome, open_price, close_price, payout, resolved_at, created_at",
    )
    .eq("user_id", userId)
    .eq("prediction_date", tradingDayLabel);

  if (error) {
    throw new Error(`fetchBetsForTradingDay: ${error.message}`);
  }

  const out: Record<string, Prediction> = {};
  for (const row of (data ?? []) as Prediction[]) {
    out[row.stock_id] = row;
  }
  return out;
}
