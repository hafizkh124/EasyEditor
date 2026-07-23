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
  scopeOverride?: { source_types?: Array<"quran" | "hadith">; collections?: string[] };
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
      // deno-lint-ignore no-explicit-any
      rows = rows.filter((r: any) => {
        const c = r?.citation_ref?.collection ?? r?.citation_ref?.book;
        return c && scope.collections.includes(c);
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

  try {
    const { data, error } = await supabase.rpc("search_documents_scoped", {
      p_patterns: patterns,
      p_source_types: scope.source_types.length > 0 ? scope.source_types : null,
      p_collections: scope.collections.length > 0 ? scope.collections : null,
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
    // not source_type, so map across.
    const domains: string[] = [];
    if (scope.source_types.includes("quran")) domains.push("tanzil");
    if (scope.source_types.includes("hadith")) domains.push("hadith-json");

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
      // deno-lint-ignore no-explicit-any
      rows = rows.filter((r: any) => {
        const c = r?.citation_ref?.collection ?? r?.citation_ref?.book;
        return c && scope.collections.includes(c);
      });
    }
    // deno-lint-ignore no-explicit-any
    return rows.map(toCitation).filter(Boolean) as any[];
  } catch (e) {
    console.error("[citationEngine] semantic channel threw:", e);
    return [];
  }
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
      p_collections: scope.collections.length > 0 ? scope.collections : null,
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
    return {
      intent: "count",
      plan_summary,
      results: samples.slice(0, maxResults).map((c, i) => ({
        ...c,
        score: 1 / (i + 1),
        channels: ["lexical"],
      })),
      count,
    };
  }

  // ── Retrieval intents: hybrid + fusion (+ optional rerank) ────────────────
  const [lexical, semantic] = await Promise.all([
    lexicalChannel(supabase, plan, scope),
    semanticChannel(supabase, plan, scope, query),
  ]);

  // Lexical goes first so its object wins on duplicate keys — it carries
  // content_ar, which match_scholarly_documents does not return.
  const fused = reciprocalRankFusion([
    { name: "lexical", docs: lexical },
    { name: "semantic", docs: semantic },
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
