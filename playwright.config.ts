import { defineConfig } from "@playwright/test";

/**
 * Separate from vitest.config.ts on purpose — this drives the packaged-app
 * smoke test (TESTING-STRATEGY.md §5.5/§10 P3), which launches a real
 * Electron process rather than running in Node or jsdom. `npx playwright
 * test` picks this file up automatically by name.
 */
export default defineConfig({
  testDir: "./e2e",
  // The browser specs have their own config: playwright.web.config.ts.
  testIgnore: "**/web/**",
  timeout: 60_000,
  // Electron cold-starts one instance at a time in CI; there is exactly one
  // spec today, so parallelism buys nothing and only adds flakiness risk.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
});
