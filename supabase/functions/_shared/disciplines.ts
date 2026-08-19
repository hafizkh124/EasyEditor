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
  "fiqh", "fatwa", "tafsir", "lughat", "rijal", "nahw",
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
};

/** scholarly_documents.domain values each discipline can live in. Used to
 *  build the filter_domains argument for match_scholarly_documents (the
 *  semantic channel filters on domain, not on citation_ref->>'discipline').
 *  Keep in sync with the domains the loaders write. */
export const DISCIPLINE_DOMAINS: Record<Discipline, string[]> = {
  fiqh:   ["shamela", "openiti"],
  fatwa:  ["shamela", "openiti", "islamqa-cache"],
  tafsir: ["qul-tafsir", "shamela", "openiti", "islamicurdubooks-tafsir"],
  lughat: ["shamela", "openiti", "islamicurdubooks-lexicon"],
  rijal:  ["shamela", "openiti", "islamicurdubooks-rijal"],
  nahw:   ["shamela", "openiti"],
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
