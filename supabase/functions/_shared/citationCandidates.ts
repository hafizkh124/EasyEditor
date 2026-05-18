// Citation-candidate retrieval for the "Add citations" pipeline.
//
// For one claim sentence, runs:
//   1. FTS over scholarly_documents with bilingual-expanded terms
//   2. Topic-anchor fallback (forces canonical refs when a known topic appears)
//   3. (optional) pgvector semantic search
//   4. (optional) live API fan-out (Dorar / AlQuran / Quran.com / HadithAPI)
//
// Returns a deduplicated, balanced (Quran + Hadith) list of CANDIDATES that
// the LLM may then pick from. The LLM is never allowed to invent a citation
// outside this list — that's the point of corpus-grounding the pipeline.
//
// Returned candidates are also returned with a stable `match_key` so the
// verifier (after the LLM picks) can confirm each citation exists in the DB.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { expandQueryTerms } from "./bilingualMap.ts";
import { lookupTopicAnchors } from "./topicAnchors.ts";

export interface CitationCandidate {
  type:        "quran" | "hadith";
  domain:      string;
  arabic:      string;
  translation: string;
  reference:   string;     // human-readable, used in the inline citation block
  match_key:   string;     // stable key for verifier dedupe ("quran:2:267" / "hadith:sahih-bukhari:1410")
  source_url?: string;
  citation_ref: Record<string, unknown>;
}

interface RetrievalContext {
  supabase: ReturnType<typeof createClient>;
  /** Set to false to skip the live API fan-out (faster, corpus-only). */
  includeApis?: boolean;
  /** Per-claim ceiling. Default 3 Quran + 3 Hadith. */
  maxQuran?: number;
  maxHadith?: number;
}

/** Quick-find rows in scholarly_documents whose content matches any of the
 * expanded query terms via PostgreSQL FTS. */
async function ftsCorpus(
  supabase: ReturnType<typeof createClient>,
  terms: string[],
  sourceType: "quran" | "hadith",
  limit: number,
): Promise<any[]> {
  if (terms.length === 0) return [];
  const ftsFilters = terms.slice(0, 5).flatMap((t) => [
    `content.fts(simple).${t}`,
    `content_ar.fts(simple).${t}`,
  ]).join(",");
  const { data, error } = await supabase
    .from("scholarly_documents")
    .select("domain, content, content_ar, citation_ref, language, source_type, source_url")
    .eq("source_type", sourceType)
    .or(ftsFilters)
    .limit(limit);
  if (error) {
    console.error(`[citationCandidates] FTS error (${sourceType}):`, error);
    return [];
  }
  return data ?? [];
}

/** Force-fetch the canonical anchor rows for a topic, but ONLY return rows
 * that actually exist in the DB. Never invents. */
async function topicAnchorRows(
  supabase: ReturnType<typeof createClient>,
  claim: string,
): Promise<{ quran: any[]; hadith: any[] }> {
  const anchors = lookupTopicAnchors(claim);
  if (!anchors) return { quran: [], hadith: [] };

  const out = { quran: [] as any[], hadith: [] as any[] };

  if (anchors.quran.length > 0) {
    const filters = anchors.quran.slice(0, 6).map(
      (a) => `and(citation_ref->>surah_number.eq.${a.surah},citation_ref->>verse.eq.${a.verse})`,
    );
    const { data, error } = await supabase
      .from("scholarly_documents")
      .select("domain, content, content_ar, citation_ref, language, source_type, source_url")
      .eq("source_type", "quran")
      .or(filters.join(","))
      .limit(filters.length);
    if (!error && data) out.quran = data;
  }

  if (anchors.hadith.length > 0) {
    // Each anchor now carries multiple book-name variants (Phase 10.1) — emit
    // one filter clause per (variant, hadith_number) pair. Also check the
    // `collection` field since different ingestion paths put the slug there
    // instead of in `book`. Cap total clauses at 30 to keep URL length safe.
    const filters: string[] = [];
    for (const a of anchors.hadith.slice(0, 8)) {
      for (const bookName of a.books) {
        filters.push(`and(citation_ref->>book.eq.${bookName},citation_ref->>hadith_number.eq.${a.hadith_number})`);
        filters.push(`and(citation_ref->>collection.eq.${bookName},citation_ref->>hadith_number.eq.${a.hadith_number})`);
        if (filters.length >= 30) break;
      }
      if (filters.length >= 30) break;
    }
    const { data, error } = await supabase
      .from("scholarly_documents")
      .select("domain, content, content_ar, citation_ref, language, source_type, source_url")
      .eq("source_type", "hadith")
      .or(filters.join(","))
      .limit(anchors.hadith.length);
    if (!error && data) out.hadith = data;
  }

  return out;
}

