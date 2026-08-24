import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";
import { calculateCost, checkAndDeductTokens, refundTokens, insufficientTokensResponse } from "../_shared/tokenGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
}

/**
 * Exported so the request logic is reachable from a test. Everything below
 * used to live inside an anonymous `serve(async (req) => …)`, which left the
 * HTTP layer — validation, auth rejection, error mapping, CORS on error
 * responses — verifiable only by the post-deploy smoke script.
 */
export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let userId: string | null = null;
  let tokenCost = 0;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    userId = user.id;

    if (isRateLimited(userId, 10, 60_000)) {
      return rateLimitResponse(corsHeaders);
    }

    const { query, maxResults = 5 } = await req.json();
    if (!query || typeof query !== "string") {
      return new Response(
        JSON.stringify({ error: "query string is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    tokenCost = calculateCost("research", 1);
    const tokenResult = await checkAndDeductTokens(
      supabase, userId, tokenCost, "web-search", `Tier-4 Web Search: ${query.slice(0, 30)}`
    );
    if (!tokenResult.ok) {
      return insufficientTokensResponse(tokenResult, corsHeaders);
    }

    const tavilyKey = Deno.env.get("TAVILY_API_KEY");
    let results: WebSearchResult[] = [];

    if (tavilyKey) {
      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: tavilyKey,
            query,
            search_depth: "basic",
            max_results: maxResults,
            include_answer: false,
          }),
        });
        if (res.ok) {
          const json = await res.json();
          // deno-lint-ignore no-explicit-any
          results = (json.results || []).map((r: any) => ({
            title: r.title || "خبر / مضمون",
            url: r.url,
            snippet: r.content || r.snippet || "",
            score: r.score ?? 0.8,
          }));
        }
      } catch (err) {
        console.error("Tavily search failed:", err);
      }
    }

    // If search produced no results, refund tokens so user isn't charged
    if (results.length === 0 && userId) {
      await refundTokens(supabase, userId, tokenCost, "web-search", "Refund for empty web search results");
      return new Response(
        JSON.stringify({ tier: 4, query, results: [], message: "No web results found; tokens refunded." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const formatted = results.map((r, idx) => ({
      match_key: `web:${idx + 1}`,
      source_type: "web",
      // A malformed URL from the provider must not throw and turn a paid,
      // successful search into a 500 — fall back to the raw string.
      domain: (() => {
        try { return new URL(r.url).hostname; } catch { return r.url ?? "web"; }
      })(),
      content: r.snippet,
      citation_ref: {
        title: r.title,
        url: r.url,
      },
      source_url: r.url,
      language: /[؀-ۿ]/.test(r.snippet) ? "ur" : "en",
      score: r.score || (1 / (idx + 1)),
      channels: ["tier4-web"],
    }));

    return new Response(
      JSON.stringify({
        tier: 4,
        query,
        results: formatted,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("web-search function error:", err);
    // Tokens were already deducted before the failure — refund them so a
    // server-side error never costs the user anything.
    if (userId && tokenCost > 0) {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        await refundTokens(supabase, userId, tokenCost, "web-search", "Refund: web search failed");
      } catch (refundErr) {
        console.error("web-search refund failed:", refundErr);
      }
    }
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Web search failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

Deno.serve(handle);

