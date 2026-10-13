// Query planner for the shared citation engine.
//
// Turns a free-text user question (typically Urdu, sometimes Arabic/English)
// into a structured retrieval plan. This is the step the citation surfaces
// were missing: previously an Urdu instruction sentence like
// "نیت سے متعلق آیات اور احادیث ذکر کریں" was embedded verbatim and compared
// against Arabic scripture vectors, so most of the embedding's weight sat on
// "سے متعلق / آیات / ذکر کریں" rather than on the actual concept.
//
// The plan answers three questions the retrieval layer needs:
//   1. WHAT is being asked — retrieve passages, or COUNT occurrences?
//   2. WHERE to look — Quran, Hadith, a specific collection, a specific surah?
//   3. WHICH Arabic words to look for — the concept's real surface forms
//      (نية / نيات / بالنيات / نوى), not the Urdu word the user typed.
//
// The static BILINGUAL_MAP can't do (3): it has ~50 topics and covers none of
// نیت / موسیٰ / قتال / ترکِ نماز. An LLM generalizes to any concept. But it is
// only ever allowed to CHOOSE words and scopes — it never produces SQL, regex,
// or references. Every value it returns is re-validated below.

import { callChatCompletions } from "./aiGateway.ts";
import { expandQueryTerms } from "./bilingualMap.ts";
import {
  coerceDisciplines,
  detectDisciplines,
  describeDisciplines,
} from "./disciplines.ts";
import { BOOK_IDS, bookLabel, booksPromptList, detectBooks } from "./collections.ts";

export type QueryIntent = "topical" | "count" | "reference" | "phrase";

export interface QueryPlan {
  intent: QueryIntent;
  scope: {
    source_types: Array<"quran" | "hadith">;
    collections: string[];
    surah: number | null;
    /** Ayah number within `surah`. Only ever set when `surah` is too -- a
     *  verse without its surah identifies nothing. The prompt has always
     *  promised to parse "البقرہ 255" as a "reference" intent, but until
     *  2026-08-24 there was nowhere to put the 255, so the ayah half was
     *  silently dropped. The word-by-word Quran lookup needs both halves. */
    verse: number | null;
    /** Tier-2 classical disciplines to also search (fiqh/fatwa/tafsir/lughat/
     *  rijal/nahw). Empty for pure Quran/Hadith questions — additive dimension,
     *  it never removes the Quran/Hadith channels. */
    disciplines: string[];
  };
  /** Arabic surface forms to match lexically. Always non-empty. */
  arabic_surface_forms: string[];
  related_concepts: string[];
  /** Clean Arabic paraphrase used for the embedding channel. */
  semantic_query_ar: string;
  /** True when the counted term is a proper noun (a person/place name).
   *  Names don't take the definite article, so count_term_occurrences can
   *  exclude ال-prefixed homographs — e.g. الموسى ("the razor") must not be
   *  counted as موسى (the name Musa). */
  is_proper_noun: boolean;
  /** Set when the plan came from the fallback path rather than the model. */
  degraded?: boolean;
}