/** Optional: call vector-search edge function for semantic hits. */
async function vectorSearchHits(claim: string, ctxUrl: string, ctxKey: string, limit: number): Promise<any[]> {
  try {
    const res = await fetch(`${ctxUrl}/functions/v1/vector-search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${ctxKey}`,
        apikey:         ctxKey,
      },
      body: JSON.stringify({ query: claim, matchCount: limit }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.results ?? [];
  } catch {
    return [];
  }
}

/** Optional: call islamic-api-fetch for live upstream hits. */
async function apiHits(claim: string, ctxUrl: string, ctxKey: string): Promise<any[]> {
  try {
    const res = await fetch(`${ctxUrl}/functions/v1/islamic-api-fetch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${ctxKey}`,
        apikey:         ctxKey,
      },
      body: JSON.stringify({ query: claim }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.results ?? [];
  } catch {
    return [];
  }
}

/** Coerce a DB row or API result into a CitationCandidate. */
function toCandidate(row: any): CitationCandidate | null {
  const cite = row.citation_ref ?? {};
  const isQuran  = row.source_type === "quran"  || /quran|tanzil|alquran/.test(row.domain ?? "");
  const isHadith = row.source_type === "hadith" || /hadith|dorar|sunnah/.test(row.domain ?? "");
  if (!isQuran && !isHadith) return null;

  const arabic = (row.content_ar || row.content || "").toString().slice(0, 800);
  const translation = (row.content_ar && row.content ? row.content : "").toString().slice(0, 800);

  if (isQuran) {
    const surah = cite.surah_number ?? cite.surah;
    const verse = cite.verse;
    if (surah == null || verse == null) return null;
    return {
      type: "quran",
      domain: row.domain ?? "tanzil",
      arabic,
      translation,
      reference: `Qur'an ${surah}:${verse}` + (cite.surah_name ? ` (${cite.surah_name})` : ""),
      match_key: `quran:${surah}:${verse}`,
      source_url: row.source_url ?? cite.url,
      citation_ref: cite,
    };
  }

  const book   = cite.book ?? cite.collection ?? "";
  const number = cite.hadith_number;
  if (!book || number == null) return null;
  return {
    type: "hadith",
    domain: row.domain ?? "hadith-json",
    arabic,
    translation,
    reference: `${cite.collection ?? book}, Hadith ${number}` + (cite.grade ? ` (${cite.grade})` : ""),
    match_key: `hadith:${book}:${number}`,
    source_url: row.source_url ?? cite.url,
    citation_ref: cite,
  };
}

/** Main entry point — find citation candidates for a single claim. */
export async function findCitationCandidates(
  claim: string,
  ctx: RetrievalContext,
): Promise<CitationCandidate[]> {
  const maxQ = ctx.maxQuran  ?? 3;
  const maxH = ctx.maxHadith ?? 3;

  const expanded = expandQueryTerms(claim);
  const supabase = ctx.supabase;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // Fan out
  const [ftsQ, ftsH, anchors, vector, api] = await Promise.all([
    ftsCorpus(supabase, expanded, "quran",  Math.max(10, maxQ * 4)),
    ftsCorpus(supabase, expanded, "hadith", Math.max(10, maxH * 4)),
    topicAnchorRows(supabase, claim),
    ctx.includeApis !== false && supabaseUrl && supabaseKey
      ? vectorSearchHits(claim, supabaseUrl, supabaseKey, 10)
      : Promise.resolve([]),
    ctx.includeApis !== false && supabaseUrl && supabaseKey
      ? apiHits(claim, supabaseUrl, supabaseKey)
      : Promise.resolve([]),
  ]);

  // Dedupe and bucket
  const quran: CitationCandidate[]  = [];
  const hadith: CitationCandidate[] = [];
  const seen = new Set<string>();

  // Topic anchors first (highest authority for known topics)
  for (const row of [...anchors.quran, ...anchors.hadith]) {
    const c = toCandidate(row);
    if (!c) continue;
    if (seen.has(c.match_key)) continue;
    seen.add(c.match_key);
    (c.type === "quran" ? quran : hadith).push(c);
  }

  // FTS hits
  for (const row of [...ftsQ, ...ftsH]) {
    const c = toCandidate(row);
    if (!c) continue;
    if (seen.has(c.match_key)) continue;
    seen.add(c.match_key);
    (c.type === "quran" ? quran : hadith).push(c);
  }

  // Vector hits
  for (const row of vector) {
    const c = toCandidate(row);
    if (!c) continue;
    if (seen.has(c.match_key)) continue;
    seen.add(c.match_key);
    (c.type === "quran" ? quran : hadith).push(c);
  }

  // API hits last — they aren't in scholarly_documents so they're weaker
  // evidence for the "exists in our corpus" verifier. Still included as
  // additional context; verifier flags them and they get re-validated.
  for (const row of api) {
    const c = toCandidate(row);
    if (!c) continue;
    if (seen.has(c.match_key)) continue;
    seen.add(c.match_key);
    (c.type === "quran" ? quran : hadith).push(c);
  }

  return [...quran.slice(0, maxQ), ...hadith.slice(0, maxH)];
}
