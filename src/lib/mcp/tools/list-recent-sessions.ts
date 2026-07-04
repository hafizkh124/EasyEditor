import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export default defineTool({
  name: "list_recent_sessions",
  title: "List recent Easy Editor sessions",
  description:
    "List the signed-in user's most recent Easy Editor sessions (Transcribe, OCR, Speak, Editor, etc.), newest first. Optionally filter by section.",
  inputSchema: {
    section: z
      .string()
      .optional()
      .describe("Filter by section (e.g. 'transcribe', 'ocr', 'speak', 'editor', 'translate')."),
    limit: z.number().int().min(1).max(50).default(10),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ section, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    let query = supabaseForUser(ctx)
      .from("user_sessions")
      .select("id, section, title, created_at, updated_at")
      .eq("user_id", ctx.getUserId())
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (section) query = query.eq("section", section);
    const { data, error } = await query;
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { sessions: data ?? [] },
    };
  },
});
