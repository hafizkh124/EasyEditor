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
  name: "search_islamic_corpus",
  title: "Search Islamic Corpus",
  description:
    "Search across authenticated Islamic sources: Quran with translations, 17 canonical Hadith collections, and classical literature.",
  inputSchema: {
    query: z.string().min(1).describe("Search query in Arabic or Urdu"),
    domain: z.enum(["all", "quran", "hadith", "classical", "fatwa"]).default("all").optional().describe("Source domain to search"),
    limit: z.number().int().min(1).max(20).default(10).optional().describe("Maximum number of passages to return"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ query, limit = 10 }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);

    const patterns = [query];
    const { data: dbRows, error } = await supabase.rpc("search_documents_smart", {
      patterns,
      sub_patterns: [],
      max_results: limit,
    });

    if (error) {
      return { content: [{ type: "text", text: `Search error: ${error.message}` }], isError: true };
    }

    const passages = ((dbRows as any[]) || []).map((row: any) => ({
      id: row.id,
      domain: row.domain,
      content: row.content,
      content_ar: row.content_ar,
      citation: row.citation_ref,
      source_url: row.source_url,
    }));

    return {
      content: [{ type: "text", text: JSON.stringify(passages, null, 2) }],
      structuredContent: {
        query,
        count: passages.length,
        passages,
      },
    };
  },
});
