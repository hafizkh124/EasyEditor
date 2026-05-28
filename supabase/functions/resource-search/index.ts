/**
 * resource-search — authenticated semantic search over scholarly_documents for
 * the Editor/Translator "insert reference" feature.
 *
 * Mirrors the embed → match_scholarly_documents flow from vector-search, but:
 *   - requires a Bearer token (does its own auth, verify_jwt = false in config)
 *   - charges a small token cost (reuses the `refine` cost = 5)
 *   - returns lightweight rows: { content, citation_ref, source_url, domain, language }
 *
 * Request:  { query: string, matchCount?: number }
 * Response: { results: ResourceResult[] }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";
import { calculateCost, checkAndDeductTokens, insufficientTokensResponse } from "../_shared/tokenGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Arabic normalizer (mirrors vector-search) ───────────────────────────────
function normalizeArabic(text: string): string {
  return text
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (isRateLimited(user.id, 30, 60_000)) {
      return rateLimitResponse(corsHeaders);
    }

    const { query, matchCount } = await req.json();
    if (!query || typeof query !== "string" || !query.trim()) {
      return new Response(JSON.stringify({ error: "Query is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "Search service not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Token check: small cost per search (reuse refine = 5 tokens)
    const tokenCost = calculateCost("refine", 1);
    const tokenResult = await checkAndDeductTokens(
      supabase, user.id, tokenCost, "refine", "resource search",
    );
    if (!tokenResult.ok) {
      return insufficientTokensResponse(tokenResult, corsHeaders);
    }

    // ── Embed query via Google Generative Language API (768 dims) ─────────────
    const embedInput = normalizeArabic(query);
    const embedRes = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
      {
        method: "POST",
        headers: { "x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: embedInput }] },
          outputDimensionality: 768,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!embedRes.ok) {
      console.error("resource-search embedding error:", embedRes.status);
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const embedData = await embedRes.json();
    const embedding: number[] = embedData?.embedding?.values;
    if (!embedding || embedding.length !== 768) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await supabase.rpc("match_scholarly_documents", {
      query_embedding: embedding,
      match_threshold: 0.45,
      match_count: matchCount ?? 12,
      filter_domains: null,
      filter_language: null,
    });

    if (error) {
      console.error("match_scholarly_documents RPC error:", error);
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = (data ?? []).map((row: any) => ({
      content: row.content,
      citation_ref: row.citation_ref ?? {},
      source_url: row.source_url ?? row.citation_ref?.url ?? null,
      domain: row.domain,
      language: row.language ?? "ar",
    }));

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("resource-search error:", e);
    return new Response(JSON.stringify({ results: [] }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
