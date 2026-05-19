import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Don't collide with Playwright e2e specs — they live in tests/e2e and
    // use a different runner.
    exclude: ["node_modules", "tests/e2e/**", ".next/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary"],
      // Only measure the code we actually own. Skip auto-generated /
      // boilerplate / config files.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
        "src/**/__tests__/**",
        "src/types/**",
        "src/components/ui/**", // shadcn-generated, low value to test
        "src/app/**/layout.tsx",
        "src/app/**/loading.tsx",
        "src/app/**/error.tsx",
        "src/app/**/not-found.tsx",
        "src/instrumentation*.ts",
      ],
      // Bumped from 0 → these floors after #132 landed real unit tests on
      // market-schedule (98%), verdict (100%), bonus (94%), bets, badges.
      // Current totals (May 2026): lines 10.79%, statements 10.8%, functions
      // 7.69%, branches 5.74%. Floors set just below so a routine drop
      // doesn't immediately red-CI; ratchet up as more helpers gain
      // coverage in follow-up tasks.
      thresholds: {
        lines: 10,
        functions: 7,
        branches: 5,
        statements: 10,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
