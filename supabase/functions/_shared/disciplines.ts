// Tier-2 discipline registry — the classical-corpus scope dimension.
//
// The Quran/Hadith retrieval path scopes by source_type ("quran" | "hadith")
// and collection. Tier-2 (Shamela / OpenITI classical corpus) adds a second
// dimension: the *discipline* a book belongs to. Every ingested Tier-2 row
// carries citation_ref->>'discipline' set to one of DISCIPLINE_SLUGS, so the
// retrieval layer can scope a fiqh question to fiqh books, a rijal question to
// rijal books, and so on — without one giant undifferentiated "classical" bag.
//
// This module is the single source of truth for:
//   - the valid discipline slugs (mirrored in scripts/classical_to_csv.py)
//   - their Urdu display labels
//   - which scholarly_documents.domain values each discipline lives in
//     (used to scope the pgvector semantic channel, which filters on domain)
//   - a conservative keyword detector for the model-less fallback plan.
//
// The LLM query planner is the primary path for choosing disciplines; the
// keyword detector here is only the safety net when the model is unavailable.

export const DISCIPLINE_SLUGS = [
  "fiqh", "fatwa", "tafsir", "lughat", "rijal", "nahw", "hadith_term",
] as const;

export type Discipline = (typeof DISCIPLINE_SLUGS)[number];

/** Urdu display labels, shown when describing the active scope to the user. */
export const DISCIPLINE_LABELS_UR: Record<Discipline, string> = {
  fiqh:   "فقہ",
  fatwa:  "فتاویٰ",
  tafsir: "تفسیر",
  lughat: "لغت",
  rijal:  "رجال",
  nahw:   "نحو و صرف",
  // Slug is "hadith_term", not the more idiomatic "mustalah", because it has
  // to equal the value ingest wrote into citation_ref->>'discipline' --
  // classicalSemanticChannel post-filters on exactly that string. Renaming the
  // slug would mean rewriting 66 rows to gain nothing a user ever sees; the
  // Urdu label below is what actually reaches the scope line.
  hadith_term: "اصطلاحاتِ حدیث",
};

/** scholarly_documents.domain values each discipline can live in. Used to
 *  build the filter_domains argument for match_scholarly_documents (the
 *  semantic channel filters on domain, not on citation_ref->>'discipline').
 *  Keep in sync with the domains the loaders write.
 *
 *  A name in here that no loader actually writes is invisible: it simply
 *  matches no rows, and the discipline looks empty rather than broken. Two
 *  such names were found and fixed on 2026-08-23:
 *
 *    - `urdufatwa` was missing from `fatwa` entirely, even though
 *      scripts/scrapers/ingest_fatwa.py writes 22,775 rows there with
 *      citation_ref.discipline = "fatwa" — the largest fatwa corpus we have,
 *      fully embedded, and unreachable by every semantic path because of this
 *      one omission.
 *    - `openiti` is not a domain. The corpus stores `openiti-index` (see
 *      vector-search's TIER_B_DOMAINS and the Corpus Atlas domain census), so
 *      every discipline's openiti entry matched zero rows.
 *
 *  `shamela` is knowingly aspirational — Shamela has never been ingested (0
 *  rows). It is kept so the mapping is right the day it is, and costs nothing
 *  because filter_domains on an absent domain simply matches nothing. */
export const DISCIPLINE_DOMAINS: Record<Discipline, string[]> = {
  fiqh:   ["shamela", "openiti-index"],
  fatwa:  ["shamela", "openiti-index", "islamqa-cache", "urdufatwa"],
  tafsir: ["qul-tafsir", "shamela", "openiti-index", "islamicurdubooks-tafsir"],
  lughat: ["shamela", "openiti-index", "islamicurdubooks-lexicon"],
  rijal:  ["shamela", "openiti-index", "islamicurdubooks-rijal"],
  nahw:   ["shamela", "openiti-index"],
  // 66 rows: the اصطلاحاتِ حدیث taxonomy (13 categories -- types of hadith by
  // acceptance, by narrator count, by chain interruption, ...). Deliberately
  // excluded from ranked search by the Corpus Atlas's reasoning (definitions
  // would crowd out real hadith in top-k), and reachable here only because
  // the discipline channel fires ONLY when the query is explicitly about
  // terminology -- see DISCIPLINE_MARKERS.hadith_term below.
  hadith_term: ["islamicurdubooks-misc"],
};

