import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { queryTerms, searchCorpus } from "../corpusSearch";
import { takhrijOverlap, takhrijTokens, TAKHRIJ_MIN_OVERLAP } from "../../../../shared/text/takhrij";

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

/** Collection identity of a row, in the same order the app uses (collection, then book). */
const collectionOf = (r: { citation_ref: Record<string, unknown> | null }): string =>
  String(r.citation_ref?.collection ?? r.citation_ref?.book ?? "");

export default defineTool({
  name: "takhrij_hadith",
  title: "Takhrij Hadith Cross-Reference",
  description:
    "Find other narrations of a hadith across the canonical collections in Easy Editor's corpus, by matching the matn's content words. The best keyword match is treated as the primary narration and the rest are compared against it. Matching is on wording only — a same hadith_number in another collection is never a match, because numbering is per-collection.",
  inputSchema: {
    hadithText: z.string().min(3).describe("Hadith matn or phrase in Arabic to find cross-references for"),
    minOverlapRatio: z.number().min(0.2).max(1.0).default(TAKHRIJ_MIN_OVERLAP).optional()
      .describe(`Minimum content-word overlap (default ${TAKHRIJ_MIN_OVERLAP}, the same threshold the app uses)`),
    limit: z.number().int().min(1).max(25).default(10).optional().describe("Max cross-references to return"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ hadithText, minOverlapRatio = TAKHRIJ_MIN_OVERLAP, limit = 10 }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);

    // Filter to hadith IN the query (source_type), and over-fetch: a candidate
    // must clear the overlap bar, so `limit` rows would leave few survivors.
    const { rows: hadithRows, error } = await searchCorpus(supabase, {
      terms: queryTerms(hadithText),
      sourceTypes: ["hadith"],
      limit: Math.min(limit * 4, 60),
    });

    if (error) {
      return { content: [{ type: "text", text: `Retrieval error: ${error}` }], isError: true };
    }

    if (hadithRows.length === 0) {
      return {
        content: [{ type: "text", text: "No matching hadith found in canonical corpus." }],
        structuredContent: { primary: null, crossReferencesCount: 0, crossReferences: [] },
      };
    }

    const primary = hadithRows[0];
    const primaryColl = collectionOf(primary).toLowerCase();
    const primaryNum = String(primary.citation_ref?.hadith_number ?? "");
    const primaryTokens = takhrijTokens(primary.content_ar || primary.content || "");

    const matches: Array<{
      collection: string;
      hadith_number: string | number;
      chapter?: string;
      overlap_ratio: number;
      matn_snippet: string;
    }> = [];

    for (const cand of hadithRows.slice(1)) {
      // Skip the primary narration itself (same collection AND same number).
      if (collectionOf(cand).toLowerCase() === primaryColl && String(cand.citation_ref?.hadith_number ?? "") === primaryNum) continue;

      const ratio = takhrijOverlap(primaryTokens, takhrijTokens(cand.content_ar || cand.content || ""));
      if (ratio === null || ratio < minOverlapRatio) continue;

      matches.push({
        collection: collectionOf(cand) || "Hadith Book",
        hadith_number: (cand.citation_ref?.hadith_number as string | number | undefined) ?? "",
        chapter: (cand.citation_ref?.chapter ?? cand.citation_ref?.bab ?? undefined) as string | undefined,
        overlap_ratio: Number(ratio.toFixed(2)),
        matn_snippet: (cand.content_ar || cand.content || "").slice(0, 150),
      });
    }

    matches.sort((a, b) => b.overlap_ratio - a.overlap_ratio);
    const top = matches.slice(0, limit);

    const summary = {
      primary: {
        collection: collectionOf(primary) || "Primary Collection",
        hadith_number: (primary.citation_ref?.hadith_number as string | number | undefined) ?? "",
        text: (primary.content_ar || primary.content || "").slice(0, 200),
      },
      crossReferencesCount: top.length,
      crossReferences: top,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      structuredContent: summary,
    };
  },
});
