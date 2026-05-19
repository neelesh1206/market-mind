import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A prediction is "stuck" when its trading day has passed but the resolution
 * job hasn't marked it resolved. Indicates either a cron failure, a Yahoo
 * price-data hiccup, or a weekend bet that fell outside the Mon-Fri schedule.
 *
 * The check is calendar-date-only (no time-of-day comparison) because the
 * resolution cron fires at 21:15 UTC = 4:15 PM ET, so by the next ET day
 * any unresolved bet for yesterday's date is overdue.
 *
 * Pure helper — takes the ET today date so the UI render path and the helper
 * stay deterministic without each calling `getMarketSchedule()` separately.
 */
export function isStuckPrediction(
  bet: { prediction_date: string; resolved: boolean },
  todayEt: string,
): boolean {
  return !bet.resolved && bet.prediction_date < todayEt;
}

// Columns that all three read paths share. Kept in sync with the Prediction
// type. `price_at_placement` is the most-recently-added — when its migration
// hasn't been applied yet, the SELECT explodes; helpers below catch that
// specific failure and retry without the new column.
const PREDICTION_COLUMNS =
  "id, user_id, stock_id, prediction_date, direction, credits_wagered, locked_at, resolved, outcome, open_price, close_price, price_at_placement, payout, resolved_at, created_at";

const PREDICTION_COLUMNS_LEGACY =
  "id, user_id, stock_id, prediction_date, direction, credits_wagered, locked_at, resolved, outcome, open_price, close_price, payout, resolved_at, created_at";

/**
 * Postgres "column does not exist" surfaces from PostgREST as code 42703.
 * If a deploy lands ahead of its migration, we'd rather render the page with
 * stale data than crash on a missing column. Caller decides which legacy
 * column to omit.
 */
function isMissingColumnError(err: { code?: string; message?: string } | null): boolean {
  return (
    !!err &&
    (err.code === "42703" || /column .* does not exist/i.test(err.message ?? ""))
  );
}

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
  /**
   * Live price at the moment of placement (informational only — resolution
   * still uses open_price → close_price per ADR 0008). NULL when the live-
   * price fetch failed at placement time.
   */
  price_at_placement: number | null;
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
  // Two-step fallback typed loosely — supabase-js infers the row type from
  // the literal select string, so the legacy branch has a different (subset)
  // shape. We collapse into Partial<Prediction>[] and fill in code.
  type Resp = {
    data: Partial<Prediction>[] | null;
    error: { code?: string; message?: string } | null;
  };

  let res: Resp = (await client
    .from("predictions")
    .select(PREDICTION_COLUMNS)
    .eq("user_id", userId)
    .eq("prediction_date", tradingDayLabel)) as Resp;

  if (res.error && isMissingColumnError(res.error)) {
    console.warn(
      "[bets] price_at_placement column missing; falling back to legacy SELECT",
    );
    res = (await client
      .from("predictions")
      .select(PREDICTION_COLUMNS_LEGACY)
      .eq("user_id", userId)
      .eq("prediction_date", tradingDayLabel)) as Resp;
  }

  if (res.error) {
    throw new Error(`fetchBetsForTradingDay: ${res.error.message}`);
  }

  const out: Record<string, Prediction> = {};
  for (const row of res.data ?? []) {
    out[row.stock_id!] = {
      ...row,
      price_at_placement: row.price_at_placement ?? null,
    } as Prediction;
  }
  return out;
}

export type BetHistoryRow = Prediction & {
  stock: { ticker: string; name: string; sector: string | null };
};

/**
 * Resolved bets the user hasn't seen the reveal animation for yet. Driven by
 * the partial index on (user_id) WHERE resolved AND revealed_at IS NULL, so
 * the query stays cheap as history grows.
 *
 * Capped at `limit` (default 10) so a user returning after a long absence
 * doesn't get a 50-card reveal modal — they see the most recent resolutions.
 */
export async function fetchUnrevealedResolved(
  client: SupabaseClient,
  userId: string,
  limit = 10,
): Promise<BetHistoryRow[]> {
  const selectWith = `${PREDICTION_COLUMNS}, stocks(ticker, name, sector)`;
  const selectLegacy = `${PREDICTION_COLUMNS_LEGACY}, stocks(ticker, name, sector)`;

  type Resp = {
    data: (Partial<Prediction> & { stocks: { ticker: string; name: string; sector: string | null } | null })[] | null;
    error: { code?: string; message?: string } | null;
  };

  let res: Resp = (await client
    .from("predictions")
    .select(selectWith)
    .eq("user_id", userId)
    .eq("resolved", true)
    .is("revealed_at", null)
    .order("prediction_date", { ascending: false })
    .limit(limit)) as Resp;

  if (res.error && isMissingColumnError(res.error)) {
    console.warn(
      "[reveals] price_at_placement column missing; falling back to legacy SELECT",
    );
    res = (await client
      .from("predictions")
      .select(selectLegacy)
      .eq("user_id", userId)
      .eq("resolved", true)
      .is("revealed_at", null)
      .order("prediction_date", { ascending: false })
      .limit(limit)) as Resp;
  }

  if (res.error) {
    // Schema-missing case (revealed_at column itself not deployed) →
    // degrade silently rather than break the home page render.
    console.warn(`[reveals] fetchUnrevealedResolved: ${res.error.message}`);
    return [];
  }

  return (res.data ?? [])
    .filter((r) => r.stocks !== null)
    .map((r) => ({
      ...r,
      price_at_placement: r.price_at_placement ?? null,
      stock: r.stocks!,
    }) as BetHistoryRow);
}

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

  const baseSelect = `${PREDICTION_COLUMNS}, stocks(ticker, name, sector)`;
  const legacySelect = `${PREDICTION_COLUMNS_LEGACY}, stocks(ticker, name, sector)`;

  type Resp = {
    data: (Partial<Prediction> & { stocks: { ticker: string; name: string; sector: string | null } | null })[] | null;
    error: { code?: string; message?: string } | null;
  };

  async function runQuery(selectCols: string): Promise<Resp> {
    let q = client
      .from("predictions")
      .select(selectCols)
      .eq("user_id", userId)
      .order("prediction_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    if (filter === "pending") q = q.eq("resolved", false);
    else if (filter === "resolved") q = q.eq("resolved", true);
    return (await q) as Resp;
  }

  let res = await runQuery(baseSelect);
  if (res.error && isMissingColumnError(res.error)) {
    console.warn(
      "[bets] price_at_placement column missing; falling back to legacy SELECT",
    );
    res = await runQuery(legacySelect);
  }
  if (res.error) {
    throw new Error(`fetchUserBetHistory: ${res.error.message}`);
  }

  return (res.data ?? [])
    .filter((r) => r.stocks !== null)
    .map((r) => ({
      ...r,
      price_at_placement: r.price_at_placement ?? null,
      stock: r.stocks!,
    }) as BetHistoryRow);
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
