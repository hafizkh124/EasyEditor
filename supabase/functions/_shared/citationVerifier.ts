// Citation verifier — confirms every citation the LLM produced actually exists
// in scholarly_documents BEFORE the client renders it.
//
// Why: even after we constrain the LLM with a candidate list, the model can
// hallucinate small variants (off-by-one verse, wrong book slug, etc). This
// module is the safety net — anything the verifier rejects gets dropped from
// the final response and surfaced to the UI as "no reliable citation found
// for this segment".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface RawLlmCitation {
  index?:      number;
  arabic?:     string;
  translation?:string;
  reference?:  string;
  source_url?: string;
  // Verifier accepts EITHER structured ids OR a free-form reference; both will
  // be tried. Prefer providing structured ids when constructing prompts.
  surah?:      number | string;
  verse?:      number | string;
  book?:       string;
  hadith_number?: string | number;
}

export interface VerifiedCitation extends RawLlmCitation {
  index:      number;
  arabic:     string;
  translation:string;
  reference:  string;
  match_key:  string;          // "quran:2:267" | "hadith:sahih-bukhari:1410"
  verified:   true;
  source_url?:string;
}

/** Parse a free-form reference string into structured ids when possible.
 *  Handles: "Qur'an 2:267", "Quran 2:267", "Sahih al-Bukhari, Hadith 1410",
 *  "Bukhari 1410", "sahih-bukhari:1410". */
