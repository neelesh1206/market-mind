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
      // Thresholds intentionally at 0 to start — measured coverage is
      // currently 0.06% (one test file on `cn`). #132 will land real unit
      // tests; bump these to 30/30/30/40 (lines/statements/functions/
      // branches) once that batch lands. The goal is to ratchet up over
      // time, not block the first commit.
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
