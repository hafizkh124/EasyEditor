import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";
import type { IslamicResult } from "../islamic-api-fetch/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Tier A domains (available to all paid tiers)
const TIER_A_DOMAINS = ["dorar", "alquran", "sunnah", "quran-com", "tanzil"];
// Tier B domains (Pro/Ultra — vector index)
const TIER_B_DOMAINS = ["hadith-index", "shamela-index", "openiti-index"];
// Tier C domains (Pro/Ultra — live scraping)
const TIER_C_DOMAINS = ["islamqa", "islamweb", "dar-alifta"];

function buildContextBlock(results: IslamicResult[]): string {
  if (results.length === 0) return "\n\n[No Islamic sources were retrieved for this query.]";

  return "\n\n" + results.map((r, i) => {
    const cite = r.citation_ref;
    let citeLine = "";

    if (r.domain === "dorar" || r.domain === "sunnah" || r.domain === "hadith-index") {
      citeLine = `CITATION_REF: { type: "hadith", book: "${cite.book ?? ""}", hadith_number: "${cite.hadith_number ?? ""}", grade: "${cite.grade ?? ""}", narrator: "${cite.rawi ?? ""}" }`;
    } else if (r.domain === "alquran" || r.domain === "quran-com" || r.domain === "tanzil") {
      citeLine = `CITATION_REF: { type: "quran", surah_number: ${cite.surah_number ?? 0}, surah_name: "${cite.surah_name ?? ""}", verse: ${cite.verse ?? 0}, juz: ${cite.juz ?? ""} }`;
    } else if (r.domain === "islamqa" || r.domain === "islamweb" || r.domain === "dar-alifta") {
      citeLine = `CITATION_REF: { type: "fatwa", site: "${cite.url ? new URL(cite.url).hostname : r.domain}", fatwa_number: "${cite.fatwa_number ?? ""}", scholar: "${cite.scholar ?? ""}", url: "${cite.url ?? ""}" }`;
    } else {
      citeLine = `CITATION_REF: { type: "classical", source: "${r.domain}", title: "${cite.book ?? ""}", volume: ${cite.volume ?? ""}, page: ${cite.page ?? ""} }`;
    }

    return `--- Islamic Source ${i + 1} [${r.domain.toUpperCase()}] ---\n${citeLine}\n${r.content}`;
  }).join("\n\n");
}

