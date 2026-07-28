import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import { visualizer } from "rollup-plugin-visualizer";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

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

  return {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(resolved.VITE_SUPABASE_URL),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(resolved.VITE_SUPABASE_PUBLISHABLE_KEY),
      "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(resolved.VITE_SUPABASE_PROJECT_ID),
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
          manualChunks(id) {
            if (id.includes('node_modules')) {
              return 'vendor';
            }
          }
        }
      }
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
