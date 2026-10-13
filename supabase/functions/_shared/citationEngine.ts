// Shared citation retrieval engine.
//
// Single entry point for every "find me the ayah/hadith" surface in the app:
//   - resource-search      (Editor + Translate "insert reference" dialog)
//   - refine-text          ("Add citations" on Transcribe / Editor / Translate)
//   - citationCandidates   (Research "Add citations" pipeline)
//   - islamic-search       (Research Islamic mode, local corpus tier)
//
// Pipeline:
//   plan → { lexical, semantic } in parallel → RRF fuse → optional LLM rerank
// with a separate exact-count path for "how many times…" questions.
//
// Two invariants worth keeping:
//   1. The LLM never produces citation TEXT or references — it only picks
//      match_keys from a server-built candidate list, and every pick is
//      re-checked against that list. Passage text always comes from the DB.
//      (Same guarantee as runCitationsPipeline in research-query.)
//   2. Nothing here throws for a retrieval failure. A dead channel degrades
//      the result; it never fails the caller's request.

import { callChatCompletions } from "./aiGateway.ts";
import { embedQuery } from "./embed.ts";
import { planQuery, describeScope, type QueryPlan } from "./queryPlanner.ts";
import { reciprocalRankFusion, buildMatchKey } from "./rankFusion.ts";
import { takhrijTokens, takhrijOverlap, TAKHRIJ_MIN_OVERLAP } from "./mirror/text/takhrij.ts";
import { resolveCollectionSlugs, scopeHasArabicMatn } from "./collections.ts";
import { disciplineDomains } from "./disciplines.ts";
// Tier-2 classical corpus lexical channel is scoped by discipline; see disciplines.ts.

export interface EngineCitation {
  match_key: string;
  source_type: string;
  domain: string;
  content: string;
  content_ar?: string;
  // deno-lint-ignore no-explicit-any
  citation_ref: Record<string, any>;
  source_url?: string | null;
  language?: string;
  score: number;
  /** Which retrieval channels found it ("lexical" / "semantic"). */
  channels: string[];
  /** One-line Urdu relevance note, present only when reranking ran. */
  reason?: string;
}

export interface EngineCountBucket {
  key: string;
  label: string;
  source_type: string;
  occurrences: number;
  rows_matched: number;
}

export interface CitationEngineResult {
  intent: QueryPlan["intent"];
  plan_summary: {
    arabic_terms: string[];
    scope_label: string;
    /** True when the plan came from the keyword fallback, not the model. */
    degraded: boolean;
  };
  results: EngineCitation[];
  count?: {
    total: number;
    rows_matched: number;
    buckets: EngineCountBucket[];
    caveats: string[];
  };
}

export interface FindCitationsInput {
  query: string;
  // deno-lint-ignore no-explicit-any
  supabase: any;
  /** Final result cap after fusion/rerank. Default 12. */
  maxResults?: number;
  /** Run the LLM rerank pass. Default true; callers on a latency budget
   *  (or already inside another LLM call) should pass false. */
  rerank?: boolean;
  /** Force a scope regardless of what the planner infers. */
  scopeOverride?: {
    source_types?: Array<"quran" | "hadith">;
    collections?: string[];
    disciplines?: string[];
  };
  /**
   * Owner of the personal corpus to search (SPEC-M4 NFR-5).
   *
   * MUST come from the verified JWT, never from a request body. Every caller
   * builds its client with the SERVICE ROLE key, which bypasses RLS entirely —
   * so `library_chunks` owner-only policies protect nothing here and the
   * user filter has to be explicit in the query itself.
   *
   * Omitted ⇒ both personal channels return nothing (fail closed). Searching
   * every user's private books is never the safe default.
   */
  userId?: string;
}

const LEXICAL_LIMIT = 40;
const SEMANTIC_LIMIT = 30;
const RERANK_POOL = 30;

/** Map a scholarly_documents row into an EngineCitation shell (score filled
 *  in later by fusion). Returns null for rows without a usable identity. */
// deno-lint-ignore no-explicit-any
function toCitation(row: any): (EngineCitation & { match_key: string }) | null {
  const match_key = buildMatchKey(row);
  if (!match_key) return null;
  return {
    match_key,
    source_type: row.source_type,
    domain: row.domain ?? (row.source_type === "quran" ? "tanzil" : "hadith-json"),
    content: row.content ?? "",
    content_ar: row.content_ar ?? undefined,
    citation_ref: row.citation_ref ?? {},
    source_url: row.source_url ?? row.citation_ref?.url ?? null,
    language: row.language ?? "ar",
    score: 0,
    channels: [],
  };
}