/** Conservative Urdu/Arabic/English keyword patterns per discipline, used ONLY
 *  by the fallback plan when the model is down. Deliberately narrow — a false
 *  positive just adds an (currently empty) classical channel, but we still keep
 *  it tight so it doesn't fire on ordinary Quran/Hadith questions. */
const DISCIPLINE_MARKERS: Record<Discipline, RegExp> = {
  fiqh:   /فقہ|فقه|فقہی|مذاہب\s*اربعہ|المذاهب|حنفی|حنفي|شافعی|شافعي|مالکی|مالكي|حنبلی|حنبلي|\bfiqh\b/i,
  fatwa:  /فتاو[یٰي]ٰ?|فتویٰ|فتوی|الفتاوى|استفتاء|\bfatwa\b|\bfatawa\b/i,
  tafsir: /تفسیر|تفسير|مفسر|المفسرين|\btafsir\b|\btafseer\b/i,
  lughat: /لغت|لغوی|لغوي|معجم|القاموس|مفردات|مادہ\s*لغوی|\blughat\b|\blexicon\b/i,
  rijal:  /رجال|الرجال|جرح\s*و\s*تعدیل|الجرح\s*والتعديل|طبقات|راوی\s*کا\s*ترجمہ|\brijal\b/i,
  // Bare "صرف" is an everyday word ("only/spending"), so require the more
  // specific forms (علم النحو / النحو / الصرف / إعراب / ترکیب نحوی).
  nahw:   /علم\s*النحو|النحو|الصرف|إعراب|اعرابِ|ترکیب\s*نحوی|\bnahw\b|\bi'?rab\b/i,
  // Names of the terminology itself, never words that merely appear near a
  // hadith. Bare "حدیث" is excluded deliberately — it is in almost every query
  // this app sees, and matching it would attach a definitions corpus to every
  // ordinary hadith question.
  hadith_term: /اصطلاح|اصطلاحات|مصطلح|علوم\s*الحدیث|اصول\s*حدیث|حدیث\s*کی\s*اقسام|متواتر|آحاد|مرفوع|موقوف|مقطوع|معلق|مرسل|مدلس|\bmustalah\b/i,
};

/** Detect disciplines named/implied in a free-text query (fallback path). */
export function detectDisciplines(query: string): Discipline[] {
  const q = query ?? "";
  return DISCIPLINE_SLUGS.filter((d) => DISCIPLINE_MARKERS[d].test(q));
}

/** Validate an arbitrary list against the registry (LLM-output trust boundary). */
export function coerceDisciplines(raw: unknown): Discipline[] {
  if (!Array.isArray(raw)) return [];
  const out: Discipline[] = [];
  for (const v of raw) {
    if (typeof v === "string" && (DISCIPLINE_SLUGS as readonly string[]).includes(v)) {
      if (!out.includes(v as Discipline)) out.push(v as Discipline);
    }
  }
  return out;
}

/** Union of domains for a set of disciplines (for the semantic domain filter). */
export function disciplineDomains(slugs: string[]): string[] {
  const set = new Set<string>();
  for (const s of slugs) {
    const doms = DISCIPLINE_DOMAINS[s as Discipline];
    if (doms) doms.forEach((d) => set.add(d));
  }
  return [...set];
}

/** Urdu label list for the active disciplines, for the scope description. */
export function describeDisciplines(slugs: string[]): string {
  return slugs
    .map((s) => DISCIPLINE_LABELS_UR[s as Discipline] ?? s)
    .join("، ");
}
