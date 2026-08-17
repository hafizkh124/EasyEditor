import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";
import { calculateCost, checkAndDeductTokens, refundTokens, insufficientTokensResponse } from "../_shared/tokenGuard.ts";
import { expandQueryTerms } from "../_shared/bilingualMap.ts";
import { lookupTopicAnchors } from "../_shared/topicAnchors.ts";
import { planQuery } from "../_shared/queryPlanner.ts";
import { personalVectorChannel, personalLexicalChannel } from "../_shared/citationEngine.ts";
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
//
// "hadith-api" and "tanzil" were listed here but never actually reach live
// data: `islamic-api-fetch/index.ts` only implements dorar/alquran/quran-com
// — there is no fetchHadithApi or fetchTanzil, so requesting either slug was
// silently a no-op (confirmed live, 2026-08-16: both return 0 results in
// ~300ms regardless of query — too fast to be a real network call). Removed
// rather than left as dead weight. Tanzil's actual content still reaches
// every query through Tier K (`tanzil` stays in TIER_K_DOMAINS below, backed
// by the 6,236-row local corpus) — nothing is lost by dropping it here.
const TIER_A_DOMAINS = ["dorar", "alquran", "quran-com"];
const TIER_B_DOMAINS = ["hadith-index", "shamela-index", "openiti-index"];
const TIER_C_DOMAINS = [
  "islamqa", "islamweb", "islamicurdubooks", "shamilaurdu",
  "alulama", "magazine-mohaddis", "mohaddis", "urdufatwa",
  "islamfort", "alminasa", "shamela",
];

const TIER_K_DOMAINS = ["tanzil", "hadith-json"];
const ALL_DOMAINS = [...TIER_A_DOMAINS, ...TIER_B_DOMAINS, ...TIER_C_DOMAINS, ...TIER_K_DOMAINS];

// Surah names by number — used to fill a clean reference when a retrieved row
// (typically a Tier-A API result) has an empty surah_name. The local tanzil
// corpus populates surah_name itself; this is the fallback for the rest.
const SURAH_NAMES: Record<number, string> = {
  1: "Al-Fatihah", 2: "Al-Baqarah", 3: "Aal-E-Imran", 4: "An-Nisa", 5: "Al-Maidah",
  6: "Al-Anam", 7: "Al-Araf", 8: "Al-Anfal", 9: "At-Tawbah", 10: "Yunus",
  11: "Hud", 12: "Yusuf", 13: "Ar-Rad", 14: "Ibrahim", 15: "Al-Hijr",
  16: "An-Nahl", 17: "Al-Isra", 18: "Al-Kahf", 19: "Maryam", 20: "Ta-Ha",
  21: "Al-Anbiya", 22: "Al-Hajj", 23: "Al-Muminun", 24: "An-Nur", 25: "Al-Furqan",
  26: "Ash-Shuara", 27: "An-Naml", 28: "Al-Qasas", 29: "Al-Ankabut", 30: "Ar-Rum",
  31: "Luqman", 32: "As-Sajdah", 33: "Al-Ahzab", 34: "Saba", 35: "Fatir",
  36: "Ya-Sin", 37: "As-Saffat", 38: "Sad", 39: "Az-Zumar", 40: "Ghafir",
  41: "Fussilat", 42: "Ash-Shura", 43: "Az-Zukhruf", 44: "Ad-Dukhan", 45: "Al-Jathiyah",
  46: "Al-Ahqaf", 47: "Muhammad", 48: "Al-Fath", 49: "Al-Hujurat", 50: "Qaf",
  51: "Adh-Dhariyat", 52: "At-Tur", 53: "An-Najm", 54: "Al-Qamar", 55: "Ar-Rahman",
  56: "Al-Waqiah", 57: "Al-Hadid", 58: "Al-Mujadila", 59: "Al-Hashr", 60: "Al-Mumtahanah",
  61: "As-Saf", 62: "Al-Jumuah", 63: "Al-Munafiqun", 64: "At-Taghabun", 65: "At-Talaq",
  66: "At-Tahrim", 67: "Al-Mulk", 68: "Al-Qalam", 69: "Al-Haqqah", 70: "Al-Maarij",
  71: "Nuh", 72: "Al-Jinn", 73: "Al-Muzzammil", 74: "Al-Muddaththir", 75: "Al-Qiyamah",
  76: "Al-Insan", 77: "Al-Mursalat", 78: "An-Naba", 79: "An-Naziat", 80: "Abasa",
  81: "At-Takwir", 82: "Al-Infitar", 83: "Al-Mutaffifin", 84: "Al-Inshiqaq", 85: "Al-Buruj",
  86: "At-Tariq", 87: "Al-Ala", 88: "Al-Ghashiyah", 89: "Al-Fajr", 90: "Al-Balad",
  91: "Ash-Shams", 92: "Al-Layl", 93: "Ad-Duha", 94: "Ash-Sharh", 95: "At-Tin",
  96: "Al-Alaq", 97: "Al-Qadr", 98: "Al-Bayyinah", 99: "Az-Zalzalah", 100: "Al-Adiyat",
  101: "Al-Qariah", 102: "At-Takathur", 103: "Al-Asr", 104: "Al-Humazah", 105: "Al-Fil",
  106: "Quraysh", 107: "Al-Maun", 108: "Al-Kawthar", 109: "Al-Kafirun", 110: "An-Nasr",
  111: "Al-Masad", 112: "Al-Ikhlas", 113: "Al-Falaq", 114: "An-Nas",
};

