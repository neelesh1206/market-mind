"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  /** Absolute HTTPS URL of the user's avatar. Null = always-render-initial. */
  src: string | null;
  /** Used for: (a) the rendered initial fallback, (b) the image alt text. */
  displayName: string;
  /** Tailwind size override. Defaults to `h-8 w-8` to match the header chip. */
  className?: string;
};

/**
 * Circular user avatar with a single-letter fallback.
 *
 * Renders an `<img>` if `src` is set AND the image hasn't 404'd on load.
 * On image error (Google's CDN occasionally rejects requests without the
 * right Referer, or the URL expires), we fail silently to the initial —
 * no broken-image icon, no layout shift.
 *
 * Uses a plain `<img>` rather than `next/image` deliberately:
 *   - Google's avatar URLs are already CDN-optimized + small (~96px)
 *   - Configuring `remotePatterns` for googleusercontent.com adds config
 *     surface for a single-purpose use
 *   - `next/image` lazy-loading offers no win on an above-the-fold avatar
 *
 * `referrerPolicy="no-referrer"` is load-bearing — Google's avatar CDN
 * 403s some requests that include a full Referer header when the
 * referring origin isn't on their allowlist. `no-referrer` avoids that.
 */
export function UserAvatar({ src, displayName, className }: Props) {
  const [failed, setFailed] = useState(false);
  const initial = (displayName?.[0] ?? "?").toUpperCase();
  const showImage = src && !failed;

  return (
    <span
      className={cn(
        "bg-secondary text-secondary-foreground inline-flex items-center justify-center overflow-hidden rounded-full text-sm font-medium",
        "h-8 w-8",
        className,
      )}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={displayName}
          referrerPolicy="no-referrer"
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden>{initial}</span>
      )}
    </span>
  );
}
