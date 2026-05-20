"use client";

import { useState, useTransition } from "react";
import { CalendarClock, Check, Plus, Star, Trophy, Vote } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  removeStockRequest,
  submitStockRequest,
} from "@/app/actions/stock-requests";
import type { TickerSearchResult } from "@/lib/ticker-search";
import {
  MAX_PROMOTIONS_PER_WEEK,
  PROMOTION_VOTE_THRESHOLD,
  WEEKLY_REQUEST_LIMIT,
  type TopStockRequest,
} from "@/lib/stock-requests";
import { TickerSearchInput } from "@/components/ticker-search-input";

type Props = {
  topRequests: TopStockRequest[];
  /** Tickers the current user has voted for (already-requested set). */
  userVotes: string[];
  /** How many unique-ticker requests this user has made in the last 7d. */
  weeklyUsed: number;
};

/**
 * The interactive surface of /requests.
 *
 * Holds local state for:
 *   - the search/submit flow (TickerSearchInput → onPick → submitStockRequest)
 *   - optimistic merging of new submissions into the list
 *   - optimistic toggle of the "I want this" button per row
 *
 * Each mutation rolls back on RPC failure via state-restore + sonner toast.
 */
export function StockRequestPanel({
  topRequests,
  userVotes,
  weeklyUsed,
}: Props) {
  const [requests, setRequests] = useState<TopStockRequest[]>(topRequests);
  const [votes, setVotes] = useState<Set<string>>(new Set(userVotes));
  // Local counter for the badge. Bumps optimistically on a new request,
  // rolls back if the server rejects. The RPC is the authoritative gate.
  const [used, setUsed] = useState<number>(weeklyUsed);
  const [isPending, startTransition] = useTransition();
  const limitReached = used >= WEEKLY_REQUEST_LIMIT;

  // ---------------------------------------------------------------------------
  // Submit a new request (from the search dropdown)
  // ---------------------------------------------------------------------------
  function handlePick(result: TickerSearchResult) {
    // Already voted? Show a gentler "already submitted" toast and bail.
    if (votes.has(result.ticker)) {
      toast.info(`${result.ticker} is already on your list.`);
      return;
    }
    // Hit the local weekly limit? RPC would reject anyway, but bail
    // optimistically so the UI doesn't briefly flash the row in.
    if (limitReached) {
      toast.error(
        `You've used your ${WEEKLY_REQUEST_LIMIT} requests for this week.`,
      );
      return;
    }

    // Optimistic — add the row and vote, undo if the server rejects.
    const previousRequests = requests;
    const previousVotes = votes;
    const previousUsed = used;

    setVotes((s) => new Set([...s, result.ticker]));
    setUsed(used + 1);  // new ticker → counts against the weekly budget
    const existing = requests.find((r) => r.ticker === result.ticker);
    if (existing) {
      setRequests(requests.map((r) =>
        r.ticker === result.ticker
          ? { ...r, voteCount: r.voteCount + 1, latestRequestAt: new Date().toISOString() }
          : r,
      ));
    } else {
      setRequests([
        {
          ticker: result.ticker,
          companyName: result.displayName,
          voteCount: 1,
          latestRequestAt: new Date().toISOString(),
        },
        ...requests,
      ]);
    }

    startTransition(async () => {
      const out = await submitStockRequest(result.ticker);
      if (!out.ok) {
        setRequests(previousRequests);
        setVotes(previousVotes);
        setUsed(previousUsed);
        toast.error(out.error);
      } else {
        toast.success(`${out.ticker} added to the request list.`);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Toggle vote on an existing row (the "I want this" / "remove vote" button)
  // ---------------------------------------------------------------------------
  function handleToggleVote(ticker: string, currentlyVoted: boolean) {
    const previousRequests = requests;
    const previousVotes = votes;
    const previousUsed = used;

    if (currentlyVoted) {
      // Remove vote — drop count by 1; if it hits zero we still leave the
      // row visible until the server confirms (revalidatePath will refresh
      // the page and clean up). The weekly counter does NOT decrement
      // here because the rolling window is based on `created_at` of the
      // original request, which gets deleted; the count will accurately
      // re-render on next page load via fetchUserWeeklyRequestCount.
      setVotes((s) => {
        const next = new Set(s);
        next.delete(ticker);
        return next;
      });
      setRequests(requests.map((r) =>
        r.ticker === ticker ? { ...r, voteCount: Math.max(0, r.voteCount - 1) } : r,
      ));
    } else {
      // Re-vote on existing row. RPC counts this as a new unique-ticker
      // request only if the user had previously removed their vote; if
      // they're toggling for the first time on someone else's row, the
      // RPC enforces the 5/week. Bail optimistically if locally we're
      // at the limit.
      if (limitReached) {
        toast.error(
          `You've used your ${WEEKLY_REQUEST_LIMIT} requests for this week.`,
        );
        return;
      }
      setVotes((s) => new Set([...s, ticker]));
      setUsed(used + 1);
      setRequests(requests.map((r) =>
        r.ticker === ticker ? { ...r, voteCount: r.voteCount + 1 } : r,
      ));
    }

    startTransition(async () => {
      const out = currentlyVoted
        ? await removeStockRequest(ticker)
        : await submitStockRequest(ticker);
      if (!out.ok) {
        setRequests(previousRequests);
        setVotes(previousVotes);
        setUsed(previousUsed);
        toast.error(out.error);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-8">
      {/* How it works — surfaces the full set of promotion criteria so a user
          doesn't need to read the changelog to understand why a request might
          (or might not) make it into the universe. */}
      <section
        aria-labelledby="how-it-works-heading"
        className="border-border/60 bg-card/30 rounded-xl border p-5"
      >
        <h2
          id="how-it-works-heading"
          className="text-foreground mb-3 text-sm font-semibold tracking-wide uppercase"
        >
          How requests work
        </h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          <li className="flex gap-3">
            <Vote className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <div className="space-y-0.5">
              <p className="text-foreground text-sm font-medium">
                Needs {PROMOTION_VOTE_THRESHOLD}+ votes
              </p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                A ticker must collect at least {PROMOTION_VOTE_THRESHOLD} unique-user votes
                before it qualifies for the next rotation.
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <CalendarClock className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <div className="space-y-0.5">
              <p className="text-foreground text-sm font-medium">Promotes on Sunday</p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Qualified requests are added during the weekly universe rotation
                while the bet window is closed.
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <Trophy className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <div className="space-y-0.5">
              <p className="text-foreground text-sm font-medium">
                Up to {MAX_PROMOTIONS_PER_WEEK} added each week
              </p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Highest-vote tickers go first. The universe stays fixed at 50 — each
                add replaces an inactive stock.
              </p>
            </div>
          </li>
        </ul>
        <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
          Eligibility: US-listed common stocks at or above $2B market cap. Each user can
          submit up to {WEEKLY_REQUEST_LIMIT} unique tickers per rolling 7-day window. Market
          cap is re-checked at rotation time — a ticker that's fallen below $2B since you
          requested it will be skipped until it recovers.
        </p>
      </section>

      {/* Search + submit */}
      <section className="space-y-3">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="space-y-1">
            <h2 className="text-base font-semibold">Submit a request</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Type a ticker or company name. We only allow US-listed common stocks at or above
              $2B market cap — the search filters the rest out for you.
            </p>
          </div>
          {/* Weekly budget badge — separate visual treatment when limit is reached. */}
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium tabular-nums",
              limitReached
                ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "border-border/60 bg-card/40 text-muted-foreground",
            )}
            title="Each user can request 5 unique tickers per rolling 7-day window."
          >
            {used} of {WEEKLY_REQUEST_LIMIT} weekly requests used
          </span>
        </header>
        <TickerSearchInput
          onPick={handlePick}
          disabled={isPending || limitReached}
          threshold="top 2000 by market cap"
        />
        {limitReached && !isPending && (
          <p className="text-amber-600 dark:text-amber-400 text-sm">
            Weekly limit reached. Your oldest request ages out 7 days after you made it; budget
            recovers automatically as that happens.
          </p>
        )}
        {isPending && <p className="text-muted-foreground text-sm">Submitting…</p>}
      </section>

      {/* Listing */}
      <section className="space-y-3">
        <header className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Currently requested</h2>
          <span className="text-muted-foreground text-xs">
            {requests.length} {requests.length === 1 ? "ticker" : "tickers"}
          </span>
        </header>

        {requests.length === 0 ? (
          <div className="border-border/60 bg-card/30 rounded-xl border p-6 text-center">
            <p className="text-muted-foreground text-sm leading-relaxed">
              No requests yet. Be the first to suggest a stock.
            </p>
          </div>
        ) : (
          <ul className="border-border/60 divide-border/40 bg-card/30 overflow-hidden rounded-xl border divide-y">
            {requests.map((r) => {
              const voted = votes.has(r.ticker);
              const promotionReady = r.voteCount >= PROMOTION_VOTE_THRESHOLD;
              const votesRemaining = Math.max(
                0,
                PROMOTION_VOTE_THRESHOLD - r.voteCount,
              );
              return (
                <li key={r.ticker} className="flex items-center gap-3 px-4 py-3.5">
                  <div className="flex-1 overflow-hidden">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground font-mono text-base font-semibold">
                        {r.ticker}
                      </span>
                      {voted && (
                        <Star
                          className="h-3.5 w-3.5 fill-amber-500 text-amber-500"
                          aria-label="You voted for this"
                        />
                      )}
                      {promotionReady && (
                        <span
                          className="inline-flex items-center rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-600 uppercase dark:text-emerald-400"
                          title="Eligible to be added in the next Sunday rotation."
                        >
                          Ready
                        </span>
                      )}
                    </div>
                    {r.companyName && (
                      <p className="text-muted-foreground truncate text-xs leading-tight">
                        {r.companyName}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <p className="text-foreground font-mono text-base font-semibold tabular-nums">
                        {r.voteCount}
                        <span className="text-muted-foreground text-xs font-normal">
                          {" "}/ {PROMOTION_VOTE_THRESHOLD}
                        </span>
                      </p>
                      <p
                        className={cn(
                          "text-[10px] tracking-wider uppercase",
                          promotionReady
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-muted-foreground",
                        )}
                      >
                        {promotionReady
                          ? "ready"
                          : `${votesRemaining} more to qualify`}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleToggleVote(r.ticker, voted)}
                      aria-label={voted ? "Remove your vote" : "Add your vote"}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors",
                        voted
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "border-border/60 bg-card/40 text-muted-foreground hover:border-emerald-500/30 hover:text-foreground",
                        isPending && "cursor-not-allowed opacity-60",
                      )}
                    >
                      {voted ? (
                        <>
                          <Check className="h-3.5 w-3.5" aria-hidden />
                          Voted
                        </>
                      ) : (
                        <>
                          <Plus className="h-3.5 w-3.5" aria-hidden />
                          I want this
                        </>
                      )}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {requests.length > 0 && (
          <p className="text-muted-foreground text-xs leading-relaxed">
            Rows marked <span className="font-semibold text-emerald-600 dark:text-emerald-400">Ready</span>{" "}
            have crossed the {PROMOTION_VOTE_THRESHOLD}-vote threshold and will be considered in this
            Sunday's rotation (top {MAX_PROMOTIONS_PER_WEEK} by votes).
          </p>
        )}
      </section>
    </div>
  );
}
