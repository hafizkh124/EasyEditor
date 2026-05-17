// Stopword lists for Urdu / Arabic / English Islamic-research queries.
//
// Why: the smart-search RPC scores rows by counting how many query terms
// match. Without stopword filtering, generic words like "آیات", "اور", "the"
// drown out the actual content terms — e.g. for "نماز سے متعلق آیات", the
// row for 7:174 ("وَكَذَٰلِكَ نُفَصِّلُ ٱلْـَٔايَـٰتِ") scored equal to 2:43
// ("وَأَقِيمُوا الصَّلَاةَ") because both matched one term ("آیات" vs "الصلاۃ"),
// and the unrelated verse won by row id.
//
// `expandQueryTerms` strips these BEFORE adding to the expansion-set. They
// remain in the original query string (so a full-phrase FTS match still
// benefits) — they just never become standalone search terms.

const STOPWORDS_UR = new Set<string>([
  // structural particles / pronouns
  "سے", "کا", "کی", "کے", "اور", "بھی", "نہیں", "ہے", "ہیں", "ہو", "ہوا", "ہوتا",
  "تو", "جو", "کہ", "پر", "میں", "کو", "نے", "تک", "پھر", "اگر", "جب", "لیکن",
  "یہ", "وہ", "اس", "اسی", "اسے", "ان", "انہیں", "اپنا", "اپنی", "اپنے",
  // generic "tell me about / list" markers — high-frequency, low-information
  "آیات", "اَیات", "احادیث", "حدیث", "ذکر", "بیان", "کریں", "کیا", "پیش", "تفصیل",
  "متعلق", "بارے", "حوالہ", "حوالے", "مثلاً", "کیسے", "کیوں", "کوئی", "کچھ",
  "ساتھ", "بغیر", "تحت", "خاص", "عام",
]);

const STOPWORDS_AR = new Set<string>([
  // particles + prepositions + demonstratives
  "من", "إلى", "الى", "على", "في", "عن", "أن", "إن", "أنه", "أنها", "لا", "ما",
  "هذا", "هذه", "ذلك", "تلك", "الذي", "التي", "الذين", "اللاتي",
  "و", "ف", "ب", "ل", "ك",
  // generic "verses / hadiths about" terms
  "آيات", "آية", "أحاديث", "حديث", "ذكر", "بيان", "متعلق", "حول",
  "كيف", "لماذا", "متى", "أين", "هل",
]);

const STOPWORDS_EN = new Set<string>([
  "a", "an", "the", "of", "in", "on", "at", "to", "for", "from", "by", "with",
  "and", "or", "but", "if", "so", "as", "is", "are", "was", "were", "be", "been",
  "have", "has", "had", "do", "does", "did", "can", "could", "should", "would",
  "this", "that", "these", "those", "it", "its",
  // generic question / list words
  "what", "how", "why", "when", "where", "who", "whom",
  "please", "list", "give", "tell", "show", "explain", "describe",
  "about", "regarding", "concerning", "related", "verses", "hadiths",
  "hadith", "verse", "ayah", "ayat", "ayaat",
]);

/**
 * True if `token` is a stopword in any of the three scripts. Comparison is
 * case-insensitive for English; Urdu/Arabic are matched literally (script is
 * already distinguishing).
 */
export function isStopword(token: string): boolean {
  if (!token) return true;
  if (STOPWORDS_UR.has(token)) return true;
  if (STOPWORDS_AR.has(token)) return true;
  if (STOPWORDS_EN.has(token.toLowerCase())) return true;
  return false;
}

/** Remove stopwords from an array of tokens. Preserves order and dedupes. */
export function dropStopwords(tokens: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    if (!t || isStopword(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
