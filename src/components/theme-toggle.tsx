"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Moon, Sun, Monitor } from "lucide-react";

/**
 * Three-state theme toggle: light → dark → system → light.
 *
 * Renders nothing until mounted to avoid hydration mismatch (the server can't
 * know the user's resolved theme).
 */
export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The canonical "is this client-mounted yet?" pattern from next-themes.
  // We need `mounted` to gate the icon render — the server can't know the
  // resolved theme. The new react-hooks/set-state-in-effect rule flags this
  // as a potential render-loop, but the empty deps array guarantees it runs
  // exactly once.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    // Reserve space so the header layout doesn't jump on hydration.
    return <span aria-hidden className="inline-block h-8 w-8" />;
  }

  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const Icon = theme === "system" ? Monitor : resolvedTheme === "dark" ? Moon : Sun;
  const label =
    theme === "system"
      ? `System (${resolvedTheme}) — switch to light`
      : theme === "dark"
        ? "Dark — switch to system"
        : "Light — switch to dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next)}
      aria-label={label}
      title={label}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
