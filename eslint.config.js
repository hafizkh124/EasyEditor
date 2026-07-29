import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "supabase/functions/**", "tools/**", "scripts/**"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // ── Backend adapter boundary (SPEC-M5 FR-1.3, NFR-7) ──────────────────────
  //
  // The workspace layer must reach its store through getBackend(), never
  // through the Supabase client directly. Otherwise the desktop build — which
  // has no Supabase at all — breaks at runtime, one forgotten import at a time.
  //
  // This rule is the enforcement. A boundary that lives only in a document
  // rots within weeks; this one fails the build.
  //
  // Out of scope by design (cloud-only surfaces, absent in the desktop app):
  // auth, Admin, Pricing, Profile, Billing, receipts, Referrals, notifications,
  // OCR, and the shared scholarly_documents search.
  {
    files: [
      "src/core/workspace/**/*.{ts,tsx}",
      "src/lib/audio/**/*.{ts,tsx}",
      "src/lib/corpus/**/*.{ts,tsx}",
      "src/lib/editor/**/*.{ts,tsx}",
      "src/lib/graph/**/*.{ts,tsx}",
      "src/lib/recipes/**/*.{ts,tsx}",
      "src/lib/tasks/**/*.{ts,tsx}",
    ],
    ignores: [
      // Legacy migration of book_projects/book_chapters/book_sections into
      // projects/documents. Those tables exist only in the hosted database, so
      // there is nothing for a local backend to migrate.
      "src/core/workspace/bookSectionMigration.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/integrations/supabase/client",
              message:
                "Workspace code must go through getBackend() or callEdgeFunction() — see src/core/ai/aiAdapter.ts and src/core/backend/. Direct Supabase access here breaks the desktop build.",
            },
          ],
        },
      ],
    },
  },
);
