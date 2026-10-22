import { defineConfig } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

/**
 * Web/PWA smoke — the browser counterpart of the Electron launch spec
 * (playwright.config.ts). Run: `npm run test:e2e:web`.
 *
 *   E2E_BASE_URL   site to test            (default https://editor.alulama.org)
 *   E2E_EMAIL      \  a dedicated tester account — the signed-in specs are
 *   E2E_PASSWORD   /  skipped when these are not set
 *
 * Credentials are read from the environment or a git-ignored `.env.test`; they
 * are never hard-coded. Uses the installed Chrome (`channel: "chrome"`), so no
 * browser download is needed.
 */
if (existsSync(".env.test")) {
  for (const line of readFileSync(".env.test", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export default defineConfig({
  testDir: "./e2e/web",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://editor.alulama.org",
    channel: "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 900 } } },
    { name: "tablet-768", use: { viewport: { width: 768, height: 1024 } } },
    { name: "mobile-375", use: { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true } },
  ],
});