/** Fallback lexical search over the long-established search_documents_smart
 *  RPC. It matches BOTH content and content_ar and has no scope parameters, so
 *  we post-filter by collection/surah here. Used when search_documents_scoped
 *  is unavailable (e.g. a stale PostgREST schema cache right after the function
 *  was added) or returns nothing — search_documents_smart has been in the
 *  schema for a long time and is reliably in PostgREST's cache. */
async function smartFallback(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  patterns: string[],
  scope: QueryPlan["scope"],
): Promise<Array<EngineCitation & { match_key: string }>> {
  try {
    const { data, error } = await supabase.rpc("search_documents_smart", {
      p_terms: patterns,
      p_source_types: scope.source_types.length > 0 ? scope.source_types : null,
      p_match_limit: LEXICAL_LIMIT,
    });
    if (error) {
      console.error("[citationEngine] search_documents_smart fallback error:", error);
      return [];
    }
    let rows = data ?? [];
    if (scope.collections.length > 0) {
      // `scope.collections` holds canonical book IDs; the rows carry whatever
      // string the ingestion pipeline wrote. Compare against the resolved set
      // (see collections.ts) — comparing IDs directly silently dropped every
      // row of a book stored under a variant slug, e.g. mishkat_almasabih.
      const wanted = new Set(resolveCollectionSlugs(scope.collections));
      // deno-lint-ignore no-explicit-any
      rows = rows.filter((r: any) => {
        const c = r?.citation_ref?.collection ?? r?.citation_ref?.book;
        return c && wanted.has(c);
      });
    }
    if (scope.surah != null) {
      // deno-lint-ignore no-explicit-any
      rows = rows.filter((r: any) => Number(r?.citation_ref?.surah_number) === scope.surah);
    }
    // deno-lint-ignore no-explicit-any
    return rows.map(toCitation).filter(Boolean) as any[];
  } catch (e) {
    console.error("[citationEngine] smart fallback threw:", e);
    return [];
  }
}

/** Lexical channel — diacritic-tolerant term matching over content_ar, with
 *  collection/surah scoping. Falls back to search_documents_smart if the
 *  scoped RPC errors or finds nothing. */
async function lexicalChannel(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  plan: QueryPlan,
  scope: QueryPlan["scope"],
): Promise<Array<EngineCitation & { match_key: string }>> {
  // Surface forms first, then related concepts — related terms broaden recall
  // but are weaker evidence, so they go last and are capped.
  const patterns = [...plan.arabic_surface_forms, ...plan.related_concepts.slice(0, 3)];
  if (patterns.length === 0) return [];

  // search_documents_scoped filters on `content_ar IS NOT NULL`. When every
  // book in scope is one of the tohed-hadith-only titles (Ibn Hibban, Darqutni,
  // Musnad Ishaq, ...), no row of theirs has Arabic matn stored, so the scoped
  // RPC must return zero — and its 8s statement timeout would be spent proving
  // it. Go straight to the smart search, which also matches the Urdu `content`.
  if (!scopeHasArabicMatn(scope.collections)) {
    return await smartFallback(supabase, patterns, scope);
  }

  try {
    const { data, error } = await supabase.rpc("search_documents_scoped", {
      p_patterns: patterns,
      p_source_types: scope.source_types.length > 0 ? scope.source_types : null,
      p_collections: scope.collections.length > 0 ? resolveCollectionSlugs(scope.collections) : null,
      p_surah: scope.surah,
      p_limit: LEXICAL_LIMIT,
    });
    if (!error) {
      // deno-lint-ignore no-explicit-any
      const mapped = (data ?? []).map(toCitation).filter(Boolean) as any[];
      if (mapped.length > 0) return mapped;
      // Scoped ran but found nothing in content_ar — try the broader smart
      // search (which also matches `content`) before giving up.
      return await smartFallback(supabase, patterns, scope);
    }
    console.error("[citationEngine] search_documents_scoped error:", error);
  } catch (e) {
    console.error("[citationEngine] lexical channel threw:", e);
  }
  // Scoped errored (most likely a stale PostgREST schema cache immediately
  // after the migration was applied) — fall back so lexical search still works.
  return await smartFallback(supabase, patterns, scope);
}

