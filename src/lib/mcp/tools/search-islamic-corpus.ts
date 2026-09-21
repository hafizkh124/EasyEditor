import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { queryTerms, searchCorpus, sourceTypesFor, type CorpusDomain } from "../corpusSearch";

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
    "Keyword search over Easy Editor's local corpus: the Quran with translations, the canonical hadith collections, fatwa and ingested classical books. Lexical (whole-word substring) matching only — not semantic, and it does not include the live Turath.io library. Rows are ranked by how many of the query's words they contain.",
  inputSchema: {
    query: z.string().min(1).describe("Search query in Arabic or Urdu"),
    domain: z.enum(["all", "quran", "hadith", "fatwa", "classical"]).default("all").optional()
      .describe("Restrict to one kind of source (default: all)"),
    limit: z.number().int().min(1).max(20).default(10).optional().describe("Maximum number of passages to return"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, domain = "all", limit = 10 }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);

    const { rows, error } = await searchCorpus(supabase, {
      terms: queryTerms(query),
      sourceTypes: sourceTypesFor(domain as CorpusDomain),
      limit,
    });

    if (error) {
      return { content: [{ type: "text", text: `Search error: ${error}` }], isError: true };
    }

    const passages = rows.map((row) => ({
      id: row.id,
      domain: row.domain,
      source_type: row.source_type,
      content: row.content,
      content_ar: row.content_ar,
      citation: row.citation_ref,
      source_url: row.source_url,
      match_score: row.match_score,
    }));

    return {
      content: [{ type: "text", text: JSON.stringify(passages, null, 2) }],
      structuredContent: {
        query,
        domain,
        count: passages.length,
        passages,
      },
    };
  },
});