const PLANNER_SYSTEM_PROMPT = `You plan retrieval over a corpus of the Qur'an (Tanzil, all 6236 ayat) and Hadith (${BOOK_IDS.length} collections). The user writes in Urdu, Arabic, or English. Return ONLY a JSON object.

Decide:

1. "intent":
   - "count"     — the user asks HOW MANY TIMES a SINGLE specific word/name appears ("کتنی بار", "how many times", "كم مرة"). If the user asks about TWO OR MORE unrelated words/concepts in one count question (e.g. "پانی اور زمین کتنی بار آیا ہے" — water AND land), do NOT merge them into one count: pick "count" and put ONLY the single most specific term the question is really about into arabic_surface_forms, OR use "topical" instead if no single term dominates. A count across multiple unrelated words is a meaningless number — never produce one.
   - "reference" — the user names an exact location ("بخاری 7", "البقرہ 255", "Surah 2 verse 255").
   - "phrase"    — the user quotes or pastes actual scripture text and wants it identified.
   - "topical"   — anything else: the user wants passages ABOUT a subject.

2. "scope":
   - "source_types": subset of ["quran","hadith"]. If the user says only آیات/verses → ["quran"]. Only احادیث/hadith → ["hadith"]. Both or unclear → both.
   - "collections": canonical book IDs ONLY from this list, [] if unrestricted.
     Use the ID on the left of the dash; the Urdu name on the right is what the
     user will have typed. Match generously — "بخاری", "صحیح بخاری" and
     "Bukhari" are all bukhari — but never invent an ID that is not listed:
     ${booksPromptList()}
   - "surah": surah number if the user named one, else null.
   - "verse": ayah number within that surah if the user named one ("البقرہ 255" → surah 2, verse 255), else null. Never set verse without surah.
   - "disciplines": subset of ["fiqh","fatwa","tafsir","lughat","rijal","nahw","hadith_term"], [] unless the question is clearly about the classical literature of that discipline. Use "fiqh" for فقہی مسائل / اقوالِ مذاہب, "fatwa" for فتاویٰ, "tafsir" for تفسیرِ آیت / اقوالِ مفسرین, "lughat" for لغوی معنیٰ / مادہ, "rijal" for ANY question about a narrator himself — his biography, teachers/students (اساتذہ/تلامذہ), how many narrations he transmitted (کتنی روایات), his reliability (جرح و تعدیل), "hadith_term" for the TERMINOLOGY of hadith science (ضعیف/منکر/حسن لغیرہ کی تعریف, اصطلاحاتِ حدیث), "nahw" for نحو و صرف / اعراب. This is ADDITIVE — it does not replace the Quran/Hadith scope.

3. "arabic_surface_forms" — THE MOST IMPORTANT FIELD. The actual Arabic words as they appear in scripture. Think about the triliteral root and give the real inflected forms, WITHOUT the definite article ال and WITHOUT proclitic prefixes (و ف ب ل ك) — the search layer adds those itself.
   - "نیت"        → ["نية","نيات","نوى","ينوي","انوى"]
   - "موسیٰ"      → ["موسى"]
   - "قتال"       → ["قتال","قتل","يقاتل","قاتل"]
   - "ترک نماز"   → ["تارك الصلاة","اضاعوا الصلاة","ترك الصلاة","سهون","ساهون"]
   Give 2–8 forms. For a proper noun, usually just the name itself.

4. "related_concepts" — 0–4 adjacent Arabic terms that often co-occur with the topic (e.g. for نية: ["اخلاص","قصد","ارادة"]). Leave [] for count/reference intents — they would inflate the count.

5. "semantic_query_ar" — one clean Arabic sentence capturing the MEANING, for vector search. Never copy the user's Urdu instruction words ("سے متعلق", "ذکر کریں", "بتائیں").

6. "is_proper_noun" — true only when the counted/searched term is a person or place NAME (موسى, ابراهيم, مكة). false for ordinary nouns (قتال, نية, صلاة).

Output shape:
{"intent":"...","scope":{"source_types":[...],"collections":[...],"surah":null,"verse":null,"disciplines":[]},"arabic_surface_forms":[...],"related_concepts":[...],"semantic_query_ar":"...","is_proper_noun":false}`;

/** Heuristic intent detection — used when the model is unavailable. */
function heuristicIntent(query: string): QueryIntent {
  if (/کتنی\s*(بار|مرتبہ)|کتنی\s*دفعہ|how\s+many\s+times|كم\s*مرة|عدد\s*مرات/i.test(query)) {
    return "count";
  }
  return "topical";
}

/** Heuristic scope detection — used when the model is unavailable. */
function heuristicScope(query: string): QueryPlan["scope"] {
  // Book detection is delegated to the registry (collections.ts) rather than a
  // hand-written regex per book: the regex only ever covered the six Sihah
  // Sittah titles, so the fallback path silently ignored every other book in
  // the corpus. detectBooks() matches whole tokens of a book's Urdu/Arabic
  // title and aliases, which also fixes the substring bug the old
  // /مسلم|muslim/ test had (it scoped "مسلمان" queries to صحیح مسلم).
  const collections = detectBooks(query);

  const wantsQuran = /قرآن|قراٰن|قرأن|آیات|آیت|آية|آيات|سورۃ|سورہ|سورة|quran|qur'?an|verse|ayah|surah/i.test(query);
  const wantsHadith = /حدیث|احادیث|حديث|أحاديث|hadith|hadis|narration/i.test(query)
    || collections.length > 0;

  const source_types: Array<"quran" | "hadith"> =
    wantsQuran && !wantsHadith ? ["quran"]
    : wantsHadith && !wantsQuran ? ["hadith"]
    : ["quran", "hadith"];

  return { source_types, collections, surah: null, verse: null, disciplines: detectDisciplines(query) };
}

