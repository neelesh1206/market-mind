"use client";

import { useState, useTransition } from "react";
import { Check, Plus, Star } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  removeStockRequest,
  submitStockRequest,
} from "@/app/actions/stock-requests";
import type { TickerSearchResult } from "@/lib/ticker-search";
import type { TopStockRequest } from "@/lib/stock-requests";
import { TickerSearchInput } from "@/components/ticker-search-input";

type Props = {
  topRequests: TopStockRequest[];
  /** Tickers the current user has voted for (already-requested set). */
  userVotes: string[];
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
export function StockRequestPanel({ topRequests, userVotes }: Props) {
  const [requests, setRequests] = useState<TopStockRequest[]>(topRequests);
  const [votes, setVotes] = useState<Set<string>>(new Set(userVotes));
  const [isPending, startTransition] = useTransition();

  // ---------------------------------------------------------------------------
  // Submit a new request (from the search dropdown)
  // ---------------------------------------------------------------------------
  function handlePick(result: TickerSearchResult) {
    // Already voted? Show a gentler "already submitted" toast and bail.
    if (votes.has(result.ticker)) {
      toast.info(`${result.ticker} is already on your list.`);
      return;
    }

    // Optimistic — add the row and vote, undo if the server rejects.
    const previousRequests = requests;
    const previousVotes = votes;

    setVotes((s) => new Set([...s, result.ticker]));
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

    if (currentlyVoted) {
      // Remove vote — drop count by 1; if it hits zero we still leave the
      // row visible until the server confirms (revalidatePath will refresh
      // the page and clean up).
      setVotes((s) => {
        const next = new Set(s);
        next.delete(ticker);
        return next;
      });
      setRequests(requests.map((r) =>
        r.ticker === ticker ? { ...r, voteCount: Math.max(0, r.voteCount - 1) } : r,
      ));
    } else {
      setVotes((s) => new Set([...s, ticker]));
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
        toast.error(out.error);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-8">
      {/* Search + submit */}
      <section className="space-y-3">
        <header className="space-y-1">
          <h2 className="text-base font-semibold">Submit a request</h2>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Type a ticker or company name. We only allow US-listed common stocks at or above
            $2B market cap — the search will filter the rest out for you.
          </p>
        </header>
        <TickerSearchInput
          onPick={handlePick}
          disabled={isPending}
          threshold="top 2000 by market cap"
        />
        {isPending && (
          <p className="text-muted-foreground text-xs">Submitting…</p>
        )}
      </section>

      {/* Listing */}
      <section className="space-y-3">
        <header className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">Currently requested</h2>
          <span className="text-muted-foreground text-[11px]">
            {requests.length} {requests.length === 1 ? "stock" : "stocks"}
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
              return (
                <li key={r.ticker} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 overflow-hidden">
                    <div className="flex items-center gap-1.5">
                      <span className="text-foreground font-mono text-sm font-semibold">
                        {r.ticker}
                      </span>
                      {voted && (
                        <Star
                          className="h-3 w-3 fill-amber-500 text-amber-500"
                          aria-label="You voted for this"
                        />
                      )}
                    </div>
                    {r.companyName && (
                      <p className="text-muted-foreground truncate text-[11px] leading-tight">
                        {r.companyName}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <p className="text-foreground font-mono text-sm font-semibold tabular-nums">
                        {r.voteCount}
                      </p>
                      <p className="text-muted-foreground text-[10px] tracking-wider uppercase">
                        {r.voteCount === 1 ? "vote" : "votes"}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleToggleVote(r.ticker, voted)}
                      aria-label={voted ? "Remove your vote" : "Add your vote"}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors",
                        voted
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "border-border/60 bg-card/40 text-muted-foreground hover:border-emerald-500/30 hover:text-foreground",
                        isPending && "cursor-not-allowed opacity-60",
                      )}
                    >
                      {voted ? (
                        <>
                          <Check className="h-3 w-3" aria-hidden />
                          Voted
                        </>
                      ) : (
                        <>
                          <Plus className="h-3 w-3" aria-hidden />
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
          <p className="text-muted-foreground text-[10px] leading-relaxed">
            Each weekend, the top-requested tickers replace inactive stocks (no watchlists, no
            recent bets). Universe size stays fixed at 50.
          </p>
        )}
      </section>
    </div>
  );
}
