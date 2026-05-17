/**
 * vector-search — Tier B: pgvector semantic search over scholarly_documents
 *
 * Called internally by islamic-search for every authenticated user. Plan
 * differentiation is enforced upstream via monthly query quota, not here.
 * Flow:
 *   1. Normalize Arabic query
 *   2. Embed via Lovable AI gateway (text-embedding-004, 768 dims, retry once on 5xx)
 *   3. Call match_scholarly_documents RPC (cosine similarity ≥ 0.45)
 *   4. Return IslamicResult[]
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { expandQueryTerms } from "../_shared/bilingualMap.ts";
import type { IslamicResult } from "../islamic-api-fetch/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Arabic normalizer (mirrors src/utils/arabicUtils.ts) ─────────────────────
function normalizeArabic(text: string): string {
  return text
    .replace(/[\u064B-\u065F\u0670]/g, "")           // strip harakat + dagger alef
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627") // normalize alef variants → ا
    .replace(/\u0629/g, "\u0647")                     // ta marbuta ة → ha ه
    .replace(/\u0649/g, "\u064A")                     // alef maqsura ى → ya ي
    .trim();
}

// ── Tier B domain → source_type mapping ──────────────────────────────────────
const DOMAIN_SOURCE_TYPE: Record<string, string> = {
  "hadith-index":  "hadith",
  "tanzil":        "quran",
  "shamela-index": "classical",
  "openiti-index": "classical",
};

// ── Map a DB row back to IslamicResult ────────────────────────────────────────
function rowToIslamicResult(row: any): IslamicResult {
  const cite = row.citation_ref ?? {};
  return {
    domain: row.domain,
    content: row.content,
    citation_ref: {
      book:          cite.book,
      collection:    cite.collection,
      hadith_number: cite.hadith_number,
      grade:         cite.grade,
      rawi:          cite.rawi,
      surah_number:  cite.surah_number != null ? Number(cite.surah_number) : undefined,
      surah_name:    cite.surah_name,
      verse:         cite.verse != null ? Number(cite.verse) : undefined,
      juz:           cite.juz != null ? Number(cite.juz) : undefined,
      fatwa_number:  cite.fatwa_number,
      scholar:       cite.scholar,
      url:           row.source_url ?? cite.url,
      volume:        cite.volume != null ? Number(cite.volume) : undefined,
      page:          cite.page != null ? Number(cite.page) : undefined,
    },
    language: (row.language as "ar" | "en" | "ur") ?? "ar",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      query,
      selectedDomains,
      tier,
      matchCount,
    }: {
      query: string;
      selectedDomains: string[];
      tier: string;
      matchCount?: number;
    } = await req.json();

    if (!query) {
      return new Response(JSON.stringify({ error: "Query is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase     = createClient(supabaseUrl, supabaseKey);

    // ── 1. Normalize Arabic query + append bilingual expansions ───────────────
    // Embedding the original query alone often misses cross-script matches
    // (e.g. Urdu "صدقہ" vs Arabic corpus "الصدقة"). By concatenating expansions
    // from the shared bilingual map, the embedding vector lands in a region of
    // semantic space that better overlaps Arabic/English/Urdu hits at once.
    const normalizedQuery = normalizeArabic(query);
    const expansions = expandQueryTerms(query).filter(
      (t) => t.toLowerCase() !== normalizedQuery.toLowerCase(),
    );
    const embedInput = expansions.length > 0
      ? `${normalizedQuery}\n${expansions.slice(0, 6).join(" ")}`
      : normalizedQuery;

    // ── 2. Embed via Google AI Studio Generative Language API ────────────────
    // Lovable AI Gateway's embeddings endpoint is not available on every
    // workspace (returns 404 "route_not_found"). We call Google's free-tier
    // direct API with GEMINI_API_KEY to bypass that limitation. Retry once.
    // Model: gemini-embedding-001 (text-embedding-004 retired). Request 768
    // dims to match the existing pgvector(768) schema.
    const callEmbedding = () => fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
      {
        method: "POST",
        headers: {
          "x-goog-api-key": GEMINI_API_KEY,
          "Content-Type":   "application/json",
        },
        body: JSON.stringify({
          model:                "models/gemini-embedding-001",
          content:              { parts: [{ text: embedInput }] },
          outputDimensionality: 768,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    let embedRes = await callEmbedding();
    if (!embedRes.ok && embedRes.status >= 500 && embedRes.status < 600) {
      console.warn("Embedding 5xx, retrying once:", embedRes.status);
      embedRes = await callEmbedding();
    }

    if (!embedRes.ok) {
      const errTxt = await embedRes.text().catch(() => "");
      console.error("Embedding API error:", embedRes.status, errTxt);
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const embedData = await embedRes.json();
    const embedding: number[] = embedData?.embedding?.values;

    if (!embedding || embedding.length !== 768) {
      console.error("Unexpected embedding shape:", embedData);
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 3. Filter to Tier B domains that are in scholarly_documents ───────────
    const tierBDomains = ["hadith-index", "tanzil", "hadith-json", "shamela-index", "openiti-index"];
    const filterDomains = (selectedDomains ?? tierBDomains).filter((d: string) =>
      tierBDomains.includes(d)
    );

    // All users get the same retrieval depth. Caller may override via matchCount.
    const topK = matchCount ?? 15;
    void tier; // accepted for backwards compat; no longer used to gate depth

    // ── 4. Call pgvector RPC ──────────────────────────────────────────────────
    const { data, error } = await supabase.rpc("match_scholarly_documents", {
      query_embedding: embedding,
      match_threshold: 0.45,
      match_count:     topK,
      filter_domains:  filterDomains.length > 0 ? filterDomains : null,
      filter_language: null,  // caller can pass language filter in future
    });

    if (error) {
      console.error("match_scholarly_documents RPC error:", error);
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 5. Map rows to IslamicResult[] ────────────────────────────────────────
    const results: IslamicResult[] = (data ?? []).map(rowToIslamicResult);

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("vector-search error:", e);
    return new Response(JSON.stringify({ results: [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
