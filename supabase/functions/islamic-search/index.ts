import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";
import { TOKEN_COSTS, calculateCost, checkAndDeductTokens, refundTokens, insufficientTokensResponse } from "../_shared/tokenGuard.ts";
import { expandQueryTerms } from "../_shared/bilingualMap.ts";
import { lookupTopicAnchors } from "../_shared/topicAnchors.ts";
import { planQuery } from "../_shared/queryPlanner.ts";
import { resolveCollectionSlugs, scopeHasArabicMatn } from "../_shared/collections.ts";
import { resultIdentity, dedupeResults } from "../_shared/resultIdentity.ts";
import { wordByWordChannel } from "../_shared/wordByWord.ts";
import { personalVectorChannel, personalLexicalChannel, classicalChannel } from "../_shared/citationEngine.ts";
import type { IslamicResult } from "../islamic-api-fetch/index.ts";
import { searchTurathCloud, shouldQueryTurath } from "../_shared/turath.ts";
import { callChatCompletions } from "../_shared/aiGateway.ts";
import { fuseAndRerank } from "../_shared/rerank.ts";
import { settleWithGrace } from "../_shared/fanOutGrace.ts";
import { searchInChunks } from "../_shared/chunkedSearch.ts";
import { dropQuranRows, isHadithOnlyPlan } from "../_shared/sourceScope.ts";
import { decryptKey } from "../_shared/providerKeyCrypto.ts";

// Query-time diacritic normalization now lives in the `search_documents_smart`
// Postgres RPC (migration 20260517000000). Tier C (live-scraped sites) was
// removed along with the retired `domain-scrape` / Firecrawl path; this
// function now fans out only to local corpus tiers and third-party APIs.

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
// removed. They can be reinstated in `islamic-api-fetch` once upstream recovers
// or credentials are obtained.
//
// "hadith-api" and "tanzil" were listed here but never actually reach live
// data: `islamic-api-fetch/index.ts` only implements dorar/alquran/quran-com
// — there is no fetchHadithApi or fetchTanzil, so requesting either slug was
// silently a no-op (confirmed live, 2026-08-16: both return 0 results in
// ~300ms regardless of query — too fast to be a real network call). Removed
// rather than left as dead weight. Tanzil's actual content still reaches
// every query through Tier K (`tanzil` stays in TIER_K_DOMAINS below, backed
// by the 6,236-row local corpus) — nothing is lost by dropping it here.
//
// Tier C (live-scraped sites via the retired `domain-scrape` / Firecrawl path)
// was replaced (2026-09-08) by a free DuckDuckGo-search + plain-fetch
// scraper in the same `domain-scrape` function, same wire contract. Exported
// so researchSources.test.ts can import the real wire contract — see
// TESTING-STRATEGY.md §6.
export const TIER_A_DOMAINS = ["dorar", "alquran", "quran-com"];
export const TIER_B_DOMAINS = ["hadith-index", "shamela-index", "openiti-index"];
export const TIER_C_DOMAINS = [
  "islamqa", "islamweb", "islamicurdubooks",
  "alulama", "magazine-mohaddis", "mohaddis", "urdufatwa",
  "islamfort", "alminasa", "shamela",
];

export const TIER_K_DOMAINS = ["tanzil", "hadith-json"];

