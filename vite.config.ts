import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "node:fs";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import { visualizer } from "rollup-plugin-visualizer";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isDesktop = mode === "desktop" || process.env.VITE_DESKTOP === "true";

  // Hardcoded fallbacks so production builds never fail when .env is missing
  // (per project memory: inject Supabase fallback keys via Vite `define`).
  const FALLBACKS: Record<string, string> = {
    VITE_SUPABASE_URL: "https://vdfdqtzndsrrlutbprtk.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkZmRxdHpuZHNycmx1dGJwcnRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDg4MTIsImV4cCI6MjA4ODYyNDgxMn0.qctx-QWA-HVSclpOKYp_j-4IxsbfrZF8NQmQXLYZOOQ",
    VITE_SUPABASE_PROJECT_ID: "vdfdqtzndsrrlutbprtk",
  };
  const resolved: Record<string, string> = {};
  for (const k of Object.keys(FALLBACKS)) {
    resolved[k] = env[k] || FALLBACKS[k];
  }

  // vite-plugin-electron runs its own Vite build for the main/preload entries and
  // does not inherit the renderer config below, so the path aliases have to be
  // repeated here — without them `@/...` imports reached from electron/ fail to
  // resolve and the desktop build dies.
  //
  // The `define` map has to be repeated for the same reason: electron/main.ts
  // needs the Supabase origin to put in the CSP's connect-src, and without this
  // it would either read an undefined env var or carry a second hardcoded copy
  // of the URL that could drift from the renderer's.
  const electronDefine = {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(resolved.VITE_SUPABASE_URL),
    "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(resolved.VITE_SUPABASE_PROJECT_ID),
  };

  // Root package.json has "type": "module", so without this, rollup emits
  // main.js/preload.js as ESM (`import`/`export`). Electron's *sandboxed*
  // preload loader (webPreferences.sandbox: true, set in electron/main.ts)
  // cannot execute ESM at all — it throws "Cannot use import statement
  // outside a module" and silently drops the preload script, which is why
  // window.electronAPI ends up undefined in a packaged build: every feature
  // that goes through it (workspace DB, desktop OAuth, voice, Shamela, …)
  // fails as if running outside Electron, while the renderer itself loads
  // fine and looks like nothing is wrong. Forcing CJS output plus a
  // dist-electron/package.json override (write-cjs-package-json below) is
  // the fix — confirmed by loading the compiled preload.js directly with
  // this override absent (throws) and present (window.electronAPI exposed).
  const writeCjsPackageJson: Plugin = {
    name: "write-cjs-package-json",
    closeBundle() {
      const outDir = path.resolve(__dirname, "dist-electron");
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "commonjs" }) + "\n");
    },
  };

  // See the `build.lib` comment below: undo mergeConfig's concat of the
  // plugin's default `formats: ["es"]` onto our `["cjs"]`. Runs after the merge.
  const forceCjsElectronLib: Plugin = {
    name: "electron-force-cjs-lib",
    config(cfg) {
      const lib = cfg.build?.lib;
      if (lib && typeof lib === "object") lib.formats = ["cjs"];
    },
  };

  const electronViteConfig = {
    define: electronDefine,
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "~shared": path.resolve(__dirname, "./shared"),
      },
    },
    plugins: [writeCjsPackageJson, forceCjsElectronLib],
    build: {
      // The electron main/preload bundles MUST be CommonJS: Electron's
      // sandboxed preload loader cannot execute ESM `import` (it throws
      // "Cannot use import statement outside a module", which leaves
      // `window.electronAPI` undefined and every desktop feature broken).
      //
      // But a `"type": "module"` root package.json makes vite-plugin-electron
      // default `build.lib.formats` to `["es"]`, and Vite's `mergeConfig`
      // CONCATENATES arrays — so this `["cjs"]` becomes `["es", "cjs"]` and
      // both bundles get built into the same `[name].js`. `forceCjsElectronLib`
      // (a plugin `config` hook, which runs AFTER the merge) puts it back to
      // exactly `["cjs"]`. `writeCjsPackageJson` then marks `dist-electron/`
      // as CommonJS so Node parses the `.js` output as CJS.
      //
      // Cast: Vite's `LibraryOptions` type demands `entry` up front, but
      // vite-plugin-electron injects the real entry at runtime.
      lib: {
        formats: ["cjs"],
      } as import("vite").LibraryOptions,
      rollupOptions: {
        // Native and native-adjacent packages must stay out of the bundle:
        // better-sqlite3 and the whisper addon load .node binaries by path at
        // runtime, and msedge-tts pulls in ws's optional native extras.
        // electron-updater is CommonJS and reads app-update.yml from the packaged
        // resources at runtime, so it has to stay a real require() rather than be
        // inlined into main.js.
        // pdfjs-dist (M13, documentText.ts) is ESM and loads its fake worker by
        // relative path — bundling breaks that, so it stays a native import().
        external: ["better-sqlite3", "sqlite-vec", "@kutalia/whisper-node-addon", "msedge-tts", "electron-updater", /^pdfjs-dist(\/.*)?$/],
      },
    },
  };

  return {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(resolved.VITE_SUPABASE_URL),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(resolved.VITE_SUPABASE_PUBLISHABLE_KEY),
      "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(resolved.VITE_SUPABASE_PROJECT_ID),
      "import.meta.env.VITE_DESKTOP": JSON.stringify(isDesktop ? "true" : "false"),
      // Local Whisper/Piper/edge-tts (electron/voice/*) have been complete since
      // M5.5, but this flag was never set anywhere — not in .env.example, not
      // here — so Transcribe and Speak stayed hidden on desktop even though
      // their offline engines worked. Default it on for desktop builds; an
      // explicit .env value still wins, so it remains a kill switch.
      "import.meta.env.VITE_LOCAL_VOICE": JSON.stringify(
        env.VITE_LOCAL_VOICE || (isDesktop ? "true" : "false"),
      ),
      // SPEC-M8 Layer 6 / ADR-0016 — the agentic Agent tab. Off by default
      // (the agent core ships headless in P8a); an explicit .env value opts
      // in. Gated in the UI by isDesktop() AND this flag.
      "import.meta.env.VITE_AGENT_MODE": JSON.stringify(env.VITE_AGENT_MODE || "false"),
    },
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [
      react(),
      isDesktop && electron([
        {
          entry: "electron/main.ts",
          vite: electronViteConfig,
        },
        {
          entry: "electron/preload.ts",
          vite: electronViteConfig,
          onstart(options) {
            options.reload();
          },
        },
      ]),
      isDesktop && renderer(),
      // mcpPlugin() intentionally omitted: its only job is to regenerate
      // supabase/functions/mcp/index.ts at build time, and on Windows it writes
      // `import mcp from "npm:E:\\EasyEditor\\src\\lib\\mcp\\index.ts"` — an
      // absolute local path that cannot deploy to Deno. It overwrote the working
      // bundle on every build. The checked-in function is the source of truth;
      // regenerate it from a Lovable cloud build if the MCP tools change.
      mode === "development" && componentTagger(),
      VitePWA({
        // "prompt" (not autoUpdate): the SW must NOT skipWaiting/clientsClaim
        // on its own, because src/pwa/registerSW.ts already implements a
        // manual "new version available" toast (onNeedRefresh) that only
        // reloads when the user clicks it. With autoUpdate, the SW activates
        // and force-reloads every open tab as soon as it notices a new
        // deploy — including mid-stream on the Research page, which is what
        // was silently wiping in-progress answers.
        registerType: "prompt",
        includeAssets: ["favicon.png"],
        manifest: {
          name: "Easy Editor",
          short_name: "Easy Editor",
          description: "AI toolkit (Transcribe, Speak, OCR, Research)",
          // Matches index.html's own light-mode <meta name="theme-color">
          // (#0d9488) instead of a plain white that clashed with it — a
          // manifest has one static theme_color, no prefers-color-scheme.
          theme_color: "#0d9488",
          // Matches --background's light value (0 0% 96%, index.css) — the
          // splash-screen background an install shows before the app paints.
          background_color: "#f5f5f5",
          display: "standalone",
          // start_url/scope/id: M10 Phase 2.4. "/" for all three — matches
          // what "/" actually does on web today (Landing; DesktopToWorkspace
          // only redirects the Electron build), so installing does not
          // silently change what a first launch shows.
          start_url: "/",
          scope: "/",
          id: "/",
          // A text-editing tool needs both orientations on a tablet — "any"
          // leaves rotation to the OS instead of locking one.
          orientation: "any",
          // Matches index.html's <html lang="en"> and getStoredLanguage()'s
          // own default for a first-time visitor with no saved preference or
          // /ur, /ar URL prefix (src/lib/i18n.ts) — the manifest's lang/dir
          // is one static pair, so it follows the same default the app itself
          // falls back to, not the RTL languages some users will switch to.
          lang: "en",
          dir: "ltr",
          shortcuts: [
            {
              name: "نئی تحقیق",
              short_name: "تحقیق",
              url: "/workspace?panel=research",
              icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
            },
            {
              name: "میرے پراجیکٹس",
              short_name: "پراجیکٹس",
              url: "/dashboard",
              icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
            },
          ],
          icons: [
            {
              src: "/icon-192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "/icon-512.png",
              sizes: "512x512",
              type: "image/png",
            },
            {
              src: "/icon-192-maskable.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "maskable",
            },
            {
              src: "/icon-512-maskable.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff2}"],
          // Precaching is an up-front download for every install and every
          // update, so it must only hold what the app actually renders.
          // og-image.png exists solely for the <meta og:image> tag, which
          // social crawlers fetch from the absolute URL — the app's own hero
          // uses og-image.webp (54 kB). safepay_order_receipt.png is not
          // referenced anywhere in src/ or index.html. Together they were
          // 2.26 MB of the 5.38 MB precache: 42%, downloaded by every mobile
          // user, for two images the app never shows.
          globIgnores: [
            "og-image.png",
            "safepay_order_receipt.png",
            "**/*noto-nastaliq-urdu*.woff2",
            "**/*amiri-*.woff2",
            "**/*vazirmatn-*.woff2",
          ],
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/~oauth(?:\/|$)/, /^\/\.lovable(?:\/|$)/],
          runtimeCaching: [
            {
              urlPattern: /\/assets\/.*\.woff2$/i,
              handler: "CacheFirst",
              options: {
                cacheName: "self-hosted-fonts",
                expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
      visualizer({
        filename: "stats.html",
        gzipSize: true,
        brotliSize: true,
      }),
    ].filter(Boolean),
    build: {
      chunkSizeWarningLimit: 250, // NFR-9: Main bundle < 250 KB gzip (though vite uses uncompressed size for warning, we'll set it low to enforce budget)
      rollupOptions: {
        output: {
          // Only genuinely shared dependencies get a named chunk. Everything
          // else returns undefined so Rollup can leave it in whichever route
          // chunk imports it — that is what keeps a one-page dependency off
          // the other pages. A blanket `return "vendor"` for node_modules
          // defeats this: it collapses every library into a single chunk the
          // entry must load up front, so /ocr's pdfjs (136 kB gzip on its
          // own) was being shipped to every visitor of the landing page.
          manualChunks(id) {
            // Rollup's CommonJS interop helpers are virtual modules that live
            // outside node_modules. Left unassigned they get parked in
            // whichever chunk happens to need them first (the editor chunk),
            // and react-core — which also needs them — then imports from it.
            // That cycle makes React's namespace undefined while the editor
            // chunk is still initialising ("Cannot read properties of
            // undefined (reading 'useState')"). Pin them next to React.
            if (id.includes("commonjsHelpers") || id.includes("commonjs-dynamic-modules") || id.startsWith("\0")) {
              return "react-core";
            }
            if (!id.includes("node_modules")) return;

            // CJS packages React itself pulls in must share React's chunk,
            // otherwise the same cycle reappears through their interop.
            if (/node_modules\/use-sync-external-store/.test(id)) return "react-core";


            const after = id.split("node_modules/").pop() ?? "";
            const segments = after.split("/");
            const pkg = after.startsWith("@")
              ? `${segments[0]}/${segments[1]}`
              : segments[0];

            // Needed to render any route at all, so one long-lived cached
            // chunk beats duplicating them into every route chunk.
            if (/^(react|react-dom|scheduler)$/.test(pkg)) return "react-core";
            if (pkg === "react-router" || pkg === "react-router-dom" || pkg === "@remix-run/router") {
              return "react-core";
            }

            // Auth runs before the first paint on every route.
            if (pkg.startsWith("@supabase/")) return "supabase";

            // ~90 kB gzip of editor engine that only the workspace/editor
            // routes touch. Shared between them, absent everywhere else.
            if (
              pkg.startsWith("@tiptap/") ||
              pkg.startsWith("prosemirror-") ||
              pkg === "tiptap-track-changes" ||
              pkg === "linkifyjs" ||
              pkg === "orderedmap" ||
              pkg === "rope-sequence" ||
              pkg === "w3c-keyname"
            ) {
              return "editor";
            }

            return undefined;
          }
        }
      }
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "~shared": path.resolve(__dirname, "./shared"),
      },
    },
  };
});
