import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
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
