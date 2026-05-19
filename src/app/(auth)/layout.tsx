import type { ReactNode } from "react";

/**
 * Layout for auth routes. Subtle background gradient on a dark canvas
 * to differentiate the unauthenticated experience from the app.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen justify-center overflow-x-hidden px-6 py-12 sm:py-16">
      {/* Background — radial glow + subtle grid */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.18),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom,rgba(59,130,246,0.10),transparent_60%)]" />
      </div>

      {children}
    </div>
  );
}
