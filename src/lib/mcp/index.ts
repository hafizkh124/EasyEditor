import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listRecentSessionsTool from "./tools/list-recent-sessions";
import listResearchSessionsTool from "./tools/list-research-sessions";
import tokenBalanceTool from "./tools/token-balance";

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
  version: "0.1.0",
  instructions:
    "Tools for Al-Ulama Easy Editor. Use `whoami` to confirm the signed-in user, `list_recent_sessions` to browse recent Transcribe/OCR/Speak/Editor/Translate sessions, `list_research_sessions` for Islamic Research chats, and `token_balance` to check the user's token wallet.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    whoamiTool,
    listRecentSessionsTool,
    listResearchSessionsTool,
    tokenBalanceTool,
  ],
});