// Tier D: the Tier-2 classical corpus (rijal/tafsir/lughat/fatwa), scoped by
// citation_ref->>'discipline' rather than by domain — see collections.ts's
// arabicMatn split for the parallel pattern. These pseudo-ids exist only in
// the UI/API contract; the retrieval layer maps each to its discipline via
// classicalChannel in _shared/citationEngine.ts.
//
// Confirmed 2026-08-20 (Corpus Atlas) and 2026-08-23 (live probe):
//   1. Before this Tier existed, rijal (19,616 rows) / tafsir (6,208 rows) /
//      lughat corpora were reachable from NO chat surface at all — not even
//      implicitly. classicalChannel is used only by Editor/refine-text's
//      findCitations(), which islamic-search never calls.
//   2. rijal and tafsir have no content_ar at all — the lexical RPC
//      (search_classical_scoped) can never find them, only the semantic half
//      of classicalChannel can. See that function's comments.
//   3. `classical-fatwa` was added on 2026-08-23, correcting this comment's
//      own earlier claim that fatwa had no ingested rows. That claim was read
//      off DISCIPLINE_DOMAINS, which was itself missing `urdufatwa` — 22,775
//      rows tagged citation_ref.discipline = "fatwa", fully embedded. The
//      corpus was there the whole time; only the mapping was wrong.
//
// fiqh and nahw are still NOT offered: their only domain is `shamela`
// (never ingested — 0 rows). `openiti-index` was a candidate until a live
// audit on 2026-09-04 (ADR-0014 follow-up / ADR-0028): row-level facts —
// 4,780 rows, 0 with `citation_ref.discipline`, 0 with a `tags` key — showed
// it is a work-level catalogue index (one transliterated metadata line per
// work, no page text, embedded only off the stub), so it was removed from
// DISCIPLINE_DOMAINS entirely, not just left unoffered. Offering a
// pseudo-domain that can only return zero rows would repeat the shamela-index
// mistake already avoided in src/lib/research/sources.ts. Both become one-line
// additions here the day a real full-text ingest lands.
export const TIER_D_DOMAINS = ["classical-rijal", "classical-tafsir", "classical-lughat", "classical-fatwa", "classical-mustalah"];
export const TIER_D_DISCIPLINE: Record<string, string> = {
  "classical-rijal": "rijal",
  "classical-tafsir": "tafsir",
  "classical-lughat": "lughat",
  "classical-fatwa": "fatwa",
  // Corpus Atlas finding #6: the اصطلاحاتِ حدیث taxonomy (66 rows) was
  // reachable by NOTHING -- not a single mention anywhere in the edge
  // functions. It is deliberately kept out of ranked search (definitions
  // would crowd real hadith out of top-k), so a discipline channel that fires
  // only on explicit terminology questions is exactly the right shape for it.
  "classical-mustalah": "hadith_term",
};

// Tier T: Turath.io live classical library API (ADR-0054).
export const TIER_T_DOMAINS = ["turath"];

// Tier L limits. Measured live on 2026-10-13 (docs/PHASE0-DIAGNOSIS-URDU.md): a
// single uploaded book ("Tajweedi-Qaida") appeared in 21 of 23 unrelated
// questions — hadith, fiqh, tafsir alike — because the vector half accepted
// anything above cosine 0.35 and the lexical half matched on the first word
// alone. 0.6 is match_library_chunks's own designed default; the ten result
// slots are shared by every tier, so a private library gets at most three.
export const PERSONAL_MIN_SIMILARITY = 0.6;
export const PERSONAL_MAX_ROWS = 3;

/** How long the optional live-scrape tier may outlive the corpus tiers. */
export const TIER_C_GRACE_MS = 1_500;

const ALL_DOMAINS = [
  ...TIER_A_DOMAINS,
  ...TIER_B_DOMAINS,
  ...TIER_C_DOMAINS,
  ...TIER_K_DOMAINS,
  ...TIER_D_DOMAINS,
  ...TIER_T_DOMAINS,
];

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

/** Longest passage sent to the client per source; keeps sources_ready small. */
export const CLIENT_PASSAGE_MAX_CHARS = 1200;

export function passageForClient(content: unknown): string | undefined {
  if (typeof content !== "string") return undefined;
  const text = content.trim();
  if (!text) return undefined;
  return text.length > CLIENT_PASSAGE_MAX_CHARS ? `${text.slice(0, CLIENT_PASSAGE_MAX_CHARS).trimEnd()}…` : text;
}

