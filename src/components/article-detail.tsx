import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InsightArticle } from "@/types/insight";

type Props = {
  article: InsightArticle;
};

/**
 * Full article block for the stock detail page.
 * Surfaces every Llama-generated field we have, plus the source link.
 * Designed for skimmability: headline → summary → influence → meta.
 */
export function ArticleDetail({ article }: Props) {
  const sentimentTone =
    article.sentiment == null
      ? "neutral"
      : article.sentiment > 0.1
        ? "bullish"
        : article.sentiment < -0.1
          ? "bearish"
          : "neutral";

  return (
    <article className="border-border/60 bg-card/30 hover:bg-card/50 space-y-3 rounded-xl border p-5 transition-colors">
      <header className="space-y-1">
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground/90 group block"
        >
          <h3 className="text-base leading-snug font-semibold underline-offset-2 group-hover:underline">
            {article.headline}
          </h3>
        </a>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
          <span>{article.source}</span>
          {article.published_at && <span>· {formatDate(article.published_at)}</span>}
          {article.sentiment != null && (
            <span className={cn("font-mono", sentimentClass(sentimentTone))}>
              · {article.sentiment > 0 ? "+" : ""}
              {article.sentiment.toFixed(2)}
            </span>
          )}
        </div>
      </header>

      {article.tldr && (
        <p className="text-foreground/90 text-sm leading-snug">
          <span className="text-muted-foreground">&ldquo;</span>
          {article.tldr}
          <span className="text-muted-foreground">&rdquo;</span>
        </p>
      )}

      {article.summary && (
        <p className="text-muted-foreground text-sm leading-relaxed">{article.summary}</p>
      )}

      {article.signal_influence && (
        <p
          className={cn(
            "rounded-md px-3 py-2 text-xs leading-snug font-medium",
            influenceTone(article.signal_influence),
          )}
        >
          <span className="opacity-60">Signal impact → </span>
          {article.signal_influence}
        </p>
      )}

      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-foreground/80 hover:text-foreground inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
      >
        Read full article <ExternalLink className="h-3 w-3" aria-hidden />
      </a>
    </article>
  );
}

function sentimentClass(tone: "bullish" | "bearish" | "neutral"): string {
  if (tone === "bullish") return "text-emerald-500";
  if (tone === "bearish") return "text-red-500";
  return "text-muted-foreground";
}

function influenceTone(influence: string): string {
  const lower = influence.toLowerCase();
  if (lower.startsWith("bullish")) {
    return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  }
  if (lower.startsWith("bearish")) {
    return "bg-red-500/10 text-red-600 dark:text-red-400";
  }
  return "bg-muted text-muted-foreground";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffH = (now.getTime() - d.getTime()) / 3600000;
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  if (diffH < 24 * 7) return `${Math.floor(diffH / 24)}d ago`;
  return d.toLocaleDateString();
}
