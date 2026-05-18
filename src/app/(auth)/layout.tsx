import type { ReactNode } from "react";

/**
 * Layout for auth routes (login, etc.).
 * Intentionally bare — no top nav, no auth guard.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-6">
      {children}
    </div>
  );
}
