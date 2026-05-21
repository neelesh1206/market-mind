import { isValidElement } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  /** Lucide icon, OR a custom SVG node for richer illustrations. */
  icon?: LucideIcon | React.ReactNode;
  title: string;
  /** Supporting copy under the title. Plain string for simple cases; ReactNode for inline links. */
  description?: React.ReactNode;
  /** Optional primary action — internal link only (server-component-safe). */
  cta?: {
    label: string;
    href: string;
  };
  /** Visual tone. "muted" is the default subtle dashed border; "card" looks like a regular card. */
  variant?: "muted" | "card";
  className?: string;
};

/**
 * Shared empty-state shell. Centralized so the half-dozen empty states across
 * the app (no bets, no badges, no leaderboard qualifiers, etc.) stay visually
 * consistent and we can iterate on the look in one place.
 *
 * Server-component-safe — no client hooks, no event handlers. CTA is a Link
 * (internal nav only); pages that need a button-with-onClick should compose
 * around this rather than passing one in.
 */
export function EmptyState({
  icon,
  title,
  description,
  cta,
  variant = "muted",
  className,
}: Props) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 px-6 py-10 text-center",
        "rounded-xl border",
        variant === "muted" && "border-border/40 border-dashed bg-card/20",
        variant === "card" && "border-border/60 bg-card/40",
        className,
      )}
    >
      {icon && <EmptyIcon icon={icon} />}
      <div className="space-y-1">
        <p className="text-foreground text-sm font-semibold">{title}</p>
        {description && (
          <div className="text-muted-foreground mx-auto max-w-prose text-xs leading-relaxed">
            {description}
          </div>
        )}
      </div>
      {cta && (
        <Link
          href={cta.href}
          className="border-border bg-card hover:border-foreground/40 mt-1 inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors"
        >
          {cta.label} →
        </Link>
      )}
    </div>
  );
}

function EmptyIcon({ icon }: { icon: LucideIcon | React.ReactNode }) {
  // Two valid inputs:
  //   1. A LucideIcon component reference (e.g. `icon={Trophy}`) — we need
  //      to render it as `<Trophy />`.
  //   2. An already-rendered React element (e.g. `icon={<MyCustom />}`).
  //
  // Discriminate via `isValidElement` (NOT `typeof === "function"`):
  // Lucide icons in v0.5+ are `React.forwardRef` objects, which means
  // `typeof === "object"`, not `"function"`. The old check fell through
  // to the else branch and rendered the bare forwardRef object as a
  // child of <div>, which React's RSC serializer rejects with
  // "Functions are not valid as a child of Client Components."
  // `isValidElement` returns true ONLY for things React can render as-is;
  // forwardRef component references return false → we invoke them via
  // renderLucide.
  return (
    <div className="border-border/60 bg-card text-muted-foreground flex h-12 w-12 items-center justify-center rounded-full border">
      {isValidElement(icon) ? icon : renderLucide(icon as LucideIcon)}
    </div>
  );
}

function renderLucide(Icon: LucideIcon) {
  return <Icon className="h-5 w-5" aria-hidden />;
}