function buildContextBlock(results: IslamicResult[]): string {
  if (results.length === 0) return "\n\n[No Islamic sources were retrieved for this query. If you have general knowledge about this topic, clearly state that it comes from general knowledge, not from verified sources.]";

  return "\n\n⚡ RETRIEVED SOURCES (" + results.length + " total):\n\n" + results.map((r, i) => {
    const cite = r.citation_ref;
    // Clean, human-readable reference line. Deliberately NOT a JSON-object
    // shape: the old `CITATION_REF: { ... }` format tempted the model to copy
    // the raw braces (and empty fields) verbatim into its References section.
    let citeLine = "";

    if (r.domain === "dorar" || r.domain === "hadith-api" || r.domain === "hadith-index" || r.domain === "hadith-json" || r.domain === "islamicurdubooks" || r.domain === "shamilaurdu" || cite.hadith_number !== undefined) {
      // `cite.hadith_number !== undefined` as a fallback (mirrors the fatwa
      // branch below): urdu-hadith rows carry real grade + takhreej data —
      // 19,443 of them, e.g. grade "صحيح" with a full cross-reference chain
      // ("تفرد بہ ابن ماجہ، تحفة الأشراف: 3815…") — but the domain name
      // wasn't in this list, so that scholarship never reached the model.
      const book = cite.collection ?? cite.book ?? "Hadith";
      const parts = [
        `${book}${cite.hadith_number ? `, Hadith ${cite.hadith_number}` : ""}`,
        cite.grade ? `Grade: ${cite.grade}` : "",
        cite.rawi ? `Narrator: ${cite.rawi}` : "",
        cite.takhreej ? `Takhreej: ${cite.takhreej}` : "",
      ].filter(Boolean);
      citeLine = `REFERENCE: ${parts.join(" — ")}`;
    } else if (r.domain === "alquran" || r.domain === "quran-com" || r.domain === "tanzil") {
      const num = Number(cite.surah_number) || 0;
      const name = cite.surah_name || SURAH_NAMES[num] || (num ? `Surah ${num}` : "Quran");
      citeLine = `REFERENCE: Quran — ${name} ${num || "?"}:${cite.verse ?? "?"}`;
    } else if (r.domain === "islamqa" || r.domain === "islamweb" || r.domain === "dar-alifta" || r.domain === "urdufatwa" || cite.fatwa_number !== undefined) {
      const site = cite.url ? new URL(cite.url).hostname : r.domain;
      const parts = [
        `Fatwa (${site})`,
        cite.fatwa_number ? `No. ${cite.fatwa_number}` : "",
        cite.scholar ? `Scholar: ${cite.scholar}` : "",
      ].filter(Boolean);
      citeLine = `REFERENCE: ${parts.join(" — ")}`;
    } else {
      const parts = [
        cite.title ?? cite.book ?? r.domain,
        cite.author ? `by ${cite.author}` : "",
        cite.volume ? `vol. ${cite.volume}` : "",
        cite.page ? `p. ${cite.page}` : "",
      ].filter(Boolean);
      citeLine = `REFERENCE: ${parts.join(", ")}`;
    }

    // Include both Arabic and English content when available
    const content = r.content;
    // Anchor passages (see topic-anchor merge below) are canonical
    // references for a recognized topic, not something the search actually
    // found relevant to THIS query — label them so the model doesn't cite
    // them as if retrieval surfaced them on merit.
    const sourceTag = cite._is_anchor
      ? `[${r.domain.toUpperCase()} — CANONICAL TOPIC REFERENCE, not a search match]`
      : `[${r.domain.toUpperCase()}]`;
    return `--- Islamic Source ${i + 1} ${sourceTag} ---\n${citeLine}\n${content}`;
  }).join("\n\n");
}

