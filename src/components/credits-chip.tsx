"use client";

import { useEffect, useState, useTransition } from "react";
import { Sparkles, Tag } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DAILY_PROMO_CAP,
  REDEEM_ERROR_COPY,
  normalizeCode,
  type RecentRedemption,
} from "@/lib/promo-codes";
import {
  getCreditsDialogData,
  redeemPromoCode,
} from "@/app/actions/promo-codes";

type Props = {
  credits: number;
};

/**
 * The credit balance chip in the page header. Clicking it opens a sheet
 * with the redemption form, daily-cap progress, and recent history.
 *
 * Data is lazy-loaded on first open via `getCreditsDialogData` so pages
 * don't need to fetch the redemption history just to render the chip.
 *
 * Balance shown is whatever the server prop says — after a redeem the
 * server action calls revalidatePath, so the next render gets the fresh
 * value. We don't mirror it into local state (that'd require a
 * sync-on-prop-change effect, which React lint rightly flags).
 */
export function CreditsChip({ credits }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button
            type="button"
            aria-label="Open credits"
            className="border-border/60 bg-card/40 hover:bg-card/60 flex items-center gap-2 rounded-full border px-2.5 py-1 transition-colors sm:px-3 sm:py-1.5"
          />
        }
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        <span className="text-xs font-medium tabular-nums">
          {credits.toLocaleString()}
          <span className="text-muted-foreground hidden sm:inline"> credits</span>
        </span>
      </SheetTrigger>

      <SheetContent side="right" className="w-full sm:max-w-md">
        <CreditsDialogBody open={open} balance={credits} />
      </SheetContent>
    </Sheet>
  );
}

// ----------------------------------------------------------------------------
// Body — separated so we can reset internal state on open/close transitions.
// ----------------------------------------------------------------------------

type BodyProps = {
  open: boolean;
  balance: number;
};

type DialogData = {
  dailyUsed: number;
  recent: RecentRedemption[];
};

function CreditsDialogBody({ open, balance }: BodyProps) {
  const [code, setCode] = useState("");
  const [data, setData] = useState<DialogData | null>(null);
  const [isPending, startTransition] = useTransition();

  // Lazy-fetch data when the sheet opens. `data === null` means loading;
  // a populated object means we have it. No separate `loading` setState
  // call needed — derived from `data` directly.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getCreditsDialogData().then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setData({ dailyUsed: res.dailyUsed, recent: res.recent });
      } else {
        setData({ dailyUsed: 0, recent: [] });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const loadingData = open && data === null;
  const dailyUsed = data?.dailyUsed ?? 0;
  const recent = data?.recent ?? [];
  const dailyRemaining = Math.max(0, DAILY_PROMO_CAP - dailyUsed);
  const atCap = dailyRemaining === 0;
  const progressPct = Math.min(100, (dailyUsed / DAILY_PROMO_CAP) * 100);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = normalizeCode(code);
    if (cleaned.length < 4) {
      toast.error("Enter a code first.");
      return;
    }

    startTransition(async () => {
      const out = await redeemPromoCode(cleaned);
      if (!out.ok) {
        toast.error(REDEEM_ERROR_COPY[out.error]);
        return;
      }
      // Success — show toast, update local cap counter + recent list. The
      // balance updates via revalidatePath -> server prop -> parent rerender.
      setData((prev) => ({
        dailyUsed: out.dailyUsed,
        recent: [
          { code: cleaned, credits: out.creditsAwarded, redeemedAt: new Date().toISOString() },
          ...(prev?.recent ?? []),
        ].slice(0, 5),
      }));
      setCode("");
      toast.success(`+${out.creditsAwarded.toLocaleString()} credits added!`);
    });
  }

  return (
    <div className="flex h-full flex-col gap-6 p-5">
      <SheetHeader className="p-0">
        <SheetTitle className="flex items-center gap-2 text-lg">
          <Sparkles className="h-5 w-5 text-emerald-500" aria-hidden />
          Credits
        </SheetTitle>
        <SheetDescription>Your balance, code redemption, and history.</SheetDescription>
      </SheetHeader>

      {/* Balance */}
      <section className="border-border/60 bg-card/40 rounded-xl border p-4">
        <p className="text-muted-foreground text-xs tracking-wide uppercase">Balance</p>
        <p className="text-foreground mt-1 font-mono text-3xl font-semibold tabular-nums">
          {balance.toLocaleString()}
        </p>
      </section>

      {/* Redeem */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Redeem a code</h3>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="LAUNCH2026"
            disabled={isPending || atCap}
            maxLength={32}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="characters"
            className="border-border/60 bg-card/40 focus-visible:ring-emerald-500 flex-1 rounded-md border px-3 py-2 font-mono text-sm tracking-wider uppercase focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
          />
          <Button type="submit" disabled={isPending || atCap || code.trim().length < 4}>
            {isPending ? "Redeeming…" : "Redeem"}
          </Button>
        </form>

        {/* Daily-cap progress */}
        <div className="space-y-1">
          <div className="flex items-baseline justify-between text-xs">
            <span className={cn(atCap ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
              {loadingData
                ? "Loading today's usage…"
                : `${dailyUsed.toLocaleString()} / ${DAILY_PROMO_CAP.toLocaleString()} credits used today`}
            </span>
            {!loadingData && (
              <span className="text-muted-foreground tabular-nums">
                {dailyRemaining.toLocaleString()} left
              </span>
            )}
          </div>
          <div className="bg-border/40 h-1.5 w-full overflow-hidden rounded-full">
            <div
              className={cn(
                "h-full transition-all duration-300",
                atCap ? "bg-amber-500" : "bg-emerald-500",
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-muted-foreground text-[11px]">Daily cap resets at midnight ET.</p>
        </div>
      </section>

      {/* How codes work */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">How codes work</h3>
        <ul className="text-muted-foreground space-y-1.5 text-xs leading-relaxed">
          <li>• Codes are shared during launches, with collaborators, and as make-goods after incidents.</li>
          <li>• Each code is redeemable once per account.</li>
          <li>• Up to {DAILY_PROMO_CAP.toLocaleString()} credits per day via codes.</li>
        </ul>
      </section>

      {/* Recent redemptions */}
      <section className="flex-1 space-y-2">
        <h3 className="text-sm font-semibold">Recent redemptions</h3>
        {loadingData ? (
          <p className="text-muted-foreground text-xs">Loading…</p>
        ) : recent.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            None yet. Codes you redeem will show up here.
          </p>
        ) : (
          <ul className="divide-border/40 border-border/60 bg-card/30 divide-y overflow-hidden rounded-lg border">
            {recent.map((r) => (
              <li key={`${r.code}-${r.redeemedAt}`} className="flex items-center gap-3 px-3 py-2.5">
                <Tag className="text-muted-foreground h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="text-foreground flex-1 truncate font-mono text-xs">{r.code}</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-mono text-xs font-semibold tabular-nums">
                  +{r.credits.toLocaleString()}
                </span>
                <span className="text-muted-foreground text-[10px] tabular-nums">
                  {formatAgo(r.redeemedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
