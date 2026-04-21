import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import { visualizer } from "rollup-plugin-visualizer";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // Hardcoded Supabase fallbacks (per project memory: tech/environment-config).
  // Ensures builds like `vite build --mode development` succeed without a mode-specific .env file.
  const FALLBACKS: Record<string, string> = {
    VITE_SUPABASE_URL: "https://vdfdqtzndsrrlutbprtk.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkZmRxdHpuZHNycmx1dGJwcnRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDg4MTIsImV4cCI6MjA4ODYyNDgxMn0.qctx-QWA-HVSclpOKYp_j-4IxsbfrZF8NQmQXLYZOOQ",
    VITE_SUPABASE_PROJECT_ID: "vdfdqtzndsrrlutbprtk",
  };
  for (const [key, fallback] of Object.entries(FALLBACKS)) {
    if (!env[key]) env[key] = fallback;
    if (!process.env[key]) process.env[key] = env[key];
  }

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [
      react(),
      mode === "development" && componentTagger(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.png"],
        manifest: {
          name: "Scribe Studio",
          short_name: "Scribe Studio",
          description: "AI toolkit (Transcribe, Speak, OCR, Research)",
          theme_color: "#ffffff",
          background_color: "#ffffff",
          display: "standalone",
          icons: [
            {
              src: "/favicon.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "/favicon.png",
              sizes: "512x512",
              type: "image/png",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff2}"],
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