function buildSystemPrompt(contextBlock: string, strictMode: boolean, hasCountFacts = false): string {
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
${hasCountFacts ? `6. An EXACT_COUNT_FACTS block IS a provided source, on the same footing as RETRIEVED SOURCES. Once you have used it to state a number anywhere in your answer, do NOT also say "the sources don't mention/discuss this" — that directly contradicts the number you just gave. If EXACT_COUNT_FACTS covers the question, the sources DID cover it.` : ""}

ANSWER STRUCTURE — USE THIS EXACT FORMAT:

## 📝 جواب / Answer
Start with a clear, concise answer to the question (2-3 sentences).
${hasCountFacts ? `Lead with the exact figure from EXACT_COUNT_FACTS.` : ""}
${hasCountFacts ? `
## 📖 قرآنی دلائل / Quranic Evidence
EXACT_COUNT_FACTS gives you a NUMBER, not verse text — it cannot supply Arabic
quotes. So: if RETRIEVED SOURCES also contains actual Quran passages, quote
2-3 of them as illustrative examples. If it contains none, SKIP this section
entirely (omit the heading) rather than writing "no evidence found" — that
would contradict the count you already gave in the Answer section.

## 📜 احادیث / Hadith Evidence
Same rule: quote Hadith passages only if RETRIEVED SOURCES actually has them.
Otherwise skip this section entirely — do not write "no evidence" here either.
` : `
## 📖 قرآنی دلائل / Quranic Evidence
(Skip this section if no Quran sources are relevant)
- Quote the Arabic verse with full diacritics
- Provide translation immediately after
- Cite it inline as [N], the RETRIEVED SOURCES index number (see CITATION RULES)

## 📜 احادیث / Hadith Evidence
(Skip this section if no Hadith sources are relevant)
- Quote the hadith text (Arabic if available, then translation)
- Cite it inline as [N], the RETRIEVED SOURCES index number (see CITATION RULES)
- Include narrator and grade if available
`}
## 🧾 خلاصہ / Summary
A brief 2-3 sentence summary tying the evidence together.

Do NOT add a "References" / "حوالہ جات" section yourself, and do not end the
answer with a numbered source list. The app appends one automatically, built
directly from the same RETRIEVED SOURCES data you were given — matched to the
[N] numbers you cited inline. A model-typed references list has repeatedly
disagreed with the model's own inline citations (e.g. "Hadith 3" in the body
text vs "Hadith 5251" in the list below it) because both were separately
hand-written from the same context instead of read from one place. Ending
your answer after the Summary section avoids that failure entirely.

CITATION RULES:
- Cite using ONLY the RETRIEVED SOURCES index number in square brackets — [1],
  [2], etc. — matching the "--- Islamic Source N ---" numbering above. Do NOT
  type a book name, hadith number, surah:verse, or any other citation text
  inside the brackets; the app renders the real, verified reference for that
  number, so a hand-typed citation can silently drift from the source it is
  attached to.