/** Semantic channel — pgvector over the clean Arabic paraphrase.
 *
 *  Note this only sees rows where embedding IS NOT NULL. If the corpus
 *  embedding backfill is incomplete, this channel returns little or nothing
 *  and RRF falls back to lexical-only — degraded, but never broken. */
async function semanticChannel(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  plan: QueryPlan,
  scope: QueryPlan["scope"],
  rawQuery: string,
): Promise<Array<EngineCitation & { match_key: string }>> {
  try {
    // For a pasted/quoted PHRASE, embed the exact text — the planner's
    // semantic_query_ar is a MEANING paraphrase, which lowers similarity
    // against the verbatim scripture the user quoted. For topical questions
    // the paraphrase is better (it strips Urdu instruction words). Only use
    // the raw query when it's actually Arabic script.
    const rawIsArabic = /[؀-ۿ]/.test(rawQuery) && !/[a-zA-Z]{3,}/.test(rawQuery);
    const embedText = plan.intent === "phrase" && rawIsArabic
      ? rawQuery
      : plan.semantic_query_ar;
    const embedding = await embedQuery(embedText || plan.semantic_query_ar);
    if (!embedding) return [];

    // Domain filter mirrors the source_type scope. The RPC filters on domain,
    // not source_type, so map across to all real ingested Hadith domains.
    const HADITH_DOMAINS = [
      "hadith-json",
      "easyquran-hadith",
      "urdu-hadith",
      "tohed-hadith",
      "islamicurdubooks-hadith"
    ];
    const domains: string[] = [];
    if (scope.source_types.includes("quran")) domains.push("tanzil");
    if (scope.source_types.includes("hadith")) domains.push(...HADITH_DOMAINS);

    const { data, error } = await supabase.rpc("match_scholarly_documents", {
      query_embedding: embedding,
      match_threshold: 0.35,
      match_count: SEMANTIC_LIMIT,
      filter_domains: domains.length > 0 ? domains : null,
      filter_language: null,
    });
    if (error) {
      console.error("[citationEngine] match_scholarly_documents error:", error);
      return [];
    }

    let rows = data ?? [];
    // match_scholarly_documents has no collection filter, so when the user
    // scoped to specific books ("in Sahih Bukhari"), enforce it here — an
    // out-of-scope semantic hit is worse than one fewer result.
    if (scope.collections.length > 0) {
      const wanted = new Set(resolveCollectionSlugs(scope.collections));
      // deno-lint-ignore no-explicit-any
      rows = rows.filter((r: any) => {
        const c = r?.citation_ref?.collection ?? r?.citation_ref?.book;
        return c && wanted.has(c);
      });
    }
    // deno-lint-ignore no-explicit-any
    return rows.map(toCitation).filter(Boolean) as any[];
  } catch (e) {
    console.error("[citationEngine] semantic channel threw:", e);
    return [];
  }
}

/** Lexical half of the Tier-2 classical channel — diacritic-tolerant search
 *  over content_ar, scoped by discipline. `search_classical_scoped` filters on
 *  `content_ar IS NOT NULL`, which excludes rijal and tafsir entirely: both
 *  are ingested with content_ar deliberately empty (rijal — short Arabic names
 *  collide in the dedup index; tafsir — the embedding falls back to `content`)
 *  and are searchable only through classicalSemanticChannel below. Never throws. */
async function classicalLexicalChannel(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  patterns: string[],
  disciplines: string[],
): Promise<Array<EngineCitation & { match_key: string }>> {
  try {
    const { data, error } = await supabase.rpc("search_classical_scoped", {
      p_patterns: patterns,
      p_disciplines: disciplines,
      p_limit: LEXICAL_LIMIT,
    });
    if (error) {
      console.error("[citationEngine] search_classical_scoped error:", error);
      return [];
    }
    // deno-lint-ignore no-explicit-any
    return (data ?? []).map(toCitation).filter(Boolean) as any[];
  } catch (e) {
    console.error("[citationEngine] classical lexical channel threw:", e);
    return [];
  }
}

/** Semantic half of the Tier-2 classical channel. `match_scholarly_documents`
 *  has no discipline parameter, only `filter_domains`, so the requested
 *  disciplines are expanded to their domains via DISCIPLINE_DOMAINS and the
 *  results are then filtered back down to citation_ref.discipline — a domain
 *  filter alone would be too coarse the day a domain starts carrying more
 *  than one discipline. This is what actually makes rijal/tafsir/lughat
 *  reachable: all three are embedded (off their Urdu text), just never off
 *  content_ar. Never throws. */
