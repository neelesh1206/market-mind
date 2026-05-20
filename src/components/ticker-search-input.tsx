"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchTickersAction } from "@/app/actions/stock-requests";
import type { TickerSearchResult } from "@/lib/ticker-search";

type Props = {
  /** Called when the user picks a result. Parent does the actual submission. */
  onPick: (result: TickerSearchResult) => void | Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  /** Hint about which tickers will be rejected — surfaced in the empty state. */
  threshold?: string;
};

/**
 * Searchable ticker dropdown for the stock-request flow.
 *
 * Wires together:
 *   - Debounced input (350ms — feels responsive without burning Finnhub quota)
 *   - Server action `searchTickersAction` (hits Finnhub /search, cached in Redis 1h)
 *   - Keyboard nav: ↓/↑ to move highlight, Enter to pick, Esc to close
 *   - Click-outside to close
 *
 * Validation (market cap, US-listed, not-already-in-universe) happens AFTER
 * the user picks — the dropdown only filters the universe to "active US
 * common stocks." The parent's `onPick` handler triggers the validation +
 * submit, then the result of THAT goes back to the user.
 *
 * Deliberately ungated for anon visitors; they see the search work but
 * `onPick` fails with "sign in" copy from the server action.
 */
export function TickerSearchInput({
  onPick,
  disabled = false,
  placeholder = "Search by ticker or company name…",
  threshold,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TickerSearchResult[]>([]);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false); // false until first round-trip
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search — fires 350ms after the user stops typing.
  //
  // We intentionally bail with a `return` (no setState) when the query is
  // empty; lint rule `react-hooks/set-state-in-effect` forbids synchronous
  // setState inside an effect body, and the "empty query" branch is handled
  // downstream by deriving `effectiveResults` from query+results.
  // The cleanup function clears the timer when the query changes again, so
  // an in-flight debounce doesn't leak.
  useEffect(() => {
    if (!query.trim()) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      if (cancelled) return;
      setSearching(true);
      try {
        const rows = await searchTickersAction(query);
        if (cancelled) return;
        setResults(rows);
        setHighlightIdx(0);
        setSearched(true);
      } catch (err) {
        console.warn("[ticker-search-input] search failed:", err);
        if (cancelled) return;
        setResults([]);
        setSearched(true);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  // Derived state — when the query is empty, the dropdown should show
  // nothing regardless of what's cached in `results` from a previous query.
  // This avoids needing to setState in the empty-query branch above.
  const effectiveResults = query.trim() ? results : [];
  const effectiveSearched = query.trim() ? searched : false;

  // Click-outside close
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const pick = useCallback(
    async (r: TickerSearchResult) => {
      setQuery("");
      setResults([]);
      setOpen(false);
      setSearched(false);
      inputRef.current?.blur();
      await onPick(r);
    },
    [onPick],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, effectiveResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && effectiveResults[highlightIdx]) {
      e.preventDefault();
      void pick(effectiveResults[highlightIdx]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  const showDropdown =
    open && (searching || effectiveResults.length > 0 || (effectiveSearched && query.trim().length > 0));

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search
          className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
          aria-hidden
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          aria-label="Search for a stock"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-controls="ticker-search-results"
          className={cn(
            "bg-card/40 border-border/60 placeholder:text-muted-foreground/70 w-full rounded-md border py-2.5 pr-3 pl-9 text-sm",
            "focus:border-emerald-500/40 focus:outline-none",
            disabled && "cursor-not-allowed opacity-60",
          )}
        />
      </div>

      {showDropdown && (
        <div
          id="ticker-search-results"
          role="listbox"
          className="border-border/60 bg-popover absolute z-20 mt-1 w-full overflow-hidden rounded-md border shadow-md"
        >
          {searching && effectiveResults.length === 0 && (
            <div className="text-muted-foreground px-3 py-2 text-xs">Searching…</div>
          )}
          {!searching && effectiveResults.length === 0 && effectiveSearched && (
            <div className="text-muted-foreground px-3 py-2 text-xs leading-relaxed">
              No US-listed common-stock matches.
              {threshold && (
                <>
                  {" "}
                  We restrict to ~{threshold} so micro-caps and OTC tickers won&apos;t appear.
                </>
              )}
            </div>
          )}
          {effectiveResults.length > 0 && (
            <ul className="max-h-80 overflow-y-auto">
              {effectiveResults.map((r, idx) => (
                <li key={`${r.ticker}-${r.exchange}`}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlightIdx(idx)}
                    onClick={() => void pick(r)}
                    role="option"
                    aria-selected={idx === highlightIdx}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors",
                      idx === highlightIdx
                        ? "bg-emerald-500/10 text-foreground"
                        : "text-foreground/90 hover:bg-muted/50",
                    )}
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-foreground font-mono text-sm font-semibold">
                        {r.ticker}
                      </span>
                      <span className="text-muted-foreground truncate text-[11px]">
                        {r.displayName}
                      </span>
                    </div>
                    {r.exchange && (
                      <span className="text-muted-foreground/80 text-[10px] tracking-wider uppercase">
                        {r.exchange}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
