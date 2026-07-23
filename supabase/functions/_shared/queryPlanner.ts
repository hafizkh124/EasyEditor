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

/** Collection slugs as stored in citation_ref->>'collection'. Source of truth:
 *  scripts/hadith_json_to_csv.py COLLECTION_META. The planner may only pick
 *  from this list; anything else it invents is dropped. */
export const COLLECTION_SLUGS = [
  "bukhari", "muslim", "tirmidhi", "abudawud", "ibnmajah", "nasai",
  "malik", "darimi", "ahmed", "nawawi40", "qudsi", "riyadussalihin",
  "bulughalmaram", "adab", "shahih-al-jami", "mishkat", "hisn-alhisar",
] as const;

/** Human labels used when describing the active scope back to the user. */
export const COLLECTION_LABELS: Record<string, string> = {
  bukhari: "صحیح بخاری",
  muslim: "صحیح مسلم",
  tirmidhi: "جامع ترمذی",
  abudawud: "سنن ابو داؤد",
  ibnmajah: "سنن ابن ماجہ",
  nasai: "سنن نسائی",
  malik: "موطأ امام مالک",
  darimi: "سنن دارمی",
  ahmed: "مسند احمد",
  nawawi40: "اربعین نووی",
  qudsi: "احادیث قدسیہ",
  riyadussalihin: "ریاض الصالحین",
  bulughalmaram: "بلوغ المرام",
  adab: "الأدب المفرد",
  "shahih-al-jami": "صحیح الجامع",
  mishkat: "مشکاۃ المصابیح",
  "hisn-alhisar": "حصن المسلم",
};

export type QueryIntent = "topical" | "count" | "reference" | "phrase";

export interface QueryPlan {
  intent: QueryIntent;
  scope: {
    source_types: Array<"quran" | "hadith">;
    collections: string[];
    surah: number | null;
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

const PLANNER_SYSTEM_PROMPT = `You plan retrieval over a corpus of the Qur'an (Tanzil, all 6236 ayat) and Hadith (17 collections). The user writes in Urdu, Arabic, or English. Return ONLY a JSON object.

Decide:

1. "intent":
   - "count"     — the user asks HOW MANY TIMES a word/name appears ("کتنی بار", "how many times", "كم مرة").
   - "reference" — the user names an exact location ("بخاری 7", "البقرہ 255", "Surah 2 verse 255").
   - "phrase"    — the user quotes or pastes actual scripture text and wants it identified.
   - "topical"   — anything else: the user wants passages ABOUT a subject.

2. "scope":
   - "source_types": subset of ["quran","hadith"]. If the user says only آیات/verses → ["quran"]. Only احادیث/hadith → ["hadith"]. Both or unclear → both.
   - "collections": slugs ONLY from this list, [] if unrestricted:
     bukhari, muslim, tirmidhi, abudawud, ibnmajah, nasai, malik, darimi, ahmed, nawawi40, qudsi, riyadussalihin, bulughalmaram, adab, shahih-al-jami, mishkat, hisn-alhisar
     ("صحیح بخاری" → ["bukhari"], "صحیح مسلم" → ["muslim"])
   - "surah": surah number if the user named one, else null.

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
{"intent":"...","scope":{"source_types":[...],"collections":[...],"surah":null},"arabic_surface_forms":[...],"related_concepts":[...],"semantic_query_ar":"...","is_proper_noun":false}`;

/** Heuristic intent detection — used when the model is unavailable. */
function heuristicIntent(query: string): QueryIntent {
  if (/کتنی\s*(بار|مرتبہ)|کتنی\s*دفعہ|how\s+many\s+times|كم\s*مرة|عدد\s*مرات/i.test(query)) {
    return "count";
  }
  return "topical";
}

/** Heuristic scope detection — used when the model is unavailable. */
function heuristicScope(query: string): QueryPlan["scope"] {
  const collections: string[] = [];
  if (/بخاری|بخاري|bukhari/i.test(query)) collections.push("bukhari");
  if (/مسلم|muslim/i.test(query)) collections.push("muslim");
  if (/ترمذی|ترمذي|tirmidhi/i.test(query)) collections.push("tirmidhi");
  if (/ابو\s*دا[وؤ]?د|abu\s*da[wu]+d/i.test(query)) collections.push("abudawud");
  if (/ابن\s*ماجہ|ابن\s*ماجه|ibn\s*majah/i.test(query)) collections.push("ibnmajah");
  if (/نسائی|نسائي|nasai/i.test(query)) collections.push("nasai");

  const wantsQuran = /قرآن|قراٰن|قرأن|آیات|آیت|آية|آيات|سورۃ|سورہ|سورة|quran|qur'?an|verse|ayah|surah/i.test(query);
  const wantsHadith = /حدیث|احادیث|حديث|أحاديث|بخاری|مسلم|hadith|hadis|narration/i.test(query)
    || collections.length > 0;

  const source_types: Array<"quran" | "hadith"> =
    wantsQuran && !wantsHadith ? ["quran"]
    : wantsHadith && !wantsQuran ? ["hadith"]
    : ["quran", "hadith"];

  return { source_types, collections, surah: null };
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
        typeof c === "string" && (COLLECTION_SLUGS as readonly string[]).includes(c))
    : [];

  const surahRaw = Number(o.scope?.surah);
  const surah = Number.isInteger(surahRaw) && surahRaw >= 1 && surahRaw <= 114 ? surahRaw : null;

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
    parts.push(plan.scope.collections.map((c) => COLLECTION_LABELS[c] ?? c).join("، "));
  } else {
    if (plan.scope.source_types.includes("quran")) parts.push("قرآن");
    if (plan.scope.source_types.includes("hadith")) parts.push("حدیث");
  }
  if (plan.scope.surah) parts.push(`سورہ ${plan.scope.surah}`);
  return parts.join(" • ");
}
