import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listRecentSessionsTool from "./tools/list-recent-sessions";
import listResearchSessionsTool from "./tools/list-research-sessions";
import tokenBalanceTool from "./tools/token-balance";
import searchIslamicCorpusTool from "./tools/search-islamic-corpus";
import takhrijHadithTool from "./tools/takhrij-hadith";
import calculateFaraidTool from "./tools/calculate-faraid";

// The OAuth issuer MUST be the direct Supabase host, built from the project ref
// (VITE_SUPABASE_PROJECT_ID is inlined by Vite at build time, so this stays
// import-safe — no runtime env read). Never use SUPABASE_URL here: on Lovable
// Cloud it is a `.lovable.cloud` proxy and mcp-js rejects any token whose
// configured issuer doesn't match the one the discovery document publishes.
const projectRef =
  import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "easy-editor-mcp",
  title: "Easy Editor",
  version: "0.2.0",
  instructions:
    "Tools for Al-Ulama Easy Editor. Use `whoami` to confirm the signed-in user, `list_recent_sessions` for user activity, `token_balance` for token wallet, `search_islamic_corpus` for multi-tier Islamic knowledge retrieval, `takhrij_hadith` for canonical narration cross-referencing, and `calculate_faraid` for deterministic Islamic inheritance computation.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    whoamiTool,
    listRecentSessionsTool,
    listResearchSessionsTool,
    tokenBalanceTool,
    searchIslamicCorpusTool,
    takhrijHadithTool,
    calculateFaraidTool,
  ],
});