async function classicalSemanticChannel(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  plan: QueryPlan,
  disciplines: string[],
): Promise<Array<EngineCitation & { match_key: string }>> {
  const domains = disciplineDomains(disciplines);
  if (domains.length === 0) return [];
  try {
    const embedding = await embedQuery(plan.semantic_query_ar);
    if (!embedding) return [];
    const { data, error } = await supabase.rpc("match_scholarly_documents", {
      query_embedding: embedding,
      match_threshold: 0.35,
      match_count: SEMANTIC_LIMIT,
      filter_domains: domains,
      filter_language: null,
    });
    if (error) {
      console.error("[citationEngine] classical match_scholarly_documents error:", error);
      return [];
    }
    const wanted = new Set(disciplines);
    // deno-lint-ignore no-explicit-any
    const rows = (data ?? []).filter((r: any) => wanted.has(r?.citation_ref?.discipline));
    // deno-lint-ignore no-explicit-any
    return rows.map(toCitation).filter(Boolean) as any[];
  } catch (e) {
    console.error("[citationEngine] classical semantic channel threw:", e);
    return [];
  }
}

/** Tier-2 classical corpus channel — fiqh/fatwa/tafsir/lughat/rijal/nahw.
 *  Runs ONLY when the plan requested disciplines, so pure Quran/Hadith queries
 *  are unaffected. Combines the lexical and semantic halves above (see each
 *  for why both are needed) and de-dupes by match_key — a discipline whose
 *  domain someday carries content_ar could otherwise surface from both. */
export async function classicalChannel(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  plan: QueryPlan,
  scope: QueryPlan["scope"],
): Promise<Array<EngineCitation & { match_key: string }>> {
  if (!scope.disciplines || scope.disciplines.length === 0) return [];
  const patterns = [...plan.arabic_surface_forms, ...plan.related_concepts.slice(0, 3)];
  if (patterns.length === 0) return [];

  const [lexical, semantic] = await Promise.all([
    classicalLexicalChannel(supabase, patterns, scope.disciplines),
    classicalSemanticChannel(supabase, plan, scope.disciplines),
  ]);

  const seen = new Set<string>();
  const merged: Array<EngineCitation & { match_key: string }> = [];
  for (const c of [...lexical, ...semantic]) {
    if (seen.has(c.match_key)) continue;
    seen.add(c.match_key);
    merged.push(c);
  }
  return merged;
}

/** Exact occurrence counting for "how many times…" questions. */
async function countChannel(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  plan: QueryPlan,
  scope: QueryPlan["scope"],
): Promise<CitationEngineResult["count"] | undefined> {
  try {
    const { data, error } = await supabase.rpc("count_term_occurrences", {
      p_patterns: plan.arabic_surface_forms,
      p_source_types: scope.source_types.length > 0 ? scope.source_types : null,
      p_collections: scope.collections.length > 0 ? resolveCollectionSlugs(scope.collections) : null,
      p_surah: scope.surah,
      p_exclude_definite_article: plan.is_proper_noun,
    });
    if (error) {
      console.error("[citationEngine] count_term_occurrences error:", error);
      return undefined;
    }

    // deno-lint-ignore no-explicit-any
    const buckets: EngineCountBucket[] = (data ?? []).map((r: any) => ({
      key: String(r.bucket_key),
      label: String(r.bucket_label),
      source_type: String(r.source_type),
      occurrences: Number(r.occurrences) || 0,
      rows_matched: Number(r.rows_matched) || 0,
    }));

    const total = buckets.reduce((s, b) => s + b.occurrences, 0);
    const rowsMatched = buckets.reduce((s, b) => s + b.rows_matched, 0);

    // Caveats are shown in the UI. A bare number would overstate what this
    // count actually measures, so every limitation that affects the figure is
    // surfaced rather than buried.
    const caveats: string[] = [];
    caveats.push(`گنتی ان الفاظ پر ہوئی: ${plan.arabic_surface_forms.join("، ")}`);
    if (scope.source_types.includes("hadith")) {
      caveats.push("احادیث کا محفوظ متن سند (اسناد) سمیت ہے، اس لیے سند کے الفاظ بھی شمار ہوتے ہیں۔");
      caveats.push("ہمارے ذخیرے میں ١٧ کتبِ حدیث شامل ہیں — گنتی انہی کی ہے، ہر کتابِ حدیث کی نہیں۔");
    }
    if (plan.is_proper_noun) {
      caveats.push("چونکہ یہ اسمِ علم ہے، «ال» کے ساتھ آنے والی صورتیں شمار سے خارج کی گئی ہیں۔");
    }

    return { total, rows_matched: rowsMatched, buckets, caveats };
  } catch (e) {
    console.error("[citationEngine] count channel threw:", e);
    return undefined;
  }
}