function parseReference(ref: string): { surah?: number; verse?: number; book?: string; number?: string } {
  if (!ref) return {};
  // Quran X:Y
  const quranMatch = ref.match(/(?:qur[''']?an|قرآن|القرآن)[^0-9]*?(\d{1,3})\s*[:\.؛]\s*(\d{1,3})/i);
  if (quranMatch) {
    return { surah: parseInt(quranMatch[1], 10), verse: parseInt(quranMatch[2], 10) };
  }
  // Plain "2:267" anywhere
  const plain = ref.match(/(\b\d{1,3})\s*:\s*(\d{1,3}\b)/);
  if (plain && /quran|qur'an|surah|سورة|آية/i.test(ref)) {
    return { surah: parseInt(plain[1], 10), verse: parseInt(plain[2], 10) };
  }
  // Hadith — book + number
  const hadithMatch = ref.match(
    /(sahih[- ]?bukhari|sahih[- ]?muslim|bukhari|muslim|tirmidhi|abu[- ]?dawood|abu[- ]?dawud|ibn[- ]?majah|nasai|al[- ]?nasai|sunan[- ]?nasai|musnad[- ]?ahmad|mishkat|silsila[- ]?sahiha)[^0-9]*?(\d{1,5})/i,
  );
  if (hadithMatch) {
    const slugMap: Record<string, string> = {
      "bukhari":          "sahih-bukhari",
      "sahihbukhari":     "sahih-bukhari",
      "sahih-bukhari":    "sahih-bukhari",
      "muslim":           "sahih-muslim",
      "sahihmuslim":      "sahih-muslim",
      "sahih-muslim":     "sahih-muslim",
      "tirmidhi":         "al-tirmidhi",
      "abudawood":        "abu-dawood",
      "abu-dawood":       "abu-dawood",
      "abu-dawud":        "abu-dawood",
      "abudawud":         "abu-dawood",
      "ibnmajah":         "ibn-e-majah",
      "ibn-majah":        "ibn-e-majah",
      "nasai":            "sunan-nasai",
      "alnasai":          "sunan-nasai",
      "sunan-nasai":      "sunan-nasai",
      "musnadahmad":      "musnad-ahmad",
      "musnad-ahmad":     "musnad-ahmad",
      "mishkat":          "mishkat",
      "silsilasahiha":    "al-silsila-sahiha",
      "silsila-sahiha":   "al-silsila-sahiha",
    };
    const key = hadithMatch[1].toLowerCase().replace(/[ ]/g, "-").replace(/-+/g, "-");
    const slug = slugMap[key] ?? slugMap[key.replace(/-/g, "")] ?? key;
    return { book: slug, number: hadithMatch[2] };
  }
  return {};
}

async function verifyQuran(
  supabase: ReturnType<typeof createClient>,
  surah: number,
  verse: number,
): Promise<{ row: any | null }> {
  const { data, error } = await supabase
    .from("scholarly_documents")
    .select("content, content_ar, citation_ref, source_url, domain")
    .eq("source_type", "quran")
    .or(`and(citation_ref->>surah_number.eq.${surah},citation_ref->>verse.eq.${verse})`)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[verifier] quran lookup error:", error);
    return { row: null };
  }
  return { row: data ?? null };
}

async function verifyHadith(
  supabase: ReturnType<typeof createClient>,
  book: string,
  number: string | number,
): Promise<{ row: any | null }> {
  const num = String(number);
  const { data, error } = await supabase
    .from("scholarly_documents")
    .select("content, content_ar, citation_ref, source_url, domain")
    .eq("source_type", "hadith")
    .or(`and(citation_ref->>book.eq.${book},citation_ref->>hadith_number.eq.${num})`)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[verifier] hadith lookup error:", error);
    return { row: null };
  }
  return { row: data ?? null };
}

/** Verify a single raw LLM citation. Returns the verified citation (with the
 *  authoritative DB-stored Arabic + translation overriding the LLM's text) or
 *  null if it can't be confirmed. */
export async function verifyOne(
  raw: RawLlmCitation,
  supabase: ReturnType<typeof createClient>,
): Promise<VerifiedCitation | null> {
  let surah = typeof raw.surah === "string" ? parseInt(raw.surah, 10) : raw.surah;
  let verse = typeof raw.verse === "string" ? parseInt(raw.verse, 10) : raw.verse;
  let book  = raw.book;
  let number = raw.hadith_number != null ? String(raw.hadith_number) : undefined;

  if ((surah == null || verse == null) && (!book || !number) && raw.reference) {
    const parsed = parseReference(raw.reference);
    surah = surah ?? parsed.surah;
    verse = verse ?? parsed.verse;
    book  = book  ?? parsed.book;
    number = number ?? parsed.number;
  }

  if (surah != null && verse != null && !Number.isNaN(surah) && !Number.isNaN(verse)) {
    const { row } = await verifyQuran(supabase, surah, verse);
    if (!row) return null;
    const cite = row.citation_ref ?? {};
    return {
      index:        raw.index ?? 0,
      arabic:       (row.content_ar || row.content || raw.arabic || "").toString(),
      translation:  raw.translation ?? row.content ?? "",
      reference:    `Qur'an ${surah}:${verse}` + (cite.surah_name ? ` (${cite.surah_name})` : ""),
      match_key:    `quran:${surah}:${verse}`,
      verified:     true,
      source_url:   row.source_url ?? cite.url ?? raw.source_url,
      surah, verse,
    };
  }

  if (book && number) {
    const { row } = await verifyHadith(supabase, book, number);
    if (!row) return null;
    const cite = row.citation_ref ?? {};
    return {
      index:        raw.index ?? 0,
      arabic:       (row.content_ar || row.content || raw.arabic || "").toString(),
      translation:  raw.translation ?? row.content ?? "",
      reference:    `${cite.collection ?? book}, Hadith ${number}` + (cite.grade ? ` (${cite.grade})` : ""),
      match_key:    `hadith:${book}:${number}`,
      verified:     true,
      source_url:   row.source_url ?? cite.url ?? raw.source_url,
      book, hadith_number: number,
    };
  }

  return null;
}

/** Bulk-verify an array of LLM citations. Returns:
 *   verified: citations confirmed to exist in scholarly_documents
 *   rejected: raw citations that could not be confirmed (for UI feedback) */
export async function verifyAll(
  raws: RawLlmCitation[],
  supabase: ReturnType<typeof createClient>,
): Promise<{ verified: VerifiedCitation[]; rejected: RawLlmCitation[] }> {
  const verified: VerifiedCitation[] = [];
  const rejected: RawLlmCitation[]   = [];
  // Run in parallel — each lookup is independent.
  const checks = await Promise.all(raws.map((r) => verifyOne(r, supabase)));
  for (let i = 0; i < raws.length; i++) {
    const v = checks[i];
    if (v) verified.push({ ...v, index: i + 1 });
    else   rejected.push(raws[i]);
  }
  return { verified, rejected };
}
