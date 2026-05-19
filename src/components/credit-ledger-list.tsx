import Link from "next/link";
import { ArrowDown, ArrowUp, Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CreditLedgerRow } from "@/lib/bets";

type Props = {
  rows: CreditLedgerRow[];
};

/**
 * Append-only credit ledger view — every WAGER, PAYOUT, REFUND, and
 * SIGNUP_BONUS that's ever touched the user's balance, newest first.
 *
 * Each row shows the running `balance_after` so the user can read down the
 * list and reconcile their current balance back to their first deposit.
 * That's the point — the ledger is the source of truth.
 */
export function CreditLedgerList({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="text-muted-foreground border-border/60 rounded-xl border border-dashed p-10 text-center text-sm">
        <p className="text-foreground mb-1 font-medium">No credit activity yet</p>
        <p>Your signup bonus + every bet you place will show up here.</p>
      </div>
    );
  }

  return (
    <ul className="divide-border/40 border-border/60 bg-card/30 divide-y rounded-xl border">
      {rows.map((row) => (
        <LedgerRow key={row.id} row={row} />
      ))}
    </ul>
  );
}

function LedgerRow({ row }: { row: CreditLedgerRow }) {
  const meta = typeMeta(row.type);
  const isCredit = row.amount > 0;
  return (
    <li className="hover:bg-card/60 flex flex-col gap-2 px-4 py-3 transition-colors sm:flex-row sm:items-center sm:gap-4">
      {/* Type + ticker context */}
      <div className="flex min-w-0 items-center gap-2 sm:w-56">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium tracking-wider uppercase",
            meta.className,
          )}
        >
          {meta.icon}
          {meta.label}
        </span>
        {row.predictionRef && (
          <Link
            href={`/stock/${row.predictionRef.ticker}`}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-mono text-xs"
          >
            {row.predictionRef.ticker}
            {row.predictionRef.direction === "UP" ? (
              <ArrowUp className="h-3 w-3 text-emerald-500" aria-hidden />
            ) : (
              <ArrowDown className="h-3 w-3 text-rose-500" aria-hidden />
            )}
          </Link>
        )}
      </div>

      {/* Amount */}
      <div className="flex flex-1 items-center gap-3">
        <span
          className={cn(
            "font-mono text-sm font-semibold tabular-nums",
            isCredit ? "text-emerald-600" : "text-rose-600",
          )}
        >
          {isCredit ? "+" : ""}
          {row.amount.toLocaleString()}
        </span>
        <span className="text-muted-foreground text-[11px]">
          balance {row.balance_after.toLocaleString()}
        </span>
      </div>

      {/* Timestamp */}
      <span className="text-muted-foreground font-mono text-[11px] tabular-nums sm:text-right">
        {formatTimestamp(row.created_at)}
      </span>
    </li>
  );
}

function typeMeta(type: string): {
  label: string;
  className: string;
  icon: React.ReactNode;
} {
  switch (type) {
    case "WAGER":
      return {
        label: "Wager",
        className: "border-amber-500/40 bg-amber-500/10 text-amber-600",
        icon: null,
      };
    case "PAYOUT":
      return {
        label: "Payout",
        className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
        icon: null,
      };
    case "REFUND":
      return {
        label: "Refund",
        className: "border-border bg-card text-muted-foreground",
        icon: null,
      };
    case "SIGNUP_BONUS":
      return {
        label: "Signup",
        className: "border-blue-500/40 bg-blue-500/10 text-blue-600",
        icon: <Coins className="h-2.5 w-2.5" aria-hidden />,
      };
    default:
      return {
        label: type.toLowerCase().replace(/_/g, " "),
        className: "border-border bg-card text-muted-foreground",
        icon: null,
      };
  }
}

/** "May 19 · 2:14 PM" — relative date is overkill for an audit ledger. */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}