const RERANK_PROMPT = `You rank retrieved Qur'an/Hadith passages by how well they support the user's request.

You will get the user's question and a numbered CANDIDATES list. Each candidate has a "match_key" and its text.

Rules:
1. Pick ONLY candidates that genuinely address the question. Topical adjacency is not enough.
2. You MUST copy each "match_key" EXACTLY from the list. Never invent one.
3. Do NOT write, translate, or quote passage text — the server already has it. Only the key and a reason.
4. "reason" = one short Urdu sentence (max 12 words) saying why this passage answers the question.
5. Order best-first. Return fewer than requested rather than padding with weak matches.

Return ONLY: {"picks":[{"match_key":"...","reason":"..."}]}`;

/** LLM rerank over the fused pool. Returns the reordered subset, or null if
 *  the pass failed (caller then keeps the raw RRF order). */
async function rerankChannel(
  query: string,
  pool: EngineCitation[],
  maxResults: number,
): Promise<EngineCitation[] | null> {
  if (pool.length === 0) return null;

  const candidates = pool.map((c) => ({
    match_key: c.match_key,
    // Arabic is what actually determines relevance here; content (Arabic +
    // English) is the fallback when content_ar is absent.
    text: (c.content_ar || c.content || "").slice(0, 400),
  }));

  try {
    const res = await callChatCompletions({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: RERANK_PROMPT },
        {
          role: "user",
          content:
            `QUESTION:\n${query}\n\nReturn at most ${maxResults} picks.\n\nCANDIDATES:\n` +
            JSON.stringify(candidates, null, 1),
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 2048,
    });
    if (!res.ok) {
      console.warn("[citationEngine] rerank failed:", res.status);
      return null;
    }

    const json = await res.json();
    const content: string = json?.choices?.[0]?.message?.content ?? "";
    let picks: Array<{ match_key?: string; reason?: string }> = [];
    try {
      picks = JSON.parse(content)?.picks ?? [];
    } catch {
      const stripped = content.replace(/```json\s*|\s*```/g, "").trim();
      try { picks = JSON.parse(stripped)?.picks ?? []; } catch { return null; }
    }
    if (!Array.isArray(picks) || picks.length === 0) return null;

    // Hallucination guard: only keys present in the pool survive. The passage
    // object always comes from our own retrieval, never from the model.
    const byKey = new Map(pool.map((c) => [c.match_key, c]));
    const ordered: EngineCitation[] = [];
    const used = new Set<string>();
    for (const p of picks) {
      const key = p?.match_key;
      if (!key || used.has(key)) continue;
      const doc = byKey.get(key);
      if (!doc) continue;
      used.add(key);
      ordered.push({
        ...doc,
        reason: typeof p.reason === "string" && p.reason.trim() ? p.reason.trim() : undefined,
      });
      if (ordered.length >= maxResults) break;
    }

    return ordered.length > 0 ? ordered : null;
  } catch (e) {
    console.warn("[citationEngine] rerank threw:", e);
    return null;
  }
}

/**
 * Turn personal-corpus rows into citations the Trust UI can actually show.
 *
 * A chunk only knows its `library_item_id`, but a source card reading
 * "personal_corpus · 3f2a…" tells the scholar nothing about which of their
 * books the passage came from. The item titles are looked up once per channel
 * (owner-scoped, like everything else here) and written into `citation_ref`
 * as `title`/`page`, which is the shape `CitationBadge` already renders.
 */
