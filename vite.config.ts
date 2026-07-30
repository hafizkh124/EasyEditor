import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
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
  const electronViteConfig = {
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "~shared": path.resolve(__dirname, "./shared"),
      },
    },
    build: {
      rollupOptions: {
        // Native and native-adjacent packages must stay out of the bundle:
        // better-sqlite3 and the whisper addon load .node binaries by path at
        // runtime, and msedge-tts pulls in ws's optional native extras.
        external: ["better-sqlite3", "@kutalia/whisper-node-addon", "msedge-tts"],
      },
    },
  };

  return {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(resolved.VITE_SUPABASE_URL),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(resolved.VITE_SUPABASE_PUBLISHABLE_KEY),
      "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(resolved.VITE_SUPABASE_PROJECT_ID),
      "import.meta.env.VITE_DESKTOP": JSON.stringify(isDesktop ? "true" : "false"),
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
          theme_color: "#ffffff",
          background_color: "#ffffff",
          display: "standalone",
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
          globIgnores: ["og-image.png", "safepay_order_receipt.png"],
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/~oauth(?:\/|$)/, /^\/\.lovable(?:\/|$)/],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: "CacheFirst",
              options: {
                cacheName: "google-fonts-cache",
                expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
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
            if (!id.includes("node_modules")) return;

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
