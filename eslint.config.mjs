import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated test/coverage output — third-party HTML/JS, never linted.
    "coverage/**",
    "htmlcov/**",
    "playwright-report/**",
    "test-results/**",
    // Cloudflare Worker has its own tsconfig + types (workers-types,
    // not next.js). Don't try to lint it with the Next ESLint preset.
    "workers/**",
  ]),
]);

export default eslintConfig;