- Every factual claim MUST have at least one inline [N] citation.
- When quoting Arabic text, cite [N] immediately after.
- Use exact text from sources — do not paraphrase Arabic verses or hadith text.
- A source marked "CANONICAL TOPIC REFERENCE, not a search match" was added
  as general background on the topic, not because retrieval found it
  specifically relevant to this question — you may still cite it as [N], but
  do not describe it as something the search "found" or "returned" for this
  query specifically.

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

  // ── Stage timing ────────────────────────────────────────────────────
  // Latency work on this function has repeatedly been done against numbers
  // that turned out to be measuring the wrong thing — a "15s" figure taken
  // while two of four retrieval tiers weren't running, and later a ~13s
  // client-vs-server gap (2026-08-17) that turned out to be hiding in
  // auth.getUser and the subscriptions lookup below, which used to run
  // before any timing existed at all. Started at true handler entry (right
  // after the OPTIONS short-circuit) so nothing before the first byte is
  // sent can hide from it again.
  //
  // Every stage is logged unconditionally (so Supabase's function logs carry
  // it for any real user request), and additionally returned in the
  // `sources_ready` event when the caller passes `debugTiming` — the response
  // shape is otherwise unchanged, so normal clients see nothing new.
  const reqStart = performance.now();
  const stages: Array<{ stage: string; startMs: number; endMs: number; ms: number; count?: number; error?: string }> = [];
  const since = () => Math.round(performance.now() - reqStart);

  /** Records a stage's own window without altering the promise's behaviour. */
  const timed = async <T>(stage: string, p: Promise<T>, countOf?: (v: T) => number): Promise<T> => {
    const startMs = since();
    try {
      const v = await p;
      stages.push({ stage, startMs, endMs: since(), ms: since() - startMs, count: countOf?.(v) });
      return v;
    } catch (e) {
      stages.push({ stage: `${stage} (failed)`, startMs, endMs: since(), ms: since() - startMs });
      throw e;
    }
  };

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
    const { data: { user }, error: authError } = await timed("auth:getUser", supabase.auth.getUser(token));
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
    const { data: sub } = await timed(
      "db:subscriptionTier",
      supabase
        .from("subscriptions")
        .select("tier, islamic_queries_used, islamic_queries_limit")
        .eq("user_id", user.id)
        .single(),
    );

    const tier = sub?.tier ?? "free";

    const { query, selectedDomains, chatHistory, strictMode, debugTiming } = await req.json();

    if (!query) {
      return new Response(JSON.stringify({ error: "Query is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Token-based quota check: 40 tokens per Islamic research query
    const tokenCost = calculateCost("islamic", 1);
    const tokenResult = await timed(
      "db:checkAndDeductTokens",
      checkAndDeductTokens(supabase, user.id, tokenCost, "islamic", `Islamic query: ${query.slice(0, 60)}`),
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

    // Plan the query — an LLM call, reused by Tier K (term expansion + scope)
    // and, for "how many times…" questions, by the exact-count block below.
    // Never throws — degrades to a keyword-only plan when the model is down.
    //
    // Deliberately NOT awaited here. Tier A/B/C don't read the plan at all,
    // and awaiting it before starting the fan-out serialized this LLM call's
    // latency (typically 1-4s) in front of every other tier's, adding
    // straight to the user's wait with nothing running concurrently. Tier K
    // is the only consumer — its own async block below awaits this promise
    // internally, so the plan call now overlaps with Tier A/B/C instead of
    // blocking them.
    const queryPlanPromise = timed("planQuery", planQuery(query, supabase).catch(() => null));

    // --- Fan-out: Tier A (always), Tier B (Pro/Ultra), Tier C (Pro/Ultra), Tier K (keyword) ---
    const tierADomains = effectiveDomains.filter((d) => TIER_A_DOMAINS.includes(d));
    const tierBDomains = effectiveDomains.filter((d) => TIER_B_DOMAINS.includes(d));
    const tierCDomains = effectiveDomains.filter((d) => TIER_C_DOMAINS.includes(d));
    const tierKDomains = effectiveDomains.filter((d) => TIER_K_DOMAINS.includes(d));

    const fanOutPromises: Promise<IslamicResult[]>[] = [];

    /**
     * Adds a retrieval branch and records its own start/end window. Every tier
     * goes through here so the log shows which one the user is actually waiting
     * on — they run concurrently, so total elapsed time alone cannot tell you.
     */
    const pushTimed = (stage: string, p: Promise<IslamicResult[]>) => {
      fanOutPromises.push(timed(stage, p, (v) => v.length));
    };

    // Tier A: call islamic-api-fetch
    if (tierADomains.length > 0) {
      const apiFetchUrl = `${supabaseUrl}/functions/v1/islamic-api-fetch`;
      pushTimed("tierA:islamic-api-fetch",
        fetch(apiFetchUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseKey}`,
            apikey: supabaseKey,
          },
          body: JSON.stringify({ query, selectedDomains: tierADomains }),
          // Was 12s. Live-measured 2026-08-16 (post dead-domain cleanup —
          // dorar/alquran/quran-com only): worst case ~4s. 6s keeps a real
          // safety margin without eating into the user's wait for nothing.
          signal: AbortSignal.timeout(6_000),
        })
          .then((r) => r.ok ? r.json() : { results: [] })
          .then((d) => d.results ?? [])
          .catch(() => [])
      );
    }

    // Tier B: call vector-search (available to all — requires scholarly_documents populated)
    if (tierBDomains.length > 0) {
      const vectorUrl = `${supabaseUrl}/functions/v1/vector-search`;
      pushTimed("tierB:vector-search",
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
          // Was 20s ("embedding + RPC needs more time"). Live-measured
          // 2026-08-16 after the IVFFlat fix: full embed+RPC round trip
          // ~2-2.6s. 8s keeps ~3x margin for embedding-API slowness.
          signal: AbortSignal.timeout(8_000),
        })
          .then((r) => r.ok ? r.json() : { results: [] })
          .then((d) => d.results ?? [])
          .catch(() => [])
      );
    }

    // Tier C: call domain-scrape (live fatwa scraping — available to all)
    if (tierCDomains.length > 0) {
      const scrapeUrl = `${supabaseUrl}/functions/v1/domain-scrape`;
      pushTimed("tierC:domain-scrape",
        fetch(scrapeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseKey}`,
            apikey: supabaseKey,
          },
          body: JSON.stringify({ query, selectedDomains: tierCDomains }),
          // Was 12s, which never matched domain-scrape's own internal 25s
          // per-domain Firecrawl budget — this caller-side timeout always
          // won first regardless. Live-measured 2026-08-16 (all 11 Tier-C
          // domains fanned out together): 5.1s and 6.9s on two real runs.
          // 8s keeps a margin without reintroducing the mismatch at a new size.
          signal: AbortSignal.timeout(8_000),
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
      ["dorar", "hadith-index", "hadith-json", "islamicurdubooks", "shamilaurdu"].includes(d),
    );
    // Same inference for fatwa: selecting any Tier-C fatwa site should also
    // search the local `source_type = 'fatwa'` rows. urdufatwa alone has
    // 22,775 of them (fully diacritic-normalized, with grading/discipline
    // metadata) sitting unused before this — Tier C would live-scrape
    // urdufatwa.com on every query instead of ever touching its own DB rows.
    const wantsFatwa = effectiveDomains.some((d) =>
      ["islamqa", "islamweb", "alulama", "urdufatwa"].includes(d),
    );
    if (wantsQuran || wantsHadith || wantsFatwa) {
      pushTimed("tierK:local-keyword",
        (async (): Promise<IslamicResult[]> => {
          try {
            const sourceTypes: string[] = [];
            if (wantsQuran)  sourceTypes.push("quran");
            if (wantsHadith) sourceTypes.push("hadith");
            if (wantsFatwa)  sourceTypes.push("fatwa");
            if (sourceTypes.length === 0) return [];

            // Waits on the plan promise kicked off above — by now it has
            // been running concurrently with Tier A/B/C, not blocking them.
            const queryPlan = await queryPlanPromise;

            // Build expanded term list — bilingual synonyms plus the query
            // planner's Arabic surface forms. The static map covers ~50 topics;
            // the planner generalizes to anything else (and falls back to the
            // map by itself when the model is unavailable).
            // Normalization (diacritics + letter variants) happens server-side
            // in the RPC, so raw Urdu / Arabic / English terms are fine here.
            const expanded = [...new Set([
              ...expandQueryTerms(query),
              ...(queryPlan?.arabic_surface_forms ?? []),
              ...(queryPlan?.related_concepts ?? []),
            ])];
            // Cap to a sensible upper bound so the SQL UNNEST stays small.
            const terms = expanded.slice(0, 12);

            // When the user named specific books ("صحیح بخاری میں..."), use the
            // scoped RPC so the local corpus honours that restriction. Without
            // a collection scope, stay on search_documents_smart — it also
            // matches `content`, which picks up English-side hits the
            // content_ar-only scoped search would miss.
            const planCollections = queryPlan?.scope.collections ?? [];
            const usingScoped = planCollections.length > 0;

            // A live measurement (2026-08-17) found Tier K taking 8.8s alone —
            // more than every other tier combined — while returning 0 rows, on
            // a query that should have real hadith/quran matches. That is
            // exactly the shape of the R2پ regression this project already hit
            // once (a correlated-subquery pattern that defeats the trigram
            // index for some term/source_type combinations but not others; see
            // 20260816000000_fix_search_smart_index_usage.sql). The RPC's own
            // `error` was only ever logged server-side via console.error,
            // invisible to whoever is trying to diagnose a *slow, empty*
            // result rather than a thrown exception — so it is recorded as its
            // own stage here, with the row count and any error message, to
            // tell a real timeout apart from a genuinely fast empty search.
            const rpcStart = since();
            const { data, error } = usingScoped
              ? await supabase.rpc("search_documents_scoped", {
                  p_patterns:     terms,
                  p_source_types: sourceTypes,
                  p_collections:  planCollections,
                  p_surah:        queryPlan?.scope.surah ?? null,
                  p_limit:        30,
                })
              : await supabase.rpc("search_documents_smart", {
                  p_terms:        terms,
                  p_source_types: sourceTypes,
                  p_match_limit:  30,
                });
            stages.push({
              stage: `tierK:rpc(${usingScoped ? "search_documents_scoped" : "search_documents_smart"}, ${sourceTypes.join("+")}, ${terms.length} terms)`,
              startMs: rpcStart,
              endMs: since(),
              ms: since() - rpcStart,
              count: data?.length ?? 0,
              error: error ? `${error.code ?? ""} ${error.message ?? String(error)}`.trim() : undefined,
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

            // Balanced mix: 6 Quran + 10 Hadith + 6 Fatwa max (Hadith corpus is
            // much larger so we let it dominate when several types are present).
            const quranRows  = rows.filter((r) => r.source_type === "quran").slice(0, 6);
            const hadithRows = rows.filter((r) => r.source_type === "hadith").slice(0, 10);
            const fatwaRows  = rows.filter((r) => r.source_type === "fatwa").slice(0, 6);
            const presentGroups = [quranRows, hadithRows, fatwaRows].filter((g) => g.length > 0);
            const mixed = presentGroups.length > 1
              ? presentGroups.flat()
              : rows.slice(0, 22);

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

    // Tier L: the user's own personal library (library_chunks) — books they
    // uploaded via the Library panel. Reuses citationEngine.ts's existing,
    // already-correct personal-corpus channels (vector + lexical) rather than
    // duplicating that retrieval logic; those channels already scope strictly
    // to `filter_user_id: user.id` in SQL, so a service-role client here is
    // safe (see migration 20260728000005's fail-closed fix). Runs for every
    // authenticated query — no domain checklist entry, no opt-in, matching
    // ADR-0002's "no domain checklist" philosophy: a scholar's own uploaded
    // books are simply part of what "search everything" means now. This is
    // what replaced the old, throwaway "Custom Sources" chat mode — uploads
    // now live permanently in the Library and are searched here automatically
    // instead of needing a separate mode and a one-off upload each session.
    pushTimed("tierL:personal-library",
      (async (): Promise<IslamicResult[]> => {
        try {
          const plan = await queryPlanPromise;
          const effectivePlan = plan ?? {
            intent: "topical" as const,
            scope: { source_types: [], collections: [], surah: null, disciplines: [] },
            arabic_surface_forms: [],
            related_concepts: [],
            semantic_query_ar: query,
            is_proper_noun: false,
          };
          const [vecRows, lexRows] = await Promise.all([
            personalVectorChannel(supabase, effectivePlan, query, user.id),
            personalLexicalChannel(supabase, query, user.id),
          ]);
          const seen = new Set<string>();
          const merged: IslamicResult[] = [];
          for (const row of [...vecRows, ...lexRows]) {
            if (seen.has(row.match_key)) continue;
            seen.add(row.match_key);
            merged.push({
              domain: row.domain,
              content: row.content,
              citation_ref: row.citation_ref,
              language: (row.language as "ar" | "en" | "ur") ?? "ur",
            });
            if (merged.length >= 8) break;
          }
          return merged;
        } catch (e) {
          console.error("Tier L (personal library) error:", e);
          return [];
        }
      })()
    );

    const fanOutStart = since();
    const settled = await Promise.allSettled(fanOutPromises);
    stages.push({ stage: "fanOut(all tiers)", startMs: fanOutStart, endMs: since(), ms: since() - fanOutStart });
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
      const anchorsStart = since();
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
      stages.push({
        stage: `topicAnchors:fetch(${anchors.quran.length}q+${anchors.hadith.length}h anchors)`,
        startMs: anchorsStart,
        endMs: since(),
        ms: since() - anchorsStart,
        count: extra.length,
      });

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

    // Fill a missing surah_name on Quran rows (common on Tier-A API results)
    // so BOTH the model context AND the client citation panel show a name
    // instead of a blank. Mutates in place — allResults feeds both paths.
    for (const r of allResults) {
      const c = r.citation_ref;
      if (c && (c.surah_number != null) && !c.surah_name) {
        const nm = SURAH_NAMES[Number(c.surah_number)];
        if (nm) c.surah_name = nm;
      }
    }

    const contextBlockStart = since();
    const contextBlock = buildContextBlock(allResults);
    stages.push({
      stage: "buildContextBlock",
      startMs: contextBlockStart,
      endMs: since(),
      ms: since() - contextBlockStart,
      count: allResults.length,
    });

    // By now the fan-out (line ~506's Promise.allSettled) has already taken
    // at least as long as the slowest tier, so this promise — kicked off
    // concurrently with that fan-out — has almost always already settled;
    // this await adds no meaningful wait in the common case.
    const queryPlan = await queryPlanPromise;

    // ── Exact-count facts ────────────────────────────────────────────────
    // When the user asks "how many times…", retrieval alone cannot answer —
    // the model only sees a sample of passages, so it (correctly) says it has
    // no statistic. Here we run the exact SQL aggregation and hand the model
    // the real number + per-surah/per-book breakdown, so it can state the
    // count instead of declining. Counting lives in count_term_occurrences
    // (migration 20260723210000) — the same function the Editor's reference
    // search uses. Non-fatal: any failure just omits the block.
    // Guard: a "degraded" plan came from the keyword fallback (planQuery's
    // model call failed or returned nothing usable), not the LLM planner. Its
    // arabic_surface_forms can be raw leftover words from the user's Urdu
    // sentence rather than actual surface forms of ONE specific term (seen in
    // practice: "پانی اور زمین کتنی بار؟" degraded to surface_forms containing
    // "قرآن، کریم، کتنی، بار، ہے؟" — count_term_occurrences then summed
    // occurrences of ALL of those unrelated words into one bogus "58 times").
    // A wrong confident number is worse than an honest "I don't have that
    // statistic", so count facts are only trusted from a real plan.
    let countBlock = "";
    if (queryPlan?.intent === "count" && !queryPlan.degraded && queryPlan.arabic_surface_forms.length > 0) {
      const countStart = since();
      try {
        const { data: countRows, error: countErr } = await supabase.rpc("count_term_occurrences", {
          p_patterns:                 queryPlan.arabic_surface_forms,
          p_source_types:             queryPlan.scope.source_types.length > 0 ? queryPlan.scope.source_types : null,
          p_collections:              queryPlan.scope.collections.length > 0 ? queryPlan.scope.collections : null,
          p_surah:                    queryPlan.scope.surah,
          p_exclude_definite_article: queryPlan.is_proper_noun,
        });
        stages.push({
          stage: "countBlock:rpc(count_term_occurrences)",
          startMs: countStart,
          endMs: since(),
          ms: since() - countStart,
          count: Array.isArray(countRows) ? countRows.length : 0,
          error: countErr ? `${countErr.code ?? ""} ${countErr.message ?? String(countErr)}`.trim() : undefined,
        });
        if (!countErr && Array.isArray(countRows) && countRows.length > 0) {
          const total = countRows.reduce((s: number, r: any) => s + (Number(r.occurrences) || 0), 0);
          const rowsMatched = countRows.reduce((s: number, r: any) => s + (Number(r.rows_matched) || 0), 0);
          const breakdown = countRows
            .slice(0, 40)
            .map((r: any) => `  - ${r.bucket_label}: ${r.occurrences}`)
            .join("\n");
          const hasHadith = queryPlan.scope.source_types.includes("hadith");
          const caveats = [
            `یہ گنتی ان الفاظ پر ہوئی: ${queryPlan.arabic_surface_forms.join("، ")}`,
            hasHadith ? "احادیث کا متن سند (اسناد) سمیت محفوظ ہے، اس لیے سند کے الفاظ بھی شمار ہوتے ہیں۔ نیز ہمارے ذخیرے میں ١٧ کتبِ حدیث ہیں — گنتی انہی کی ہے۔" : "",
            queryPlan.is_proper_noun ? "چونکہ یہ اسمِ علم ہے، «ال» کے ساتھ آنے والی صورتیں شمار سے خارج کی گئی ہیں۔" : "",
          ].filter(Boolean).join(" ");

          countBlock =
            `\n\n🔢 EXACT_COUNT_FACTS (computed directly over the full corpus — AUTHORITATIVE, use these numbers verbatim):\n` +
            `Total occurrences: ${total}\n` +
            `Distinct passages containing it: ${rowsMatched}\n` +
            `Breakdown by ${hasHadith ? "book" : "surah"}:\n${breakdown}\n` +
            `Caveats to state to the user: ${caveats}\n` +
            `INSTRUCTION: The user asked HOW MANY TIMES. Lead your answer with the exact total (${total}) as a definitive figure — do NOT say the sources lack a statistic. Present the breakdown, then the caveats. This count IS authoritative.`;
        }
      } catch (e) {
        console.error("[islamic-search] count block failed:", e);
      }
    }

    // Emit SSE "sources ready" event — genuinely before Gemini starts this
    // time. The comment here used to say that while the code below it
    // awaited callChatCompletions() first — for a ~48-source context block,
    // that call alone can take 10+ seconds before Gemini emits its first
    // byte, and the client saw nothing at all until it returned. The fix:
    // commit to the SSE stream and write sources_ready immediately; the
    // Gemini call (and its error handling) moves inside the async block
    // below, after sources_ready has already reached the client. A Gemini
    // failure past this point can no longer become a fresh JSON error
    // response (the 200 + text/event-stream headers are already committed),
    // so it's reported as an in-stream `{"type":"error"}` event instead —
    // see streamIslamicQuery's onError handling in src/lib/research/streamers.ts.
    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    const citationSummaries = allResults.map((r) => ({
      domain:       r.domain,
      citation_ref: r.citation_ref,
      url:          r.citation_ref.url ?? undefined,
    }));

    // Everything above is what the user waits through before a single byte is
    // sent, so this is the number that matters — logged for every request.
    stages.push({ stage: "→ sources_ready (user sees first output)", startMs: 0, endMs: since(), ms: since() });
    console.log("[islamic-search] timing", JSON.stringify({
      query: query.slice(0, 60),
      totalToSourcesReadyMs: since(),
      sources: allResults.length,
      stages: [...stages].sort((a, b) => b.ms - a.ms),
    }));

    (async () => {
      try {
        const sourcesEvent = `data: ${JSON.stringify({
          type:      "sources_ready",
          count:     allResults.length,
          domains:   [...new Set(allResults.map((r) => r.domain))],
          citations: citationSummaries,
          // Present only when asked for, so the normal response shape is
          // untouched for real clients.
          ...(debugTiming ? { timing: { totalMs: since(), stages } } : {}),
        })}\n\n`;
        await writer.write(encoder.encode(sourcesEvent));

        // Build Gemini messages. The count block (when present) is appended
        // to the grounding context so the model answers the "how many
        // times" question with the authoritative figure rather than
        // declining.
        const messages: any[] = [
          { role: "system", content: buildSystemPrompt(contextBlock + countBlock, strictMode ?? true, countBlock.length > 0) },
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
          await refundTokens(supabase, user.id, tokenCost, "islamic", "Gemini API error");
          const errTxt = await geminiRes.text().catch(() => "");
          console.error("Gemini error:", geminiRes.status, errTxt);
          const message = geminiRes.status === 429
            ? "Rate limit exceeded. Please try again shortly."
            : "AI service error";
          await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "error", message })}\n\n`));
          return;
        }

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
      } catch (e) {
        console.error("[islamic-search] streaming pipeline error:", e);
        try {
          await refundTokens(supabase, user.id, tokenCost, "islamic", "Streaming pipeline error");
        } catch { /* best-effort */ }
        try {
          await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "error", message: "AI service error" })}\n\n`));
        } catch { /* stream may already be closed */ }
      } finally {
        await writer.close();
      }
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
