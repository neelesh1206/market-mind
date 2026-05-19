import { Crown, Medal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LeaderboardRow } from "@/lib/leaderboard";

type Props = {
  rows: LeaderboardRow[];
  /** Currently-signed-in user id — their row gets a subtle highlight. */
  currentUserId?: string;
};

/**
 * Ranked list of weekly leaderboard qualifiers. Top 3 get crown/medal
 * iconography in their respective tier colors; everyone else gets a
 * plain monospace rank number.
 */
export function LeaderboardTable({ rows, currentUserId }: Props) {
  if (rows.length === 0) {
    return (
      <div className="text-muted-foreground border-border/60 rounded-xl border border-dashed p-10 text-center text-sm">
        <p className="text-foreground mb-1 font-medium">No qualifiers this week yet</p>
        <p>The leaderboard recomputes every Sunday. First qualifier needs 5+ resolved bets.</p>
      </div>
    );
  }

  return (
    <ul className="divide-border/40 border-border/60 bg-card/30 divide-y rounded-xl border">
      {rows.map((row) => (
        <LeaderboardItem
          key={row.user_id}
          row={row}
          isCurrentUser={row.user_id === currentUserId}
        />
      ))}
    </ul>
  );
}

function LeaderboardItem({ row, isCurrentUser }: { row: LeaderboardRow; isCurrentUser: boolean }) {
  const tierTone =
    row.tier === "diamond"
      ? "text-cyan-300"
      : row.tier === "platinum"
        ? "text-zinc-300"
        : row.tier === "gold"
          ? "text-amber-400"
          : "text-muted-foreground";

  return (
    <li
      className={cn(
        "flex items-center gap-3 px-4 py-3 transition-colors",
        isCurrentUser && "bg-emerald-500/5",
      )}
    >
      {/* Rank chip */}
      <div className="w-10 shrink-0 text-center">
        {row.rank === 1 ? (
          <Crown className={cn("mx-auto h-5 w-5", tierTone)} aria-hidden />
        ) : row.rank <= 3 ? (
          <Medal className={cn("mx-auto h-5 w-5", tierTone)} aria-hidden />
        ) : (
          <span className="text-muted-foreground font-mono text-sm tabular-nums">
            {row.rank}
          </span>
        )}
      </div>

      {/* Name */}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-sm font-medium",
            isCurrentUser && "text-foreground",
          )}
        >
          {row.display_name?.trim() || "Anonymous"}
          {isCurrentUser && (
            <span className="text-muted-foreground ml-2 text-xs font-normal">(you)</span>
          )}
        </p>
        <p className="text-muted-foreground text-[11px]">
          {row.predictions} decisive {row.predictions === 1 ? "bet" : "bets"}
        </p>
      </div>

      {/* Accuracy */}
      <div className="hidden text-right sm:block">
        <p className="font-mono text-sm font-semibold tabular-nums">
          {row.accuracy.toFixed(0)}%
        </p>
        <p className="text-muted-foreground text-[11px]">accuracy</p>
      </div>

      {/* Net credits */}
      <div className="text-right">
        <p
          className={cn(
            "font-mono text-sm font-semibold tabular-nums",
            row.credits_won > 0
              ? "text-emerald-500"
              : row.credits_won < 0
                ? "text-rose-500"
                : "text-muted-foreground",
          )}
        >
          {row.credits_won > 0 ? "+" : ""}
          {row.credits_won}
        </p>
        <p className="text-muted-foreground text-[11px]">credits</p>
      </div>
    </li>
  );
}
