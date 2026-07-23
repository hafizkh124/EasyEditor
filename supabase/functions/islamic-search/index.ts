import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";
import { calculateCost, checkAndDeductTokens, refundTokens, insufficientTokensResponse } from "../_shared/tokenGuard.ts";
import { expandQueryTerms } from "../_shared/bilingualMap.ts";
import { lookupTopicAnchors } from "../_shared/topicAnchors.ts";
import { planQuery } from "../_shared/queryPlanner.ts";
import type { IslamicResult } from "../islamic-api-fetch/index.ts";
import { callChatCompletions } from "../_shared/aiGateway.ts";

/** Strip Arabic diacritics/harakat so an "الصدقة" search matches stored
 *  "الصَّدَقَةُ". Mirrors normalizeArabic in vector-search and _shared. */
// Note: query-time diacritic normalization now lives in the
// `search_documents_smart` Postgres RPC (migration 20260517000000). This
// helper is kept only because the Tier-A `domain-scrape` fallback path
// still uses it for client-side filtering of scraped fatwa snippets.
function stripArabicDiacritics(text: string): string {
  return text
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Source domains — all available to every authenticated user. Plan differentiation
// happens via monthly query quota (islamic_queries_limit), not data access.
// Per Phase 7.5 locked doctrine: only sources with working live integrations.
// Sunnah.com (no API key obtained) and Dar-Alifta.org (persistent timeouts)
// removed. They can be reinstated in `domain-scrape` / `islamic-api-fetch`
// once upstream recovers or credentials are obtained.
const TIER_A_DOMAINS = ["dorar", "alquran", "hadith-api", "quran-com", "tanzil"];
const TIER_B_DOMAINS = ["hadith-index", "shamela-index", "openiti-index"];
const TIER_C_DOMAINS = [
  "islamqa", "islamweb", "islamicurdubooks", "shamilaurdu",
  "alulama", "magazine-mohaddis", "mohaddis", "urdufatwa",
  "islamfort", "alminasa", "shamela",
];

const TIER_K_DOMAINS = ["tanzil", "hadith-json"];
const ALL_DOMAINS = [...TIER_A_DOMAINS, ...TIER_B_DOMAINS, ...TIER_C_DOMAINS, ...TIER_K_DOMAINS];

function buildContextBlock(results: IslamicResult[]): string {
  if (results.length === 0) return "\n\n[No Islamic sources were retrieved for this query. If you have general knowledge about this topic, clearly state that it comes from general knowledge, not from verified sources.]";

  return "\n\n⚡ RETRIEVED SOURCES (" + results.length + " total):\n\n" + results.map((r, i) => {
    const cite = r.citation_ref;
    let citeLine = "";

    if (r.domain === "dorar" || r.domain === "hadith-api" || r.domain === "hadith-index" || r.domain === "hadith-json" || r.domain === "islamicurdubooks" || r.domain === "shamilaurdu") {
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
- If the sources partially cover the topic, answer what you CAN from the sources and note what is missing.
- Only say "لم أجد إجابة" if the sources are COMPLETELY irrelevant to the question.
- Do NOT generate or invent any hadith text, Quran translation, or scholarly opinion.
- Do NOT paraphrase a source in a way that changes its meaning.`
    : `REFERENCED MODE:
- Use the provided Islamic sources as PRIMARY references.
- You may supplement with widely-accepted Islamic knowledge, but you MUST clearly mark supplemental info with: "📌 معلومات عامہ / General Knowledge:"
- Never fabricate hadith, Quran verses, or scholarly opinions.
- Always try to answer helpfully — do not refuse if you have relevant general knowledge.`;

  return `You are an expert Islamic research assistant specializing in Quran, Hadith, Fiqh, and Aqeedah.
You are helpful, knowledgeable, and always try to provide the most comprehensive answer possible using the provided sources.

${modeInstruction}

ANTI-HALLUCINATION RULES — CRITICAL:
1. NEVER invent or fabricate a hadith. If you are unsure of a hadith's exact wording, say so.
2. NEVER create a fake Quran verse or translation. Only quote what is provided in the sources.
3. NEVER attribute a ruling or opinion to a scholar without a source reference.
4. If sources are insufficient, clearly state what the sources DO cover, then note the gap.
5. Distinguish between: (a) direct quotes from sources, (b) your summary of sources, (c) general knowledge.

ANSWER STRUCTURE — USE THIS EXACT FORMAT:

## 📝 جواب / Answer
Start with a clear, concise answer to the question (2-3 sentences).

## 📖 قرآنی دلائل / Quranic Evidence
(Skip this section if no Quran sources are relevant)
- Quote the Arabic verse with full diacritics
- Provide translation immediately after
- Cite as [Surah Name X:Y]

## 📜 احادیث / Hadith Evidence
(Skip this section if no Hadith sources are relevant)
- Quote the hadith text (Arabic if available, then translation)
- Cite as [Collection Name, Hadith No. X]
- Include narrator and grade if available

## 🧾 خلاصہ / Summary
A brief 2-3 sentence summary tying the evidence together.

## 📚 حوالہ جات / References
Numbered list of all sources cited.

CITATION RULES:
- Every factual claim MUST have at least one inline citation in square brackets.
- When quoting Arabic text, cite immediately after.
- Use exact text from sources — do not paraphrase Arabic verses or hadith text.

FORMATTING:
- Use Markdown with the emoji headers shown above
- Respond in the same language as the user's question (Arabic / English / Urdu)
- For Arabic content, preserve diacritics (tashkeel) as provided in sources
- Use **bold** for key Islamic terms
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

    // --- Subscription tier (for domain access stratification) ---
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("tier, islamic_queries_used, islamic_queries_limit")
      .eq("user_id", user.id)
      .single();

    const tier = sub?.tier ?? "free";

    const { query, selectedDomains, chatHistory, strictMode } = await req.json();

    if (!query) {
      return new Response(JSON.stringify({ error: "Query is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Token-based quota check: 40 tokens per Islamic research query
    const tokenCost = calculateCost("islamic", 1);
    const tokenResult = await checkAndDeductTokens(
      supabase, user.id, tokenCost, "islamic",
      `Islamic query: ${query.slice(0, 60)}`,
    );
    if (!tokenResult.ok) {
      return insufficientTokensResponse(tokenResult, corsHeaders);
    }

    const hasAnyKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("LOVABLE_API_KEY");
    if (!hasAnyKey) {
      return new Response(JSON.stringify({ error: "AI service not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // All authenticated users may reach every source. Quota (above) is the only
    // plan-based gate. If the caller doesn't explicitly select domains, default
    // to the full set so free-tier users get the same retrieval quality.
    const effectiveDomains: string[] = (selectedDomains ?? ALL_DOMAINS).filter(
      (d: string) => ALL_DOMAINS.includes(d),
    );
    void tier; // retained in scope for future telemetry / quota differentiation

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

    // Tier B: call vector-search (available to all — requires scholarly_documents populated)
    if (tierBDomains.length > 0) {
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

    // Tier C: call domain-scrape (live fatwa scraping — available to all)
    if (tierCDomains.length > 0) {
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

    // Tier K: local DB keyword search with bilingual expansion (available to all tiers).
    // Source_type selection is INFERRED from the user's overall domain selection,
    // not from a strict Tier-K membership check. This way, selecting "Sunnah.com"
    // or "Dorar" (Tier-A hadith APIs) also triggers a search of the local hadith
    // corpus — which holds 81K+ rows. Similarly any Quran-related domain pulls
    // from tanzil. Without this inference, the Tier-A frontend domains would
    // never reach Tier-K's hadith-json data even though it's the richest source.
    const wantsQuran  = effectiveDomains.some((d) =>
      ["tanzil", "alquran", "quran-com"].includes(d),
    );
    const wantsHadith = effectiveDomains.some((d) =>
      ["dorar", "hadith-api", "hadith-index", "hadith-json", "islamicurdubooks", "shamilaurdu"].includes(d),
    );
    if (wantsQuran || wantsHadith) {
      fanOutPromises.push(
        (async (): Promise<IslamicResult[]> => {
          try {
            const sourceTypes: string[] = [];
            if (wantsQuran)  sourceTypes.push("quran");
            if (wantsHadith) sourceTypes.push("hadith");
            if (sourceTypes.length === 0) return [];

            // Build expanded term list — bilingual synonyms plus the query
            // planner's Arabic surface forms. The static map covers ~50 topics;
            // the planner generalizes to anything else (and falls back to the
            // map by itself when the model is unavailable).
            // Normalization (diacritics + letter variants) happens server-side
            // in the RPC, so raw Urdu / Arabic / English terms are fine here.
            const plan = await planQuery(query, supabase).catch(() => null);
            const expanded = [...new Set([
              ...expandQueryTerms(query),
              ...(plan?.arabic_surface_forms ?? []),
              ...(plan?.related_concepts ?? []),
            ])];
            // Cap to a sensible upper bound so the SQL UNNEST stays small.
            const terms = expanded.slice(0, 12);

            // When the user named specific books ("صحیح بخاری میں..."), use the
            // scoped RPC so the local corpus honours that restriction. Without
            // a collection scope, stay on search_documents_smart — it also
            // matches `content`, which picks up English-side hits the
            // content_ar-only scoped search would miss.
            const planCollections = plan?.scope.collections ?? [];
            const { data, error } = planCollections.length > 0
              ? await supabase.rpc("search_documents_scoped", {
                  p_patterns:     terms,
                  p_source_types: sourceTypes,
                  p_collections:  planCollections,
                  p_surah:        plan?.scope.surah ?? null,
                  p_limit:        30,
                })
              : await supabase.rpc("search_documents_smart", {
                  p_terms:        terms,
                  p_source_types: sourceTypes,
                  p_match_limit:  30,
                });

            if (error) {
              console.error("Tier K smart-search error:", error);
              return [];
            }

            const rows = (data ?? []) as Array<{
              domain: string;
              source_type: string;
              content: string;
              content_ar: string;
              citation_ref: any;
              language: string;
              source_url?: string;
              match_score?: number;
            }>;

            // Balanced mix: 6 Quran + 10 Hadith max (Hadith corpus is much
            // larger so we let it dominate when both are present).
            const quranRows  = rows.filter((r) => r.source_type === "quran").slice(0, 6);
            const hadithRows = rows.filter((r) => r.source_type === "hadith").slice(0, 10);
            const mixed = quranRows.length && hadithRows.length
              ? [...quranRows, ...hadithRows]
              : rows.slice(0, 16);

            return mixed.map((row): IslamicResult => ({
              domain: row.domain,
              content: row.content,
              citation_ref: row.citation_ref ?? {},
              language: (row.language as "ar" | "en" | "ur") ?? "ar",
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

    // ── Topic-anchor always-merge ────────────────────────────────────────
    // If the user asked about a recognized topic (charity, prayer, etc.),
    // ALWAYS force-fetch the canonical anchor refs and prepend them. The
    // older count-gated logic was a foot-gun: 4 unrelated rows in `allResults`
    // caused needQuran=false → anchors never fired → user got garbage even
    // for canonical-anchored topics. Per Phase 7.3 of the locked plan.
    //
    // Anchors are only inserted when they actually exist in scholarly_documents.
    const anchors = lookupTopicAnchors(query);
    if (anchors) {
      const anchorFetches: Promise<IslamicResult[]>[] = [];

      if (anchors.quran.length > 0) {
        const wanted = anchors.quran.slice(0, 4);
        const filters = wanted.map(
          (a) => `and(citation_ref->>surah_number.eq.${a.surah},citation_ref->>verse.eq.${a.verse})`,
        );
        anchorFetches.push(
          supabase
            .from("scholarly_documents")
            .select("domain, content, content_ar, citation_ref, language, source_type")
            .eq("source_type", "quran")
            .or(filters.join(","))
            .limit(wanted.length)
            .then(({ data, error }) => {
              if (error) { console.error("Topic-anchor Quran fetch error:", error); return []; }
              return (data ?? []).map((row: any): IslamicResult => ({
                domain: row.domain ?? "tanzil",
                content: row.content,
                citation_ref: { ...(row.citation_ref ?? {}), _is_anchor: true },
                language: row.language ?? "ar",
              }));
            })
        );
      }

      if (anchors.hadith.length > 0) {
        // Phase 10.1: each anchor now lists multiple `books` variants because
        // the DB stores hadith book identifiers in different shapes across
        // ingestion paths. Emit one filter clause per (variant, number) and
        // also try the `collection` field. Cap at 30 clauses to keep URL
        // length under PostgREST's limit.
        const wanted = anchors.hadith.slice(0, 6);
        const filters: string[] = [];
        for (const a of wanted) {
          for (const bookName of a.books) {
            filters.push(`and(citation_ref->>book.eq.${bookName},citation_ref->>hadith_number.eq.${a.hadith_number})`);
            filters.push(`and(citation_ref->>collection.eq.${bookName},citation_ref->>hadith_number.eq.${a.hadith_number})`);
            if (filters.length >= 30) break;
          }
          if (filters.length >= 30) break;
        }
        anchorFetches.push(
          supabase
            .from("scholarly_documents")
            .select("domain, content, content_ar, citation_ref, language, source_type")
            .eq("source_type", "hadith")
            .or(filters.join(","))
            .limit(wanted.length)
            .then(({ data, error }) => {
              if (error) { console.error("Topic-anchor Hadith fetch error:", error); return []; }
              return (data ?? []).map((row: any): IslamicResult => ({
                domain: row.domain ?? "hadith-json",
                content: row.content,
                citation_ref: { ...(row.citation_ref ?? {}), _is_anchor: true },
                language: row.language ?? "ar",
              }));
            })
        );
      }

      const extra = (await Promise.all(anchorFetches)).flat();

      // Dedupe against what fan-out already returned.
      const seenKeys = new Set(
        allResults.map((r) => {
          const c = r.citation_ref ?? {};
          return `${c.surah_number ?? ""}:${c.verse ?? ""}|${c.book ?? ""}:${c.hadith_number ?? ""}`;
        }),
      );
      // Prepend in reverse so the FIRST anchor in the array ends up first
      // in the final results list.
      for (let i = extra.length - 1; i >= 0; i--) {
        const e = extra[i];
        const c = e.citation_ref ?? {};
        const k = `${c.surah_number ?? ""}:${c.verse ?? ""}|${c.book ?? ""}:${c.hadith_number ?? ""}`;
        if (!seenKeys.has(k)) {
          seenKeys.add(k);
          allResults.unshift(e);
        }
      }
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

    // Call Gemini direct → Lovable fallback (helper handles auth + URL)
    const geminiRes = await callChatCompletions({
      model: "google/gemini-2.5-flash",
      messages,
      stream: true,
      // Phase 10.2: explicit cap so long Islamic answers (full Arabic
      // quotes + Urdu translations + summaries) don't get cut off at
      // the gateway's conservative default.
      max_tokens: 8192,
    });

    if (!geminiRes.ok) {
      // Refund tokens — AI call failed
      await refundTokens(supabase, user.id, tokenCost, "islamic", "Gemini API error");

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
      let streamFailed = false;
      try {
        while (!done) {
          const { value, done: streamDone } = await reader.read();
          done = streamDone;
          if (value) await writer.write(value);
        }
      } catch (streamErr) {
        console.error("[islamic-search] Stream error:", streamErr);
        streamFailed = true;
      }

      if (streamFailed) {
        // Refund tokens — AI stream failed
        await refundTokens(supabase, user.id, tokenCost, "islamic", "Gemini stream error");
      } else {
        // Legacy analytics: update islamic_queries_used (non-blocking, backward compat)
        supabase
          .from("subscriptions")
          .select("islamic_queries_used")
          .eq("user_id", user.id)
          .single()
          .then(({ data: sub }) => {
            if (sub) {
              supabase
                .from("subscriptions")
                .update({ islamic_queries_used: (sub.islamic_queries_used ?? 0) + 1 })
                .eq("user_id", user.id)
                .then(() => {});
            }
          });
      }

      await writer.close();
    })();

    return new Response(readable, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("islamic-search error:", e);
    // Best-effort refund if tokens were already deducted
    try {
      if (typeof tokenCost !== "undefined" && typeof user !== "undefined") {
        const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        await refundTokens(supabase, user.id, tokenCost, "islamic", "Unhandled error");
      }
    } catch (_) { /* ignore refund errors in crash path */ }
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
