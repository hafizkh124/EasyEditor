/**
 * resource-search — citation search for the Editor / Translator
 * "insert reference" dialog.
 *
 * All retrieval logic lives in _shared/citationEngine.ts, which every citation
 * surface in the app shares. This function is the authenticated, metered HTTP
 * wrapper around it.
 *
 * Previously this embedded the user's raw question and ran a single pgvector
 * lookup. That could not handle an Urdu instruction sentence ("نیت سے متعلق
 * آیات ذکر کریں" — most of the embedding's weight lands on the instruction
 * words, not the concept) and could not answer counting questions at all.
 *
 * Request:  { query: string, matchCount?: number }
 * Response: { intent, plan_summary, results[], count? }
 *
 * `results[]` keeps its original row shape (content / citation_ref /
 * source_url / domain / language) so older clients keep working; the new
 * fields (match_key, score, reason, channels) are additive.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";
import { calculateCost, checkAndDeductTokens, refundTokens, insufficientTokensResponse } from "../_shared/tokenGuard.ts";
import { findCitations } from "../_shared/citationEngine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    // Cost rose from the old `refine` (5) because a search is now a planning
    // call + an embedding + a rerank call rather than one embedding.
    const tokenCost = calculateCost("citation_search", 1);
    const tokenResult = await checkAndDeductTokens(
      supabase, user.id, tokenCost, "citation_search", `Citation search: ${query.slice(0, 60)}`,
    );
    if (!tokenResult.ok) {
      return insufficientTokensResponse(tokenResult, corsHeaders);
    }

    const result = await findCitations({
      query,
      supabase,
      maxResults: matchCount ?? 12,
    });

    // Refund when the search produced nothing usable: no passages AND either
    // no count at all or a count that totalled zero occurrences. The user
    // shouldn't pay for a query that returned no signal.
    const zeroCount = !result.count || (result.count.total ?? 0) === 0;
    if (result.results.length === 0 && zeroCount) {
      await refundTokens(supabase, user.id, tokenCost, "citation_search", "No results found");
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("resource-search error:", e);
    return new Response(JSON.stringify({ error: "Search failed", results: [] }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
