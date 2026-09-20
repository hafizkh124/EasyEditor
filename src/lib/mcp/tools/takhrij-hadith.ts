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

function takhrijTokens(text: string): Set<string> {
  const STOPWORDS = new Set([
    "حدثنا", "اخبرنا", "قال", "سمعت", "عن", "ان", "رسول", "الله", "صلى", "عليه", "وسلم",
    "النبي", "بن", "ابي", "ابن", "في", "من", "على", "الى", "ما", "لا", "انما", "كان",
  ]);
  const cleaned = text
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0649/g, "\u064A")
    .replace(/[^\u0621-\u064A\s]/g, " ");

  const tokens = cleaned.split(/\s+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return new Set(tokens);
}

export default defineTool({
  name: "takhrij_hadith",
  title: "Takhrij Hadith Cross-Reference",
  description:
    "Cross-reference and verify a Hadith across canonical collections by matching matn textual overlap.",
  inputSchema: {
    hadithText: z.string().min(3).describe("Hadith matn or phrase in Arabic to find cross-references for"),
    minOverlapRatio: z.number().min(0.2).max(1.0).default(0.4).optional().describe("Minimum token overlap ratio (default 0.4)"),
    limit: z.number().int().min(1).max(25).default(10).optional().describe("Max candidates to retrieve"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ hadithText, minOverlapRatio = 0.4, limit = 10 }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);

    const { data: rows, error } = await supabase.rpc("search_documents_smart", {
      patterns: [hadithText],
      sub_patterns: [],
      max_results: limit,
    });

    if (error) {
      return { content: [{ type: "text", text: `Retrieval error: ${error.message}` }], isError: true };
    }

    const hadithRows = ((rows as any[]) || []).filter((r: any) =>
      r.domain === "hadith" || r.domain === "easyquran-hadith" || r.domain === "hadith-json"
    );

    if (hadithRows.length === 0) {
      return {
        content: [{ type: "text", text: "No matching hadith found in canonical corpus." }],
        structuredContent: { matches: [] },
      };
    }

    const primary = hadithRows[0];
    const primaryTokens = takhrijTokens(primary.content_ar || primary.content || "");
    const matches: Array<{
      collection: string;
      hadith_number: string | number;
      chapter?: string;
      overlap_ratio: number;
      matn_snippet: string;
    }> = [];

    for (let i = 1; i < hadithRows.length; i++) {
      const cand = hadithRows[i];
      const candTokens = takhrijTokens(cand.content_ar || cand.content || "");
      if (primaryTokens.size < 3 || candTokens.size < 3) continue;

      let shared = 0;
      for (const w of candTokens) if (primaryTokens.has(w)) shared++;
      const ratio = shared / Math.min(primaryTokens.size, candTokens.size);

      if (ratio >= minOverlapRatio) {
        matches.push({
          collection: cand.citation_ref?.collection || cand.citation_ref?.book || "Hadith Book",
          hadith_number: cand.citation_ref?.hadith_number || "",
          chapter: cand.citation_ref?.chapter || cand.citation_ref?.bab || undefined,
          overlap_ratio: Number(ratio.toFixed(2)),
          matn_snippet: (cand.content_ar || cand.content || "").slice(0, 150),
        });
      }
    }

    matches.sort((a, b) => b.overlap_ratio - a.overlap_ratio);

    const summary = {
      primary: {
        collection: primary.citation_ref?.collection || primary.citation_ref?.book || "Primary Collection",
        hadith_number: primary.citation_ref?.hadith_number || "",
        text: (primary.content_ar || primary.content || "").slice(0, 200),
      },
      crossReferencesCount: matches.length,
      crossReferences: matches,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      structuredContent: summary,
    };
  },
});
