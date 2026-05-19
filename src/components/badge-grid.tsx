import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { BADGE_CATALOG, type BadgeMeta, type EarnedBadge } from "@/lib/badges";

type Props = {
  earned: EarnedBadge[];
};

/**
 * Renders every badge in the catalog. Earned ones full-color with the
 * earned-at date; unearned ones greyed out with a small lock + description
 * as a "how to earn this" hint.
 *
 * Server component — no interactivity needed.
 */
export function BadgeGrid({ earned }: Props) {
  const earnedByType = new Map(earned.map((b) => [b.type, b]));

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {BADGE_CATALOG.map((meta) => {
        const e = earnedByType.get(meta.type);
        return <BadgeTile key={meta.type} meta={meta} earned={e} />;
      })}
    </div>
  );
}

function BadgeTile({ meta, earned }: { meta: BadgeMeta; earned?: EarnedBadge }) {
  const isEarned = !!earned;

  return (
    <div
      className={cn(
        "relative flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-colors",
        isEarned
          ? tierClasses(meta.tier)
          : "border-border/40 bg-card/30 text-muted-foreground",
      )}
      title={
        isEarned
          ? `Earned ${formatDate(earned.earned_at)}`
          : `Locked · ${meta.description}`
      }
    >
      <div
        className={cn(
          "text-3xl leading-none",
          isEarned ? "opacity-100" : "opacity-30 grayscale",
        )}
        aria-hidden
      >
        {meta.emoji}
      </div>
      <div className="space-y-0.5">
        <p
          className={cn(
            "text-xs font-semibold tracking-tight",
            isEarned ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {meta.label}
        </p>
        <p className="text-muted-foreground text-[10px] leading-snug">
          {isEarned ? formatDate(earned.earned_at) : meta.description}
        </p>
      </div>
      {!isEarned && (
        <Lock className="text-muted-foreground absolute top-2 right-2 h-3 w-3" aria-hidden />
      )}
    </div>
  );
}

function tierClasses(tier: BadgeMeta["tier"]): string {
  switch (tier) {
    case "bronze":
      return "border-amber-700/40 bg-amber-700/10";
    case "silver":
      return "border-zinc-400/40 bg-zinc-400/10";
    case "gold":
      return "border-amber-400/40 bg-amber-400/10";
    case "platinum":
      return "border-cyan-300/40 bg-gradient-to-br from-cyan-400/15 to-violet-400/10";
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
}
