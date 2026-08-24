import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

/**
 * Lets a Supabase Edge Function's `index.ts` be imported by a test.
 *
 * Those files are written for Deno, so they import `npm:zod@^3.25.76`,
 * `https://esm.sh/@supabase/supabase-js@2`, and friends — specifiers Node and
 * Vite cannot resolve. Rather than maintaining an alias entry per version
 * string (there are nine distinct ones, and they drift), this strips the
 * `npm:` / esm.sh prefix and the pinned version and resolves the bare package
 * from node_modules, where the same libraries are already installed.
 *
 * `https://deno.land/std@…/http/server.ts` has no npm equivalent and maps to a
 * local stub instead — see src/test/stubs/denoStdServer.ts.
 */
function denoSpecifiers(): Plugin {
  const STD_SERVER = /^https:\/\/deno\.land\/std@[\d.]+\/http\/server\.ts$/;
  // `npm:@scope/name@version/sub` → `@scope/name/sub`; `npm:name@version` → `name`.
  const VERSIONED = /^(@[^/]+\/[^@/]+|[^@/][^@/]*)@[^/]*(\/.*)?$/;

  // Packages the Supabase platform resolves at deploy time that have no npm
  // counterpart installed here, so they cannot be resolved — only stubbed.
  const STUBS: Record<string, string> = {
    "@lovable.dev/email-js": "./src/test/stubs/lovableEmailJs.ts",
  };

  return {
    name: "deno-specifiers",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (STD_SERVER.test(source)) {
        return path.resolve(__dirname, "./src/test/stubs/denoStdServer.ts");
      }

      let bare: string | null = null;
      if (source.startsWith("npm:")) bare = source.slice("npm:".length);
      else if (source.startsWith("https://esm.sh/")) bare = source.slice("https://esm.sh/".length);
      if (!bare) return null;

      const stripped = bare.replace(VERSIONED, "$1$2");
      if (STUBS[stripped]) return path.resolve(__dirname, STUBS[stripped]);

      const resolved = await this.resolve(stripped, importer, { ...options, skipSelf: true });
      if (resolved) return resolved;
      // Surface the real problem rather than a confusing "failed to resolve" on
      // the original URL — the fix is almost always `npm i` of the bare name.
      throw new Error(
        `deno-specifiers: could not resolve "${source}" as "${stripped}". ` +
          `Install it, or add a stub under src/test/stubs/.`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), denoSpecifiers()],
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
    // jsdom costs roughly 30s of construction per worker and most of this suite
    // never touches the DOM, so pure-logic files opt out with a
    // `// @vitest-environment node` docblock. jsdom stays the default because it
    // is the safe one: a new component test that forgets the annotation works,
    // whereas the inverse would fail confusingly. src/test/setup.ts guards its
    // window patching so it survives both environments.
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "./coverage",
      // Measure the code we actually own. Without `all`, v8 reports only files
      // some test already imported, which flatters the number by exactly the
      // amount we care about.
      all: true,
      include: [
        "src/**/*.{ts,tsx}",
        "electron/**/*.ts",
        "shared/**/*.ts",
        "supabase/functions/**/*.ts",
      ],
      exclude: [
        "src/components/ui/**",        // 36 vendored shadcn primitives
        "src/locales/**",
        "src/test/**",
        "**/__tests__/**",
        "**/*.d.ts",
        "**/mirror/**",                // generated copy of shared/
        "src/main.tsx",
        "src/vite-env.d.ts",
      ],
      // Per-path floors, not one global percentage: a single global number
      // would be satisfied by the 200+ component files and would say nothing
      // about the paths that move money or gate security. Raise these only
      // after the suite already clears the new value.
      thresholds: {
        "electron/lib/urlAllowlist.ts": { lines: 100, functions: 100, branches: 100 },
      },
    },
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
      // `virtual:pwa-register` is synthesised by vite-plugin-pwa, which this
      // config does not load — without an alias any test that reaches
      // src/pwa/registerSW.ts fails to resolve the import at transform time.
      "virtual:pwa-register": path.resolve(__dirname, "./src/test/stubs/pwaRegisterStub.ts"),
    },
  },
});