/** Keep only Arabic-script tokens — the lexical channel searches content_ar,
 *  so Urdu-only or Latin tokens can never match there. */
function arabicOnly(terms: string[]): string[] {
  return terms
    .map((t) => (t ?? "").toString().trim())
    .filter((t) => t.length >= 2 && /[؀-ۿ]/.test(t) && !/[a-zA-Z]/.test(t));
}

/**
 * Fallback plan built without the model. Reuses the existing bilingual map:
 * far narrower coverage than the LLM, but it keeps search working (degraded)
 * instead of failing when the AI provider is down or over quota.
 */
export function fallbackPlan(query: string): QueryPlan {
  const expanded = arabicOnly(expandQueryTerms(query));
  const forms = expanded.length > 0 ? expanded : arabicOnly(query.split(/\s+/));

  return {
    intent: heuristicIntent(query),
    scope: heuristicScope(query),
    // Last resort: the raw query. search_documents_scoped tolerates a term
    // that matches nothing — it just returns no lexical hits, and the
    // semantic channel still runs.
    arabic_surface_forms: forms.length > 0 ? forms.slice(0, 8) : [query.trim()],
    related_concepts: [],
    semantic_query_ar: query.trim(),
    is_proper_noun: false,
    degraded: true,
  };
}

/** Coerce and validate whatever the model returned into a safe QueryPlan.
 *  Anything malformed falls back field-by-field rather than rejecting the
 *  whole plan — a plan with a good term list but a bogus collection is still
 *  much better than no plan.
 *
 *  Exported for tests: this is the boundary where untrusted model output
 *  becomes trusted input to SQL, so it carries the invariants worth pinning
 *  down (invented collection slugs dropped, surah range enforced, non-Arabic
 *  terms discarded before they reach a content_ar search). */
export function coercePlan(raw: unknown, query: string): QueryPlan {
  const fb = fallbackPlan(query);
  if (!raw || typeof raw !== "object") return fb;
  const o = raw as Record<string, any>;

  const intent: QueryIntent =
    o.intent === "count" || o.intent === "reference" || o.intent === "phrase" || o.intent === "topical"
      ? o.intent
      : fb.intent;

  const sourceTypes = Array.isArray(o.scope?.source_types)
    ? o.scope.source_types.filter((s: unknown) => s === "quran" || s === "hadith")
    : [];

  const collections = Array.isArray(o.scope?.collections)
    ? o.scope.collections.filter((c: unknown) =>
        typeof c === "string" && BOOK_IDS.includes(c))
    : [];

  const surahRaw = Number(o.scope?.surah);
  const surah = Number.isInteger(surahRaw) && surahRaw >= 1 && surahRaw <= 114 ? surahRaw : null;

  // 286 is Al-Baqarah's ayah count, the longest surah -- a cheap upper bound
  // that rejects a hallucinated 9999 without needing a per-surah table. A
  // verse is dropped unless its surah survived validation too: "ayah 255" with
  // no surah points at 114 different ayat, so it is not a reference at all.
  const verseRaw = Number(o.scope?.verse);
  const verse = surah !== null && Number.isInteger(verseRaw) && verseRaw >= 1 && verseRaw <= 286
    ? verseRaw
    : null;

  // Disciplines: model-picked wins; otherwise keep whatever the keyword
  // heuristic detected (same safety-net pattern as collections).
  //
  // Model-picked AND keyword-detected are unioned, not either/or. Live
  // 2026-10-13: for "ابو ہریرہؓ کی روایات کی تعداد" none of the ten results came
  // from the rijal corpus (19,616 rows, with per-narrator narration counts).
  // The prompt's old wording for "rijal" only named "راوی کا حال / جرح و تعدیل",
  // which is the likely cause (not confirmed — the plan itself isn't logged).
  // A keyword hit is a sure positive and the channel is additive, so adding it
  // costs one extra retrieval call, never a wrong exclusion.
  const modelDisciplines = coerceDisciplines(o.scope?.disciplines);
  const disciplines = [...new Set([...modelDisciplines, ...fb.scope.disciplines])];

  const forms = arabicOnly(Array.isArray(o.arabic_surface_forms) ? o.arabic_surface_forms : []);
  const related = arabicOnly(Array.isArray(o.related_concepts) ? o.related_concepts : []);

  const semantic = typeof o.semantic_query_ar === "string" && o.semantic_query_ar.trim().length > 0
    ? o.semantic_query_ar.trim()
    : fb.semantic_query_ar;

  return {
    intent,
    scope: {
      source_types: sourceTypes.length > 0 ? sourceTypes : fb.scope.source_types,
      // A model-picked collection wins; otherwise keep whatever the keyword
      // heuristic found (the model sometimes omits an explicitly named book).
      collections: collections.length > 0 ? collections : fb.scope.collections,
      surah: surah ?? fb.scope.surah,
      verse: verse ?? fb.scope.verse,
      disciplines,
    },
    arabic_surface_forms: forms.length > 0 ? forms.slice(0, 8) : fb.arabic_surface_forms,
    related_concepts: related.slice(0, 4),
    semantic_query_ar: semantic,
    is_proper_noun: o.is_proper_noun === true,
  };
}