function buildSystemPrompt(contextBlock: string, strictMode: boolean): string {
  const modeInstruction = strictMode
    ? "You MUST answer ONLY based on the provided Islamic sources. If the answer is not found in the sources, say so clearly."
    : "Use the provided Islamic sources as primary references. You may augment with general Islamic knowledge but clearly distinguish what comes from the provided sources vs. your general knowledge.";

  return `You are an expert Islamic and academic research assistant specializing in Quran, Hadith, and Islamic jurisprudence.

${modeInstruction}

CITATION INSTRUCTIONS — MANDATORY:
Each source below has a CITATION_REF block. You MUST cite inline using square brackets.
- Hadith: [Book Name, Hadith No. X, Grade: Y, Narrator: Z]
- Quran:  [Surah Name, Verse X:Y (Juz N)]
- Fatwa:  [Source Name, Fatwa No. Z]
- Classical text: [Author, Title, Vol. X, P. Y]
Every factual claim MUST have at least one inline citation. No uncited assertions.

FORMATTING:
- Use Markdown: headers, bullet points, bold for key terms
- Respond in the same language as the user's question (Arabic/English/Urdu)
- For Arabic content, use proper diacritics where helpful
${contextBlock}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Rate limit ---
    if (isRateLimited(user.id, 20, 60_000)) {
      return rateLimitResponse(corsHeaders);
    }

    // --- Subscription check ---
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("tier, islamic_queries_used, islamic_queries_limit")
      .eq("user_id", user.id)
      .single();

    const tier = sub?.tier ?? "free";
    const islamicUsed = sub?.islamic_queries_used ?? 0;
    const islamicLimit = sub?.islamic_queries_limit ?? 0;

    if (islamicLimit > 0 && islamicUsed >= islamicLimit) {
      return new Response(JSON.stringify({ error: "Islamic research query limit reached. Please upgrade your plan." }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { query, selectedDomains, chatHistory, strictMode } = await req.json();

    if (!query) {
      return new Response(JSON.stringify({ error: "Query is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI service not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine allowed domains based on tier
    const tierAllowsAdvanced = tier === "pro" || tier === "ultra";
    const effectiveDomains: string[] = (selectedDomains ?? [...TIER_A_DOMAINS]).filter((d: string) => {
      if (TIER_A_DOMAINS.includes(d)) return true;
      if ((TIER_B_DOMAINS.includes(d) || TIER_C_DOMAINS.includes(d)) && tierAllowsAdvanced) return true;
      return false;
    });

    // --- Fan-out: Tier A (always), Tier B (Pro/Ultra), Tier C (Pro/Ultra) ---
    const tierADomains = effectiveDomains.filter((d) => TIER_A_DOMAINS.includes(d));
    const tierBDomains = effectiveDomains.filter((d) => TIER_B_DOMAINS.includes(d));
    const tierCDomains = effectiveDomains.filter((d) => TIER_C_DOMAINS.includes(d));

    const fanOutPromises: Promise<IslamicResult[]>[] = [];

    // Tier A: call islamic-api-fetch
    if (tierADomains.length > 0) {
      const apiFetchUrl = `${supabaseUrl}/functions/v1/islamic-api-fetch`;
      fanOutPromises.push(
        fetch(apiFetchUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseKey}`,
            apikey: supabaseKey,
          },
          body: JSON.stringify({ query, selectedDomains: tierADomains }),
          signal: AbortSignal.timeout(12_000),
        })
          .then((r) => r.ok ? r.json() : { results: [] })
          .then((d) => d.results ?? [])
          .catch(() => [])
      );
    }

    // Tier B: call vector-search (Pro/Ultra only, requires scholarly_documents populated)
    if (tierBDomains.length > 0 && tierAllowsAdvanced) {
      const vectorUrl = `${supabaseUrl}/functions/v1/vector-search`;
      fanOutPromises.push(
        fetch(vectorUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseKey}`,
            apikey: supabaseKey,
          },
          body: JSON.stringify({
            query,
            selectedDomains: tierBDomains,
            tier,
          }),
          signal: AbortSignal.timeout(20_000),  // embedding + RPC needs more time
        })
          .then((r) => r.ok ? r.json() : { results: [] })
          .then((d) => d.results ?? [])
          .catch(() => [])
      );
    }

    // Tier C: call domain-scrape (Pro/Ultra only)
    if (tierCDomains.length > 0 && tierAllowsAdvanced) {
      const scrapeUrl = `${supabaseUrl}/functions/v1/domain-scrape`;
      fanOutPromises.push(
        fetch(scrapeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseKey}`,
            apikey: supabaseKey,
          },
          body: JSON.stringify({ query, selectedDomains: tierCDomains }),
          signal: AbortSignal.timeout(12_000),
        })
          .then((r) => r.ok ? r.json() : { results: [] })
          .then((d) => d.results ?? [])
          .catch(() => [])
      );
    }

    const settled = await Promise.allSettled(fanOutPromises);
    const allResults: IslamicResult[] = [];
    for (const r of settled) {
      if (r.status === "fulfilled") allResults.push(...r.value);
    }

    const contextBlock = buildContextBlock(allResults);

    // Emit SSE "sources ready" event — client shows indicator before Gemini starts
    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    // Build Gemini messages
    const messages: any[] = [
      { role: "system", content: buildSystemPrompt(contextBlock, strictMode ?? true) },
    ];
    if (chatHistory && chatHistory.length > 0) {
      for (const msg of chatHistory) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({ role: "user", content: query });

    // Call Gemini
    const geminiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        stream: true,
      }),
    });

    if (!geminiRes.ok) {
      const errTxt = await geminiRes.text().catch(() => "");
      if (geminiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("Gemini error:", geminiRes.status, errTxt);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Stream Gemini SSE, prepending sources_ready event
    (async () => {
      // Build citation summaries (domain + citation_ref + url only, no content)
      const citationSummaries = allResults.map((r) => ({
        domain:       r.domain,
        citation_ref: r.citation_ref,
        url:          r.citation_ref.url ?? undefined,
      }));

      // First event: sources ready — count, domains, and citation summaries
      const sourcesEvent = `data: ${JSON.stringify({
        type:      "sources_ready",
        count:     allResults.length,
        domains:   [...new Set(allResults.map((r) => r.domain))],
        citations: citationSummaries,
      })}\n\n`;
      await writer.write(encoder.encode(sourcesEvent));

      // Proxy Gemini SSE
      const reader = geminiRes.body!.getReader();
      let done = false;
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
        if (value) await writer.write(value);
      }

      // On stream end: increment islamic_queries_used atomically
      supabase.rpc("increment_islamic_queries", { p_user_id: user.id }).catch(console.error);

      await writer.close();
    })();

    return new Response(readable, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("islamic-search error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