function buildContextBlock(results: IslamicResult[]): string {
  if (results.length === 0) return "\n\n[No Islamic sources were retrieved for this query. If you have general knowledge about this topic, clearly state that it comes from general knowledge, not from verified sources.]";

  return "\n\n⚡ RETRIEVED SOURCES (" + results.length + " total):\n\n" + results.map((r, i) => {
    const cite = r.citation_ref;
    // Clean, human-readable reference line. Deliberately NOT a JSON-object
    // shape: the old `CITATION_REF: { ... }` format tempted the model to copy
    // the raw braces (and empty fields) verbatim into its References section.
    let citeLine = "";

    if (r.domain === "dorar" || r.domain === "hadith-api" || r.domain === "hadith-index" || r.domain === "hadith-json" || r.domain === "islamicurdubooks" || cite.hadith_number !== undefined) {
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
    } else if (r.domain === "islamicurdubooks-wbw") {
      // Labelled explicitly as a gloss, not as the ayah: the content is a list
      // of per-word meanings, and a model handed it under a bare "Quran —
      // Al-Baqarah 2:255" reference could quote the word list as if it were
      // the verse's translation.
      const num = Number(cite.surah_number) || 0;
      const name = cite.surah_name || SURAH_NAMES[num] || (num ? `Surah ${num}` : "Quran");
      citeLine = `REFERENCE: لفظی ترجمہ (word-by-word gloss) — ${name} ${num || "?"}:${cite.verse ?? "?"}`;
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

/**
 * SPEC M10 §1.1 — the caller no longer sends an explicit اسلامی/عمومی choice;
 * `strictMode` becomes a derived property. Real corpus hits ⇒ strict (STRICT
 * SOURCE MODE, below); zero hits ⇒ referenced (REFERENCED MODE, which already
 * tells the model to answer from general knowledge and mark it 📌 معلومات
 * عامہ). A boolean is still honoured when a caller passes one explicitly —
 * assist-mode internals and any client still on the old wire contract keep
 * working unchanged.
 *
 * Exported and pure so this branch has a real unit test without driving the
 * six-tier retrieval fan-out end-to-end — see arabicMatnFilter.test.ts's
 * file-level comment for why that fan-out is deliberately not mocked wholesale
 * just to exercise one boolean.
 */
export function deriveStrictMode(explicitStrictMode: unknown, resultCount: number): boolean {
  return typeof explicitStrictMode === "boolean" ? explicitStrictMode : resultCount > 0;
}

/**
 * Null when no refund is due — either the caller passed strictMode
 * explicitly (an intentional override, not an auto-degrade) or the derived
 * choice came back strict. Otherwise the islamic/research price difference:
 * a DERIVED "referenced" answer leans on general knowledge rather than the
 * corpus this project owns, so it should cost what a general research query
 * costs (30 tokens), not the islamic-search premium (40) already deducted.
 */
export function autoReferencedRefundAmount(explicitStrictMode: unknown, effectiveStrictMode: boolean): number | null {
  if (typeof explicitStrictMode === "boolean" || effectiveStrictMode) return null;
  return TOKEN_COSTS.islamic - TOKEN_COSTS.research;
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

/**
 * Exported so the request logic is reachable from a test. Everything below
 * used to live inside an anonymous `serve(async (req) => …)`, which left the
 * HTTP layer — validation, auth rejection, error mapping, CORS on error
 * responses — verifiable only by the post-deploy smoke script.
 */
export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    // Must return 200 (not 204) for Supabase CORS preflight to pass
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  // Mirrors of `user`/`tokenCost` below, set once both are known-good, so the
  // crash-path refund in the outer `catch` can see them. `user`/`tokenCost`
  // themselves are declared with `const` inside the `try` block, which
  // block-scopes them out of `catch` entirely — first-contact typechecking
  // (this file had never been imported by name before TESTING-STRATEGY.md
  // P3) caught `Cannot find name 'tokenCost'`/`'user'` in the catch block.
  // At runtime `typeof tokenCost !== "undefined"` there threw a ReferenceError
  // every time, silently swallowed by the refund's own `catch (_) {}` — so a
  // token deducted just before an unhandled error was never refunded; this
  // safety net had never once actually fired.
  let capturedUser: { id: string } | undefined;
  let capturedTokenCost: number | undefined;

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
  // `PromiseLike<T>`, not `Promise<T>`: several callers pass a Postgrest
  // query builder directly (e.g. `.from(...).select(...).single()`), which is
  // thenable but not a real `Promise` — its own `.then()` stays `PromiseLike`
  // rather than promoting to `Promise`, so a stricter parameter type here
  // rejected every one of them at first-contact typechecking (TESTING-STRATEGY.md
  // P3). `await` and `Promise.all`/`allSettled` accept `PromiseLike` natively.
  const timed = async <T>(stage: string, p: PromiseLike<T>, countOf?: (v: T) => number): Promise<T> => {
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
    capturedUser = user;

    // --- Rate limit ---
    if (isRateLimited(user.id, 20, 60_000)) {
      return rateLimitResponse(corsHeaders);
    }

    // `tier` (below) has no effect on this request's behavior today — see the
    // `void tier` a few lines down — so its fetch has nothing to serialize
    // behind. Kick it off alongside body-parsing and only join it with
    // checkAndDeductTokens once we have what that needs (query, tokenCost).
    // Both `subscriptionTier` and `checkAndDeductTokens` need only
    // `user.id`, not each other's result, so they run concurrently instead
    // of the ~1-1.5s of serial DB round-trips this used to cost — caught by
    // Lovable's live timing read of the auth/subscription/token instrumentation
    // added just before this (2026-08-17).
    const subPromise = timed(
      "db:subscriptionTier",
      supabase
        .from("subscriptions")
        .select("tier, islamic_queries_used, islamic_queries_limit")
        .eq("user_id", user.id)
        .single(),
    );

    const { query, selectedDomains, chatHistory, strictMode, debugTiming, requireArabicMatn } = await req.json();

    if (!query) {
      return new Response(JSON.stringify({ error: "Query is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Token-based quota check: 40 tokens per Islamic research query
    const tokenCost = calculateCost("islamic", 1);
    capturedTokenCost = tokenCost;
    const [{ data: sub }, tokenResult] = await Promise.all([
      subPromise,
      timed(
        "db:checkAndDeductTokens",
        checkAndDeductTokens(supabase, user.id, tokenCost, "islamic", `Islamic query: ${query.slice(0, 60)}`),
      ),
    ]);

    const tier = sub?.tier ?? "free";

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
    // Tier K has its own richer inference below (wantsQuran/wantsHadith/wantsFatwa)
    // instead of a strict membership check against TIER_K_DOMAINS — see that
    // block's comment. A `tierKDomains` filtered the same way as the other
    // three tiers was computed here but never read (noUnusedLocals caught it
    // at first-contact typechecking, TESTING-STRATEGY.md P3); removed.

    // The user's Cohere BYOK key (rerank), fetched CONCURRENTLY with the fan-out
    // rather than after it: it is one DB read plus a decrypt, and doing it in the
    // tail put that round-trip on every query's critical path — even for users who
    // have no key. Never rejects: any failure means "no key", i.e. RRF ordering.
    const cohereKeyPromise: Promise<string | undefined> = (async () => {
      try {
        const providerKeySecret = Deno.env.get("PROVIDER_KEY_SECRET");
        if (!providerKeySecret) return undefined;
        const { data: cohereRows } = await supabase
          .from("user_provider_keys")
          .select("encrypted_key")
          .eq("user_id", user.id)
          .eq("provider", "cohere")
          .limit(1);
        if (!cohereRows || cohereRows.length === 0) return undefined;
        return await decryptKey(cohereRows[0].encrypted_key, providerKeySecret);
      } catch {
        return undefined;
      }
    })();

    const fanOutPromises: PromiseLike<IslamicResult[]>[] = [];
    // Parallel to fanOutPromises: which tier each branch is ("tierA", "tierT", …),
    // so the merged list can still tell where a row came from once it is flat.
    const fanOutTiers: string[] = [];

    /**
     * Adds a retrieval branch and records its own start/end window. Every tier
     * goes through here so the log shows which one the user is actually waiting
     * on — they run concurrently, so total elapsed time alone cannot tell you.
     */
    const pushTimed = (stage: string, p: PromiseLike<IslamicResult[]>) => {
      fanOutPromises.push(timed(stage, p, (v) => v.length));
      fanOutTiers.push(stage.split(":")[0]);
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

    // Tier C: call domain-scrape (live fatwa scraping — available to all).
    // Free DuckDuckGo-search + plain-fetch scraper since 2026-09-08 (was
    // Firecrawl-backed); same wire contract, so nothing else here changed.
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
          // 15s caller-side budget, matched to the scraper's own 13s internal
          // wall clock (it bounds every search/fetch step against that
          // deadline and returns partial results). An 8s abort here used to
          // kill the whole Tier C fan-out before any site could answer.
          signal: AbortSignal.timeout(15_000),

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
      ["dorar", "hadith-index", "hadith-json", "islamicurdubooks"].includes(d),
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
            // The plan may have established the user asked for hadith only;
            // Tier K then has no business spending its slots on Qur'an rows.
            const planForScope = await queryPlanPromise;
            if (wantsQuran && !isHadithOnlyPlan(planForScope)) sourceTypes.push("quran");
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
            // `planCollections` holds canonical book IDs (collections.ts);
            // the RPC compares against citation_ref->>'collection', so the IDs
            // have to be expanded to every string the book is stored under.
            const scopedSlugs = resolveCollectionSlugs(planCollections);
            // ...and the scoped RPC only searches content_ar. A scope made up
            // entirely of the tohed-hadith-only books has no Arabic matn
            // anywhere, so scoping there guarantees 0 rows — fall back to the
            // smart search (which matches the Urdu `content` too) and enforce
            // the book scope in TypeScript instead.
            const usingScoped = planCollections.length > 0 && scopeHasArabicMatn(planCollections);

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
            // One big RPC runs its per-term branches serially (~0.35s each,
            // so 9-12 terms = 5-14s). Split across a few parallel calls — see
            // _shared/chunkedSearch.ts for the measurement behind this.
            const { data, error, chunks } = await searchInChunks<any>(terms, 30, (chunkTerms, chunkLimit) =>
              usingScoped
                ? supabase.rpc("search_documents_scoped", {
                    p_patterns:     chunkTerms,
                    p_source_types: sourceTypes,
                    p_collections:  scopedSlugs,
                    p_surah:        queryPlan?.scope.surah ?? null,
                    p_limit:        chunkLimit,
                  })
                : supabase.rpc("search_documents_smart", {
                    p_terms:        chunkTerms,
                    p_source_types: sourceTypes,
                    p_match_limit:  chunkLimit,
                  }));
            stages.push({
              stage: `tierK:rpc(${usingScoped ? "search_documents_scoped" : "search_documents_smart"}, ${sourceTypes.join("+")}, ${terms.length} terms, ${chunks} calls)`,
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

            const allRows = (data ?? []) as Array<{
              domain: string;
              source_type: string;
              content: string;
              content_ar: string;
              citation_ref: any;
              language: string;
              source_url?: string;
              match_score?: number;
            }>;

            // The smart RPC has no collection parameter, so when the user named
            // books it is enforced here — otherwise "صرف ابن حبان میں" would
            // quietly widen back out to the whole corpus.
            const wanted = new Set(scopedSlugs);
            const rows = (!usingScoped && wanted.size > 0)
              ? allRows.filter((r) => {
                  const c = r.citation_ref?.collection ?? r.citation_ref?.book;
                  return typeof c === "string" && wanted.has(c);
                })
              : allRows;

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
              has_matn: typeof row.content_ar === "string" && row.content_ar.trim() !== "",
            }));
          } catch (e) {
            console.error("Tier K error:", e);
            return [];
          }
        })()
      );
    }

    // Tier D: Tier-2 classical corpus (rijal/tafsir/lughat) — see
    // TIER_D_DOMAINS above for why only these three disciplines are offered.
    //
    // Two ways in, both required:
    //   - IMPLICIT: the query planner detected a discipline from the question
    //     itself ("راوی کا حال" → rijal). This is what makes the corpus
    //     reachable at all for the first time — previously classicalChannel
    //     was wired only into findCitations() (Editor/refine-text), which
    //     islamic-search never called.
    //   - EXPLICIT: the user narrowed the source picker to a classical-*
    //     pseudo-domain. Checked against the RAW `selectedDomains` from the
    //     request, not `effectiveDomains` — the latter defaults to every
    //     domain (including these three) when nothing was narrowed, which
    //     would make this indistinguishable from "always run", spending an
    //     embedding call on every single query regardless of topic.
    //
    // Skipped entirely when neither applies, so a plain Quran/Hadith question
    // never pays for the extra RPC + embedding round trip.
    const explicitClassicalIds = Array.isArray(selectedDomains)
      ? selectedDomains.filter((d: string) => TIER_D_DOMAINS.includes(d))
      : [];
    pushTimed("tierD:classical",
      (async (): Promise<IslamicResult[]> => {
        try {
          const plan = await queryPlanPromise;
          const autoDisciplines = plan?.scope.disciplines ?? [];
          const explicitDisciplines = explicitClassicalIds
            .map((d) => TIER_D_DISCIPLINE[d])
            .filter((d): d is string => Boolean(d));
          const disciplines = [...new Set([...autoDisciplines, ...explicitDisciplines])];
          if (disciplines.length === 0 || !plan) return [];

          const rows = await classicalChannel(supabase, plan, {
            source_types: [],
            collections: [],
            surah: null,
            verse: null,
            disciplines,
          });
          return rows.slice(0, 10).map((row): IslamicResult => ({
            domain: row.domain,
            content: row.content,
            citation_ref: row.citation_ref ?? {},
            language: (row.language as "ar" | "en" | "ur") ?? "ur",
            has_matn: typeof row.content_ar === "string" && row.content_ar.trim() !== "",
          }));
        } catch (e) {
          console.error("Tier D (classical) error:", e);
          return [];
        }
      })()
    );

    // Tier W: word-by-word Quran gloss (لفظی ترجمہ), Corpus Atlas finding #6.
    // A keyed fetch, not a search — see _shared/wordByWord.ts for why this
    // corpus must never enter ranked search. Fires only when the query asks
    // for a per-word gloss AND the planner resolved a complete surah+ayah, so
    // an ordinary Quran question costs nothing. No source-picker entry: with
    // no ayah named there is nothing for a checkbox to do, and offering one
    // would imply a browsable corpus that this is not.
    pushTimed("tierW:word-by-word",
      (async (): Promise<IslamicResult[]> => {
        try {
          const plan = await queryPlanPromise;
          const rows = await wordByWordChannel(
            supabase, query, plan?.scope.surah ?? null, plan?.scope.verse ?? null,
          );
          return rows.map((row): IslamicResult => ({
            domain: row.domain,
            content: row.content,
            citation_ref: row.citation_ref ?? {},
            language: (row.language as "ar" | "en" | "ur") ?? "ur",
            // A per-word Urdu gloss, never the ayah's own Arabic wording —
            // must never satisfy an Arabic-matn-only filter.
            has_matn: false,
          }));
        } catch (e) {
          console.error("Tier W (word-by-word) error:", e);
          return [];
        }
      })()
    );

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
            scope: { source_types: [], collections: [], surah: null, verse: null, disciplines: [] },
            arabic_surface_forms: [],
            related_concepts: [],
            semantic_query_ar: query,
            is_proper_noun: false,
          };
          const [vecRows, lexRows] = await Promise.all([
            personalVectorChannel(supabase, effectivePlan, query, user.id, { minSimilarity: PERSONAL_MIN_SIMILARITY }),
            personalLexicalChannel(supabase, query, user.id, { requireAllTerms: true }),
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
              has_matn: typeof row.content_ar === "string" && row.content_ar.trim() !== "",
            });
            if (merged.length >= PERSONAL_MAX_ROWS) break;
          }
          return merged;
        } catch (e) {
          console.error("Tier L (personal library) error:", e);
          return [];
        }
      })()
    );

    // Tier T: Turath.io classical library API (ADR-0054).
    // Indexes ~8,500 classical works. Whether to call it is shouldQueryTurath:
    // the user picked 'turath', or the planner detected one of TURATH_DISCIPLINES
    // (fiqh, fatwa, tafsir, lughat, rijal, nahw — all real Discipline slugs).
    pushTimed("tierT:turath",
      (async (): Promise<IslamicResult[]> => {
        try {
          const plan = await queryPlanPromise;
          if (!shouldQueryTurath(plan?.scope.disciplines ?? [], selectedDomains)) {
            return [];
          }

          return await searchTurathCloud(query, {
            limit: 10,
            signal: AbortSignal.timeout(6_000),
            supabase,
          });
        } catch (e) {
          console.error("Tier T (turath) error:", e);
          return [];
        }
      })()
    );

    // ── Topic-anchor always-merge ────────────────────────────────────────
    // If the user asked about a recognized topic (charity, prayer, etc.),
    // ALWAYS force-fetch the canonical anchor refs and prepend them. The
    // older count-gated logic was a foot-gun: 4 unrelated rows in `allResults`
    // caused needQuran=false → anchors never fired → user got garbage even
    // for canonical-anchored topics. Per Phase 7.3 of the locked plan.
    //
    // Anchors are only inserted when they actually exist in scholarly_documents.
    //
    // The fetches are built here — alongside the tier fan-out, not after it
    // — and awaited together below. `lookupTopicAnchors` only needs `query`,
    // not anything the fan-out returns, so there was never a real reason for
    // this to run serially after fan-out finished; it previously showed up
    // as the largest single serial block (1.4-3.0s) sitting entirely after
    // an already-complete fan-out (caught via Lovable's 2026-08-17 timing
    // read of this file's own instrumentation).
    const anchors = lookupTopicAnchors(query);
    const anchorFetches: PromiseLike<IslamicResult[]>[] = [];
    if (anchors) {
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
                has_matn: typeof row.content_ar === "string" && row.content_ar.trim() !== "",
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
                has_matn: typeof row.content_ar === "string" && row.content_ar.trim() !== "",
              }));
            })
        );
      }
    }

    const fanOutStart = since();
    const anchorsStart = fanOutStart;
    // Tier C (live scraping) is optional: it may take up to 15s and often
    // returns nothing, so it only gets a short grace after every corpus tier
    // has finished (see _shared/fanOutGrace.ts for the measurement).
    const [settled, anchorResultsRaw] = await Promise.all([
      settleWithGrace(fanOutPromises, fanOutTiers.map((t) => t === "tierC"), TIER_C_GRACE_MS),
      Promise.all(anchorFetches),
    ]);
    stages.push({ stage: "fanOut(all tiers)", startMs: fanOutStart, endMs: since(), ms: since() - fanOutStart });
    const rawResults: IslamicResult[] = [];
    // Row -> tier, by object identity. dedupeResults keeps the first occurrence
    // object itself, so the tag survives it; anchors are added later and are
    // pinned by rerank, never grouped.
    const tierOfRow = new Map<IslamicResult, string>();
    settled.forEach((r, i) => {
      if (r.status !== "fulfilled") return;
      for (const row of r.value) tierOfRow.set(row, fanOutTiers[i] ?? "other");
      rawResults.push(...r.value);
    });

    // Collapse the same passage returned by more than one tier. Tier B
    // (pgvector) and Tier K (lexical) read the same table, as do Tier D and
    // Tier K for fatwa rows — without this, a single hadith could occupy two
    // or three of the answer's source slots. First occurrence wins, so the
    // fan-out's tier order still decides which copy the model sees.
    const dedupeStart = since();
    let allResults = dedupeResults(rawResults);
    if (allResults.length !== rawResults.length) {
      // Only recorded when it actually removed something, so the timing log
      // stays a list of things that happened rather than a list of no-ops.
      stages.push({
        stage: `dedupe(cross-tier): ${rawResults.length} -> ${allResults.length}`,
        startMs: dedupeStart,
        endMs: since(),
        ms: since() - dedupeStart,
        count: allResults.length,
      });
    }

    if (anchors) {
      const extra = anchorResultsRaw.flat();
      stages.push({
        stage: `topicAnchors:fetch(${anchors.quran.length}q+${anchors.hadith.length}h anchors)`,
        startMs: anchorsStart,
        endMs: since(),
        ms: since() - anchorsStart,
        count: extra.length,
      });

      // Dedupe anchors against what fan-out already returned, using the same
      // identity as above rather than the weaker ad-hoc key this used to
      // build. That old key ignored `collection` (reading only `book`), so an
      // anchor could be re-inserted alongside the identical corpus row that
      // fan-out had already found — the very duplication anchors are supposed
      // to avoid.
      const seenKeys = new Set(
        allResults.map(resultIdentity).filter((k): k is string => k !== null),
      );
      // Prepend in reverse so the FIRST anchor in the array ends up first
      // in the final results list.
      for (let i = extra.length - 1; i >= 0; i--) {
        const e = extra[i];
        const k = resultIdentity(e);
        // An anchor with no usable identity is still worth showing — it was
        // deliberately curated for this topic.
        if (k === null) { allResults.unshift(e); continue; }
        if (!seenKeys.has(k)) {
          seenKeys.add(k);
          allResults.unshift(e);
        }
      }
    }

    // The planner's scope.source_types was computed but never applied: a
    // hadith-only question still received Tier A's / Tier K's Qur'an rows.
    {
      const scopePlan = await queryPlanPromise;
      const before = allResults.length;
      allResults = dropQuranRows(allResults, scopePlan);
      if (allResults.length !== before) {
        stages.push({
          stage: `filter(hadith-only scope): ${before} -> ${allResults.length}`,
          startMs: dedupeStart,
          endMs: since(),
          ms: 0,
          count: allResults.length,
        });
      }
    }

    // Corpus Atlas finding #7: the corpus's own `language` column can't back
    // an "Arabic only" filter (it records the corpus's declared READING
    // language, not what's in the row — 11 of 14 domains are tagged `ur`,
    // including the fully-Arabic easyquran-hadith). `has_matn`, set by every
    // tier above from its own row's `content_ar`, is the real per-row signal.
    // Applied AFTER the anchor merge so a curated topic reference is held to
    // the same rule as a retrieved one — a scholar who asked for Arabic-only
    // should not have a non-Arabic anchor slipped in underneath it.
    if (requireArabicMatn === true) {
      const before = allResults.length;
      allResults = allResults.filter((r) => r.has_matn === true);
      if (allResults.length !== before) {
        stages.push({
          stage: `filter(arabic-matn-only): ${before} -> ${allResults.length}`,
          startMs: dedupeStart,
          endMs: since(),
          ms: 0,
          count: allResults.length,
        });
      }
    }

    // ADR 0055: Hybrid Reranking with Cohere Multilingual v3.5 (BYOK)
    // Executed AFTER requireArabicMatn filter and BEFORE deriveStrictMode.
    // Anchors are pinned and score (RRF) is preserved for Kifayat Gate.
    const rerankStart = since();
    // Started before the fan-out (see cohereKeyPromise), so by now it is
    // already resolved — a user with no Cohere key pays no extra round-trip here.
    const cohereKey = await cohereKeyPromise;

    // groupOf: without it the cut keeps the FIRST 10 rows in tier order
    // (A,B,C,K,D,W,L,T), so Tier B alone could fill every slot and the personal
    // library, word-by-word, the classical corpus and Turath would never surface.
    allResults = await fuseAndRerank(query, allResults, {
      cohereApiKey: cohereKey,
      maxResults: 10,
      timeoutMs: 2500,
      groupOf: (r) => tierOfRow.get(r) ?? "other",
    });

    stages.push({
      stage: `rerank(cohere:${cohereKey ? "byok" : "rrf-fallback"}): top-${allResults.length}`,
      startMs: rerankStart,
      endMs: since(),
      ms: since() - rerankStart,
      count: allResults.length,
    });

    const effectiveStrictMode = deriveStrictMode(strictMode, allResults.length);

    // Fire-and-forget: this must not add an RPC round-trip before the
    // sources_ready SSE event below, and a failed refund is logged, not
    // fatal (refundTokens already swallows its own errors).
    const autoRefund = autoReferencedRefundAmount(strictMode, effectiveStrictMode);
    if (autoRefund !== null && capturedTokenCost !== undefined) {
      void refundTokens(
        supabase,
        user.id,
        autoRefund,
        "islamic",
        "Auto-degraded to general knowledge (no corpus hits) — refunding the islamic/research price difference",
      );
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
          p_collections:              queryPlan.scope.collections.length > 0 ? resolveCollectionSlugs(queryPlan.scope.collections) : null,
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
      // The passage itself — until now only the label and link reached the
      // client, so a reader could never see (or copy) what was retrieved
      // unless the model happened to quote it.
      content:      passageForClient(r.content),
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
          { role: "system", content: buildSystemPrompt(contextBlock + countBlock, effectiveStrictMode, countBlock.length > 0) },
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
      if (capturedTokenCost !== undefined && capturedUser !== undefined) {
        const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        await refundTokens(supabase, capturedUser.id, capturedTokenCost, "islamic", "Unhandled error");
      }
    } catch (_) { /* ignore refund errors in crash path */ }
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

serve(handle);