async function toPersonalCitations(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  rows: any[],
  userId: string,
  channel: string,
): Promise<Array<EngineCitation & { match_key: string }>> {
  if (rows.length === 0) return [];

  const itemIds = [...new Set(rows.map((r) => r.library_item_id).filter(Boolean))];
  const titles = new Map<string, string>();

  if (itemIds.length > 0) {
    const { data } = await supabase
      .from("library_items")
      .select("id, title")
      .eq("user_id", userId)
      .in("id", itemIds);
    // deno-lint-ignore no-explicit-any
    for (const item of (data ?? []) as any[]) titles.set(item.id, item.title);
  }

  return rows.map((row) => ({
    match_key: `personal:${row.library_item_id}:${row.chunk_index}`,
    source_type: "personal",
    domain: "personal_corpus",
    content: row.content,
    citation_ref: {
      title: titles.get(row.library_item_id) ?? "میری کتاب",
      // 1-based so the card reads like a location, not an array offset.
      page: (row.chunk_index ?? 0) + 1,
      library_item_id: row.library_item_id,
      chunk_index: row.chunk_index,
    },
    // Deliberately null: a private upload has no public URL, and the Trust UI
    // must never show a link that cannot be opened or checked.
    source_url: null,
    language: row.language || "ur",
    score: 0,
    channels: [channel],
  }));
}

/**
 * Tuning for the personal-library channels. Both default to the original,
 * permissive behaviour so findCitations() is unchanged; islamic-search passes
 * stricter values because its fan-out has only ten slots.
 */
export interface PersonalChannelOptions {
  /** Minimum cosine similarity for the vector half. Default 0.35. */
  minSimilarity?: number;
  /** Lexical half: require every query term, not just the first. */
  requireAllTerms?: boolean;
}

/** Personal Corpus Vector Channel — pgvector search on library_chunks (FR-2.7, FR-2.8) */
export async function personalVectorChannel(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  plan: QueryPlan,
  rawQuery: string,
  userId?: string,
  options: PersonalChannelOptions = {},
): Promise<Array<EngineCitation & { match_key: string }>> {
  // No verified owner ⇒ no personal search. See FindCitationsInput.userId.
  if (!userId) return [];

  try {
    const embedText = plan.semantic_query_ar || rawQuery;
    const embedding = await embedQuery(embedText);
    if (!embedding) return [];

    const { data, error } = await supabase.rpc("match_library_chunks", {
      query_embedding: embedding,
      filter_user_id: userId,
      match_threshold: options.minSimilarity ?? 0.35,
      match_count: SEMANTIC_LIMIT,
    });

    if (error || !data) return [];

    return await toPersonalCitations(supabase, data, userId, "personal_vector");
  } catch (e) {
    console.error("[citationEngine] personal vector channel threw:", e);
    return [];
  }
}

/** Personal Corpus Lexical Channel — text search on library_chunks (FR-2.7, FR-2.8) */
export async function personalLexicalChannel(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  rawQuery: string,
  userId?: string,
  options: PersonalChannelOptions = {},
): Promise<Array<EngineCitation & { match_key: string }>> {
  // No verified owner ⇒ no personal search. See FindCitationsInput.userId.
  if (!userId) return [];

  try {
    const terms = rawQuery.trim().split(/\s+/).filter((t) => t.length > 2).slice(0, 3);
    if (terms.length === 0) return [];

    let q = supabase
      .from("library_chunks")
      .select("id, library_item_id, chunk_index, content, language")
      .eq("user_id", userId);
    // Default: the FIRST term alone (original behaviour, other callers rely
    // on it). `requireAllTerms` makes every term a condition, so one common
    // word in a long query can no longer pull in an unrelated page.
    for (const term of options.requireAllTerms ? terms : terms.slice(0, 1)) {
      q = q.ilike("content", `%${term}%`);
    }
    const { data, error } = await q.limit(LEXICAL_LIMIT);

    if (error || !data) return [];

    return await toPersonalCitations(supabase, data, userId, "personal_lexical");
  } catch (e) {
    console.error("[citationEngine] personal lexical channel threw:", e);
    return [];
  }
}

/**
 * Find citations for a free-text question.
 *
 * Never throws — on total retrieval failure it returns an empty `results`
 * array with the plan summary intact, so the caller can still tell the user
 * what was searched for.
 */
