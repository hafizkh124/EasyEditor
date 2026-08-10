import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Vitest's 5s default is too tight for this suite. Several tests `await
    // import()` an Electron module inside the test body, so the first one pays
    // for transpiling it, and the page-level suites each mount a full React
    // tree. Both pass comfortably alone and were timing out only when the
    // whole suite ran in parallel — a scheduling artefact reported as a test
    // failure. A genuinely hung test still fails here, just 25s later.
    testTimeout: 30_000,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // vite.config.ts supplies these via `define`, but this config is separate and
    // does not inherit it. Without them `createClient()` throws at import time, so
    // every test file that transitively reaches the Supabase client fails to load
    // before a single test runs. Deliberately dummy values — tests must not talk
    // to a real project.
    env: {
      VITE_SUPABASE_URL: "https://test.supabase.invalid",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      VITE_SUPABASE_PROJECT_ID: "test-project",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "~shared": path.resolve(__dirname, "./shared"),
    },
  },
});
