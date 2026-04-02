import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

const FALLBACK_SUPABASE_PROJECT_ID = "vdfdqtzndsrrlutbprtk";
const FALLBACK_SUPABASE_URL = `https://${FALLBACK_SUPABASE_PROJECT_ID}.supabase.co`;
const FALLBACK_SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkZmRxdHpuZHNycmx1dGJwcnRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDg4MTIsImV4cCI6MjA4ODYyNDgxMn0.qctx-QWA-HVSclpOKYp_j-4IxsbfrZF8NQmQXLYZOOQ";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? FALLBACK_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    FALLBACK_SUPABASE_PUBLISHABLE_KEY;
  const supabaseProjectId = process.env.VITE_SUPABASE_PROJECT_ID ?? FALLBACK_SUPABASE_PROJECT_ID;

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(supabasePublishableKey),
      "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(supabaseProjectId),
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
