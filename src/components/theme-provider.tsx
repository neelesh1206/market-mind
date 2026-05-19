"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * App-wide theme provider. Wraps `next-themes` so server components can stay clean.
 *
 * Settings:
 * - `attribute="class"` → toggles `<html class="dark">` (matches our globals.css `.dark` selector)
 * - `defaultTheme="system"` → respects OS preference on first visit
 * - `enableSystem` + `disableTransitionOnChange` → prevents janky color flashes on switch
 */
export function ThemeProvider(props: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props} />;
}
