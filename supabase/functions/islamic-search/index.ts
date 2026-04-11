import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";
import type { IslamicResult } from "../islamic-api-fetch/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Tier A domains (available to all paid tiers)
const TIER_A_DOMAINS = ["dorar", "alquran", "sunnah", "quran-com", "tanzil"];
// Tier B domains (Pro/Ultra — vector index)
const TIER_B_DOMAINS = ["hadith-index", "shamela-index", "openiti-index"];
// Tier C domains (Pro/Ultra — live scraping)
const TIER_C_DOMAINS = ["islamqa", "islamweb", "dar-alifta"];
// Tier K domains (Keyword — local DB full-text search, available to all)
const TIER_K_DOMAINS = ["tanzil", "hadith-json"];

function buildContextBlock(results: IslamicResult[]): string {
  if (results.length === 0) return "\n\n[No Islamic sources were retrieved for this query. If you have general knowledge about this topic, clearly state that it comes from general knowledge, not from verified sources.]";

  return "\n\n⚡ RETRIEVED SOURCES (" + results.length + " total):\n\n" + results.map((r, i) => {
    const cite = r.citation_ref;
    let citeLine = "";

    if (r.domain === "dorar" || r.domain === "sunnah" || r.domain === "hadith-index" || r.domain === "hadith-json") {
      citeLine = `CITATION_REF: { type: "hadith", collection: "${cite.collection ?? cite.book ?? ""}", hadith_number: "${cite.hadith_number ?? ""}", chapter: "${cite.chapter ?? ""}", grade: "${cite.grade ?? ""}", narrator: "${cite.rawi ?? ""}", author: "${cite.author ?? ""}" }`;
    } else if (r.domain === "alquran" || r.domain === "quran-com" || r.domain === "tanzil") {
      citeLine = `CITATION_REF: { type: "quran", surah_number: ${cite.surah_number ?? 0}, surah_name: "${cite.surah_name ?? ""}", verse: ${cite.verse ?? 0}, juz: ${cite.juz ?? ""} }`;
    } else if (r.domain === "islamqa" || r.domain === "islamweb" || r.domain === "dar-alifta") {
      citeLine = `CITATION_REF: { type: "fatwa", site: "${cite.url ? new URL(cite.url).hostname : r.domain}", fatwa_number: "${cite.fatwa_number ?? ""}", scholar: "${cite.scholar ?? ""}", url: "${cite.url ?? ""}" }`;
    } else {
      citeLine = `CITATION_REF: { type: "classical", source: "${r.domain}", title: "${cite.title ?? cite.book ?? ""}", author: "${cite.author ?? ""}", volume: ${cite.volume ?? ""}, page: ${cite.page ?? ""} }`;
    }

    // Include both Arabic and English content when available
    const content = r.content;
    return `--- Islamic Source ${i + 1} [${r.domain.toUpperCase()}] ---\n${citeLine}\n${content}`;
  }).join("\n\n");
}