export async function findCitations(input: FindCitationsInput): Promise<CitationEngineResult> {
  const { query, supabase } = input;
  const maxResults = input.maxResults ?? 12;
  const shouldRerank = input.rerank !== false;

  const plan = await planQuery(query, supabase);

  const scope: QueryPlan["scope"] = {
    source_types: input.scopeOverride?.source_types ?? plan.scope.source_types,
    collections: input.scopeOverride?.collections ?? plan.scope.collections,
    surah: plan.scope.surah,
    verse: plan.scope.verse,
    disciplines: input.scopeOverride?.disciplines ?? plan.scope.disciplines,
  };

  const plan_summary = {
    arabic_terms: plan.arabic_surface_forms,
    scope_label: describeScope({ ...plan, scope }),
    degraded: plan.degraded === true,
  };

  // ── Count intent: exact SQL aggregation, plus sample passages so the
  //    number is auditable rather than a bare figure the user must trust.
  if (plan.intent === "count") {
    const [count, samples] = await Promise.all([
      countChannel(supabase, plan, scope),
      lexicalChannel(supabase, plan, scope),
    ]);
    // A degraded (fallback-heuristic) plan can pull raw leftover words from
    // the question itself into arabic_surface_forms — the terms are visible
    // as chips in the UI, but the number needs its own explicit warning too,
    // since a confident-looking figure is easy to trust without checking the
    // chips. See the matching guard in islamic-search/index.ts for the case
    // where this was observed producing a meaningless combined count.
    const countWithWarning = count && plan.degraded
      ? {
          ...count,
          caveats: [
            "⚠️ یہ الفاظ خودکار تجزیے کے بجائے سادہ اصول سے چنے گئے ہیں — نیچے دی گئی چِپس جانچ لیں؛ اگر غیر متعلقہ الفاظ نظر آئیں تو صرف مطلوبہ لفظ لکھ کر دوبارہ تلاش کریں۔",
            ...count.caveats,
          ],
        }
      : count;
    return {
      intent: "count",
      plan_summary,
      results: samples.slice(0, maxResults).map((c, i) => ({
        ...c,
        score: 1 / (i + 1),
        channels: ["lexical"],
      })),
      count: countWithWarning,
    };
  }

  // ── Retrieval intents: 4-way Double-Hybrid RRF Fusion (+ optional rerank)
  const [lexical, semantic, classical, personalVector, personalLexical] = await Promise.all([
    lexicalChannel(supabase, plan, scope),
    semanticChannel(supabase, plan, scope, query),
    classicalChannel(supabase, plan, scope),
    personalVectorChannel(supabase, plan, query, input.userId),
    personalLexicalChannel(supabase, query, input.userId),
  ]);

  // Lexical goes first so its object wins on duplicate keys — it carries
  // content_ar, which match_scholarly_documents does not return. Classical rows
  // have their own passage_key namespace, so they never collide with quran:/
  // hadith: keys and are simply fused in as additional evidence.
  const fused = reciprocalRankFusion([
    { name: "lexical", docs: lexical },
    { name: "semantic", docs: semantic },
    { name: "classical", docs: classical },
    { name: "personal_vector", docs: personalVector },
    { name: "personal_lexical", docs: personalLexical },
  ]);

  const ranked: EngineCitation[] = fused.map((f) => ({
    ...f.doc,
    score: f.score,
    channels: f.channels,
  }));

  if (ranked.length === 0) {
    return { intent: plan.intent, plan_summary, results: [] };
  }

  if (shouldRerank && plan.intent === "topical") {
    const reranked = await rerankChannel(query, ranked.slice(0, RERANK_POOL), maxResults);
    if (reranked) {
      return { intent: plan.intent, plan_summary, results: reranked };
    }
  }

  return { intent: plan.intent, plan_summary, results: ranked.slice(0, maxResults) };
}

/**
 * Chronologically sort Tafsir citations by Mufassir death date (وفاة / death_year_ah).
 */
export function sortTafsirChronologically(citations: EngineCitation[]): EngineCitation[] {
  return [...citations].sort((a, b) => {
    const wafatA = Number(a.citation_ref?.death_year_ah ?? a.citation_ref?.wafat ?? 9999);
    const wafatB = Number(b.citation_ref?.death_year_ah ?? b.citation_ref?.wafat ?? 9999);
    return wafatA - wafatB;
  });
}

/**
 * Hadith Takhrij: Group matching narrations across collections (Sahih Bukhari, Muslim, Tirmidhi, etc.)
 */
export interface HadithTakhrijResult {
  primaryHadith: EngineCitation;
  matchingNarrations: Array<{
    collection: string;
    hadith_number: string | number;
    chapter?: string;
    /** Content-word overlap ratio with the primary narration (0..1). */
    match_ratio: number;
    citation: EngineCitation;
  }>;
}

