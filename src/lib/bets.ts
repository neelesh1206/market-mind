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

export type BetHistoryRow = Prediction & {
  stock: { ticker: string; name: string; sector: string | null };
};

export type BetHistoryFilter = "all" | "pending" | "resolved";

/**
 * Full bet history for the user, joined with stock metadata for display.
 *
 * Ordered prediction_date desc, then created_at desc — so the most recent
 * trading day is first, with multiple bets within that day ordered by when
 * the user placed them. Limited to `limit` rows; pagination is a follow-up.
 */
export async function fetchUserBetHistory(
  client: SupabaseClient,
  userId: string,
  opts: { limit?: number; filter?: BetHistoryFilter } = {},
): Promise<BetHistoryRow[]> {
  const { limit = 100, filter = "all" } = opts;

  let query = client
    .from("predictions")
    .select(
      "id, user_id, stock_id, prediction_date, direction, credits_wagered, locked_at, resolved, outcome, open_price, close_price, payout, resolved_at, created_at, stocks(ticker, name, sector)",
    )
    .eq("user_id", userId)
    .order("prediction_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (filter === "pending") query = query.eq("resolved", false);
  else if (filter === "resolved") query = query.eq("resolved", true);

  const { data, error } = await query;
  if (error) {
    throw new Error(`fetchUserBetHistory: ${error.message}`);
  }

  type Row = Prediction & {
    stocks: { ticker: string; name: string; sector: string | null } | null;
  };

  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.stocks !== null)
    .map((r) => {
      const stock = r.stocks!;
      return { ...r, stock } as BetHistoryRow;
    });
}

/** Aggregate stats for the history header strip. */
export type BetStats = {
  total: number;
  pending: number;
  wins: number;
  losses: number;
  voids: number;
  accuracy: number | null; // null when no resolved bets yet
  netCredits: number; // sum of payouts (resolved bets only)
};

export function computeBetStats(rows: BetHistoryRow[]): BetStats {
  let pending = 0;
  let wins = 0;
  let losses = 0;
  let voids = 0;
  let netCredits = 0;

  for (const r of rows) {
    if (!r.resolved) {
      pending += 1;
      continue;
    }
    if (r.outcome === "WIN") wins += 1;
    else if (r.outcome === "LOSS") losses += 1;
    else if (r.outcome === "VOID") voids += 1;
    // Resolution job stores absolute payout (full payout for WIN, 0 for LOSS,
    // refunded stake for VOID). To net out the original wager:
    //   net = payout - credits_wagered
    if (r.payout !== null) netCredits += r.payout - r.credits_wagered;
  }

  // `decisive` excludes VOIDs from the denominator — a flat-tape day isn't
  // a wrong call, just an unresolvable one.
  const decisive = wins + losses;
  return {
    total: rows.length,
    pending,
    wins,
    losses,
    voids,
    accuracy: decisive > 0 ? wins / decisive : null,
    netCredits,
  };
}

export type CreditTransaction = {
  id: string;
  user_id: string;
  amount: number;
  type: string;
  reference_id: string | null;
  balance_after: number;
  created_at: string;
};

export type CreditLedgerRow = CreditTransaction & {
  /** Resolved from `reference_id` when it points to a prediction. */
  predictionRef: {
    ticker: string;
    direction: "UP" | "DOWN";
    prediction_date: string;
  } | null;
};

/**
 * Recent credit ledger entries with prediction context where applicable.
 *
 * `reference_id` is a polymorphic FK in the schema (no enforced relation), so
 * we resolve prediction references in a second small query rather than via
 * PostgREST embedding. Cheap for the ~100-row UI page.
 */
export async function fetchCreditLedger(
  client: SupabaseClient,
  userId: string,
  limit = 100,
): Promise<CreditLedgerRow[]> {
  const { data, error } = await client
    .from("credit_transactions")
    .select("id, user_id, amount, type, reference_id, balance_after, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`fetchCreditLedger: ${error.message}`);
  }

  const tx = (data ?? []) as CreditTransaction[];
  const predIds = Array.from(
    new Set(tx.filter((r) => r.reference_id !== null).map((r) => r.reference_id!)),
  );

  type PredRef = { id: string; direction: "UP" | "DOWN"; prediction_date: string; stocks: { ticker: string } | null };
  let predIndex: Record<string, PredRef> = {};

  if (predIds.length > 0) {
    const { data: pdata, error: perr } = await client
      .from("predictions")
      .select("id, direction, prediction_date, stocks(ticker)")
      .in("id", predIds);
    if (perr) {
      // Don't fail the whole ledger view if the join lookup hiccups —
      // just degrade to "no ticker context".
      console.warn("fetchCreditLedger: prediction lookup failed", perr.message);
    } else {
      predIndex = Object.fromEntries(
        ((pdata ?? []) as unknown as PredRef[]).map((p) => [p.id, p]),
      );
    }
  }

  return tx.map((r) => {
    const ref = r.reference_id ? predIndex[r.reference_id] : null;
    return {
      ...r,
      predictionRef:
        ref && ref.stocks
          ? {
              ticker: ref.stocks.ticker,
              direction: ref.direction,
              prediction_date: ref.prediction_date,
            }
          : null,
    };
  });
}