function buildSystemPrompt(contextBlock: string, strictMode: boolean): string {
  const modeInstruction = strictMode
    ? `STRICT SOURCE MODE:
- You MUST answer ONLY based on the provided Islamic sources below.
- If the answer is NOT found in the provided sources, say: "لم أجد إجابة في المصادر المتاحة" / "I could not find an answer in the available sources."
- Do NOT generate or invent any hadith text, Quran translation, or scholarly opinion.
- Do NOT paraphrase a source in a way that changes its meaning.`
    : `REFERENCED MODE:
- Use the provided Islamic sources as PRIMARY references.
- You may supplement with widely-accepted Islamic knowledge, but you MUST clearly mark it: "⚠️ From general knowledge, not from provided sources."
- Never fabricate hadith, Quran verses, or scholarly opinions.`;

  return `You are an expert Islamic research assistant specializing in Quran, Hadith, Fiqh, and Aqeedah.

${modeInstruction}

ANTI-HALLUCINATION RULES — CRITICAL:
1. NEVER invent or fabricate a hadith. If you are unsure of a hadith's exact wording, say so.
2. NEVER create a fake Quran verse or translation. Only quote what is provided in the sources.
3. NEVER attribute a ruling or opinion to a scholar without a source reference.
4. If sources are insufficient, clearly state: "The provided sources do not cover this topic fully."
5. Distinguish between: (a) direct quotes from sources, (b) your summary of sources, (c) general knowledge.

CITATION FORMAT — MANDATORY:
Each source below has a CITATION_REF block. Cite inline using square brackets:
- **Hadith**: [Collection Name, Hadith No. X] — include grade and narrator if available
- **Quran**:  [Surah Name X:Y] — include Juz number if available
- **Fatwa**:  [Source, Fatwa #N] — include scholar name if available
- **Classical**: [Author, Title, Vol. X, P. Y]

CITATION RULES:
- Every factual claim MUST have at least one inline citation. No uncited assertions.
- When quoting Arabic text, always provide the citation immediately after.
- Group related citations together when making a compound point.
- At the end of your answer, provide a "## المراجع / References" section listing all cited sources.

ANSWER STRUCTURE:
1. **Direct Answer**: Start with a clear, concise answer to the question.
2. **Evidence**: Present Quran verses first (if relevant), then Hadith, then scholarly opinions.
3. **Arabic Text**: Include original Arabic text when available, followed by translation.
4. **References Section**: End with a numbered list of all sources cited.

FORMATTING:
- Use Markdown: headers (##), bullet points, **bold** for key terms
- Respond in the same language as the user's question (Arabic / English / Urdu)
- For Arabic content, preserve diacritics (tashkeel) as provided in sources
- Use RTL formatting hints when responding in Arabic
${contextBlock}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    // Must return 200 (not 204) for Supabase CORS preflight to pass
    return new Response("ok", { status: 200, headers: corsHeaders });
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
    const effectiveDomains: string[] = (selectedDomains ?? [...TIER_A_DOMAINS, ...TIER_K_DOMAINS]).filter((d: string) => {
      if (TIER_A_DOMAINS.includes(d)) return true;
      if (TIER_K_DOMAINS.includes(d)) return true; // keyword search available to all tiers
      if ((TIER_B_DOMAINS.includes(d) || TIER_C_DOMAINS.includes(d)) && tierAllowsAdvanced) return true;
      return false;
    });

    // --- Fan-out: Tier A (always), Tier B (Pro/Ultra), Tier C (Pro/Ultra), Tier K (keyword) ---
    const tierADomains = effectiveDomains.filter((d) => TIER_A_DOMAINS.includes(d));
    const tierBDomains = effectiveDomains.filter((d) => TIER_B_DOMAINS.includes(d));
    const tierCDomains = effectiveDomains.filter((d) => TIER_C_DOMAINS.includes(d));
    const tierKDomains = effectiveDomains.filter((d) => TIER_K_DOMAINS.includes(d));

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

    // Tier K: local DB keyword search (available to all tiers)
    if (tierKDomains.length > 0) {
      fanOutPromises.push(
        (async (): Promise<IslamicResult[]> => {
          try {
            // Build simple tsquery from query words
            const words = query.trim().split(/\s+/).filter(Boolean);
            if (words.length === 0) return [];

            const tsquery = words.map((w: string) => `'${w.replace(/'/g, "''")}'`).join(" & ");

            // Map tier K domains to source_types
            const sourceTypes: string[] = [];
            if (tierKDomains.includes("tanzil")) sourceTypes.push("quran");
            if (tierKDomains.includes("hadith-json")) sourceTypes.push("hadith");

            if (sourceTypes.length === 0) return [];

            const sourceFilter = sourceTypes.map(s => `source_type.eq.${s}`).join(",");

            // Search both Arabic and English content
            const { data, error } = await supabase
              .from("scholarly_documents")
              .select("domain, content, content_ar, citation_ref, language, source_type")
              .or(sourceFilter)
              .or(`content_ar.fts(simple).${query},content.fts(simple).${query}`)
              .limit(15);

            if (error) {
              console.error("Tier K keyword search error:", error);
              return [];
            }

            return (data ?? []).map((row: any): IslamicResult => ({
              domain: row.domain,
              content: row.content,
              citation_ref: row.citation_ref ?? {},
              language: row.language ?? "ar",
            }));
          } catch (e) {
            console.error("Tier K error:", e);
            return [];
          }
        })()
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
