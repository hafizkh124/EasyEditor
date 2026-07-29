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
  // This rule is the enforcement, and it is a DENYLIST, not an allowlist: it
  // covers every file under src/, and the `ignores` list below is the
  // complete, named set of exceptions as of Gate 3. FR-1.3's actual text is
  // "no file outside src/core/backend/" — an allowlist scoped to a handful of
  // directories (the original M5.0 shape of this rule) left every other
  // directory unchecked, so a brand-new file anywhere else could import
  // Supabase directly and lint would stay green. Flip it around: everything
  // is covered by default, and each exception has to be named and justified
  // here, so a genuinely new leak has nowhere to hide.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      // ── The adapter's own cloud implementation — this IS its job ──────────
      "src/core/backend/**",
      "src/core/ai/aiAdapter.ts",
      "src/core/voice/cloudEngines.ts",
      "src/integrations/supabase/**",

      // ── Cloud-only surfaces, absent in the desktop app (FR-1.2/FR-2.5): ───
      // ── auth ────────────────────────────────────────────────────────────
      "src/contexts/AuthContext.tsx",
      "src/lib/supabaseOauth.ts",
      "src/lib/userSessions.ts",
      "src/hooks/useSessionHistory.ts",
      "src/pages/Login.tsx",
      "src/pages/Signup.tsx",
      "src/pages/ForgotPassword.tsx",
      "src/pages/ResetPassword.tsx",
      "src/pages/OAuthConsent.tsx",
      // ── admin ───────────────────────────────────────────────────────────
      "src/pages/Admin.tsx",
      "src/lib/admin/corpus-rpc.ts",
      "src/hooks/useAdminUsers.ts",
      "src/hooks/useAdminPayments.ts",
      "src/hooks/useApproval.ts",
      "src/components/admin/UpgradeRequests.tsx",
      "src/pages/AccountRejected.tsx",
      "src/pages/PendingApproval.tsx",
      // ── pricing / billing ───────────────────────────────────────────────
      "src/pages/Pricing.tsx",
      "src/hooks/useDisplayCurrency.ts",
      "src/components/UpsellModal.tsx",
      // ── profile ─────────────────────────────────────────────────────────
      "src/pages/Profile.tsx",
      "src/pages/CompleteProfile.tsx",
      "src/pages/Settings.tsx",
      "src/pages/Dashboard.tsx",
      "src/components/ContactInfoCard.tsx",
      "src/lib/activityLog.ts",
      // ── referrals ───────────────────────────────────────────────────────
      "src/components/ReferralCard.tsx",
      // ── notifications ───────────────────────────────────────────────────
      "src/contexts/NotificationContext.tsx",
      // ── OCR ─────────────────────────────────────────────────────────────
      "src/pages/OCR.tsx",
      // ── shared scholarly research (research_sources/research_sessions — not
      //    WorkspaceBackend tables; FR-1.2 lists projects/documents/
      //    library_items/... only) ─────────────────────────────────────────
      "src/hooks/useResearchSources.ts",
      "src/lib/research/persistence.ts",
      "src/lib/research/streamers.ts",
      // ── translation memory (glossary lookups against a hosted-only table) ─
      "src/lib/translationMemory.ts",
      // ── subscription/billing context, used app-wide for gating ────────────
      "src/contexts/SubscriptionContext.tsx",
      // ── Extract: FR-1.2's table names this exact call site "کچھ نہ کریں —
      //    cloud-only، دائرے سے باہر" (extract-translations stays cloud-only
      //    by explicit decision, not oversight) ──────────────────────────────
      "src/components/extract/ExtractPanel.tsx",
      // ── Voice cloud storage (ElevenLabs clone-sample upload) — the same
      //    kind of cloud-tier call as core/voice/cloudEngines.ts, just not
      //    yet moved into it ─────────────────────────────────────────────────
      "src/pages/Speak.tsx",
      // ── Transcribe: calls functions.invoke("transcribe") directly instead
      //    of through callEdgeFunction() — same class of leak FR-1.2 flags for
      //    BookEditorView's refine-text call. Local mode's real STT path is
      //    core/voice's whisper engine (Gate 4), not this file. ─────────────
      "src/pages/Transcribe.tsx",
      // ── Legacy migration of book_projects/book_chapters/book_sections and
      //    translation_projects/translation_chunks into projects/documents.
      //    Those tables exist only in the hosted database, so a local
      //    backend has nothing to migrate — see bookSectionMigration.ts. ────
      "src/core/workspace/bookSectionMigration.ts",
      // KNOWN PENDING LEAK (FR-1.2's own table, not yet fixed): these insert
      // into book_sections/translation_chunks directly instead of going
      // through bookSectionMigration's service layer.
      "src/pages/BookWorkspace.tsx",
      "src/pages/TranslationWorkspace.tsx",

      // Tests exercise the real Supabase client/mocks directly and are never
      // bundled into the desktop build.
      "src/test/**",
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
          patterns: [
            {
              group: ["**/integrations/supabase/client", "**/integrations/supabase/client.ts"],
              message:
                "Workspace code must go through getBackend() or callEdgeFunction() — relative imports of the Supabase client are blocked the same as the @/ alias.",
            },
          ],
        },
      ],
    },
  },
);