/** Stable cache key for a query. */
async function cacheKey(query: string): Promise<string> {
  const data = new TextEncoder().encode(`query-plan:${query.trim().toLowerCase()}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Produce a retrieval plan for `query`.
 *
 * Never throws and never returns null — on any failure it degrades to
 * `fallbackPlan`, so callers can always proceed to retrieval.
 *
 * @param supabase Optional service-role client. When supplied, plans are
 *                 cached in api_response_cache for 24h (same table the Tier-A
 *                 API cache uses, under domain 'query-plan').
 */
export async function planQuery(
  query: string,
  // deno-lint-ignore no-explicit-any
  supabase?: any,
): Promise<QueryPlan> {
  const trimmed = (query ?? "").trim();
  if (!trimmed) return fallbackPlan("");

  let key: string | null = null;
  if (supabase) {
    try {
      key = await cacheKey(trimmed);
      const { data } = await supabase
        .from("api_response_cache")
        .select("response")
        .eq("cache_key", key)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (data?.response) return coercePlan(data.response, trimmed);
    } catch {
      // Cache is an optimization, never a dependency.
    }
  }

  let parsed: unknown = null;
  try {
    const res = await callChatCompletions({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: PLANNER_SYSTEM_PROMPT },
        { role: "user", content: trimmed },
      ],
      response_format: { type: "json_object" },
      max_tokens: 800,
    });

    if (res.ok) {
      const json = await res.json();
      const content: string = json?.choices?.[0]?.message?.content ?? "";
      try {
        parsed = JSON.parse(content);
      } catch {
        // Model ignored the json_object directive and wrapped it in fences.
        const stripped = content.replace(/```json\s*|\s*```/g, "").trim();
        try { parsed = JSON.parse(stripped); } catch { parsed = null; }
      }
    } else {
      console.warn("[queryPlanner] model call failed:", res.status);
    }
  } catch (e) {
    console.warn("[queryPlanner] model call threw:", e);
  }

  if (parsed === null) return fallbackPlan(trimmed);

  const plan = coercePlan(parsed, trimmed);

  if (supabase && key) {
    try {
      await supabase.from("api_response_cache").upsert({
        cache_key: key,
        domain: "query-plan",
        response: plan,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    } catch {
      // Non-fatal.
    }
  }

  return plan;
}

/** Short human-readable description of the active scope, for the UI. */
export function describeScope(plan: QueryPlan): string {
  const parts: string[] = [];
  if (plan.scope.collections.length > 0) {
    parts.push(plan.scope.collections.map(bookLabel).join("، "));
  } else {
    if (plan.scope.source_types.includes("quran")) parts.push("قرآن");
    if (plan.scope.source_types.includes("hadith")) parts.push("حدیث");
  }
  if (plan.scope.surah) parts.push(`سورہ ${plan.scope.surah}`);
  if (plan.scope.disciplines.length > 0) parts.push(describeDisciplines(plan.scope.disciplines));
  return parts.join(" • ");
}