/**
 * Hadith takhrij — find other narrations of the SAME hadith across collections.
 *
 * Matching is by matn (text) similarity ONLY. It deliberately does not treat an
 * identical hadith_number in a different collection as a match: hadith
 * numbering is per-collection and arbitrary, so Bukhari #1 and Muslim #1 are
 * entirely unrelated narrations — pairing them would attribute a hadith to a
 * book that never narrated it.
 *
 * Similarity is the content-word overlap ratio (isnad/matn boilerplate
 * excluded), normalized by the smaller side so an abridged narration still
 * matches its fuller version. A long narration full of ordinary words cannot
 * pass on raw word count alone.
 */
export function takhrijHadith(
  primary: EngineCitation,
  candidates: EngineCitation[],
  /** Minimum content-word overlap ratio to accept as the same narration. */
  minOverlapRatio = TAKHRIJ_MIN_OVERLAP,
): HadithTakhrijResult {
  const primaryColl = (primary.citation_ref?.collection || primary.citation_ref?.book || "").toLowerCase();
  const primaryNum = String(primary.citation_ref?.hadith_number || "");
  const primaryTokens = takhrijTokens(primary.content_ar || primary.content || "");

  const scored: Array<{ c: EngineCitation; ratio: number }> = [];

  for (const c of candidates) {
    if (c.source_type !== "hadith") continue;
    const coll = (c.citation_ref?.collection || c.citation_ref?.book || "").toLowerCase();
    const num = String(c.citation_ref?.hadith_number || "");
    // Skip the primary row itself (same collection AND same number).
    if (coll === primaryColl && num === primaryNum) continue;

    // null = too little content on either side to judge — omit rather than guess.
    const ratio = takhrijOverlap(primaryTokens, takhrijTokens(c.content_ar || c.content || ""));
    if (ratio !== null && ratio >= minOverlapRatio) scored.push({ c, ratio });
  }

  // Strongest textual agreement first.
  scored.sort((a, b) => b.ratio - a.ratio);

  return {
    primaryHadith: primary,
    matchingNarrations: scored.map(({ c, ratio }) => ({
      collection: String(c.citation_ref?.collection || c.citation_ref?.book || "کتابِ حدیث"),
      hadith_number: c.citation_ref?.hadith_number || "",
      chapter: c.citation_ref?.chapter || c.citation_ref?.bab || undefined,
      match_ratio: Number(ratio.toFixed(2)),
      citation: c,
    })),
  };
}

/**
 * Kifayat Gate (کفایت Gate / Confidence Gate):
 * Evaluates whether current retrieval results are high-confidence (normalized RRF score >= threshold)
 * so we do not escalate to Tier 3 scrapers or Tier 4 paid Web Search APIs needlessly.
 */
export function evaluateKifayatGate(results: EngineCitation[], threshold = 0.70): { isSufficient: boolean; maxScore: number; reason: string } {
  if (!results || results.length === 0) {
    return { isSufficient: false, maxScore: 0, reason: "کوئی مواد برآمد نہیں ہوا۔ Tier 3/4 پر تلاش جاری رکھیں۔" };
  }

  const rawTopScore = Math.max(...results.map((r) => r.score || 0));
  // Normalize against the theoretical maximum RRF score: a document ranked #1
  // in BOTH channels scores 1/(60+1) + 1/(60+1) ≈ 0.03278. So 1.0 means "top
  // hit in every channel", 0.5 means "top hit in one channel only".
  //
  // This is a RETRIEVAL-confidence proxy (agreement + rank), not a semantic
  // relevance judgement — measuring the latter would need another LLM call.
  // Deliberately NOT short-circuited on result COUNT: the lexical channel
  // returns up to LEXICAL_LIMIT rows for almost any Arabic term, so a
  // count-based shortcut would report "sufficient" for every query and the
  // gate would never actually gate anything.
  const normalizedScore = Math.min(rawTopScore / 0.03278, 1.0);
  const isSufficient = normalizedScore >= threshold;

  return {
    isSufficient,
    maxScore: Number(normalizedScore.toFixed(2)),
    reason: isSufficient
      ? `Tier 1/2 کی تلاش میں اعلیٰ اعتمادی رزلٹ (Confidence: ${(normalizedScore * 100).toFixed(0)}%) مل گئے ہیں۔ اضافے کی ضرورت نہیں۔`
      : `کفایت معیار سے کم مطابقت (Confidence: ${(normalizedScore * 100).toFixed(0)}%)۔ Tier 3/4 کی جانب پیش رفت۔`,
  };
}


