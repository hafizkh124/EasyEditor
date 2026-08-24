/**
 * The source catalogue behind the Islamic-mode source picker.
 *
 * Every `id` here is a domain string `islamic-search/index.ts` recognises in
 * its `ALL_DOMAINS` list — this file is the UI-side half of that contract, and
 * an id that does not appear there is silently dropped by the backend's
 * `effectiveDomains` filter, so `src/test/researchSources.test.ts` pins the two
 * lists together.
 *
 * The grouping mirrors the backend's retrieval tiers rather than inventing a
 * user-facing taxonomy: a scholar deciding what to trust cares exactly about
 * the distinction the tiers encode — a verified local corpus, a third-party
 * API, or a page scraped live from someone's website.
 *
 * Deliberately NOT listed: `shamela-index`. It is a Tier-B id the backend
 * accepts, but Shamela has never been ingested into scholarly_documents, so
 * `vector-search`'s PSEUDO_DOMAIN_EXPANSION maps it to nothing on purpose (see
 * the comment there). Offering a checkbox that can only ever return zero
 * results would be a worse lie than not offering it.
 *
 * The "classical" group is the explicit entry point Corpus Atlas finding #4
 * asked for: before islamic-search's Tier D existed, these disciplines —
 * 19,616 narrator-biography rows, 6,208 tafsir rows, the Quran lexicon, and
 * 22,775 fatwa rulings — were reachable from no chat surface at all, not even
 * implicitly.
 *
 * `classical-fatwa` joined them on 2026-08-23 (Atlas finding #5). It was left
 * out a day earlier on the belief that fatwa had no ingested rows — a belief
 * read off `DISCIPLINE_DOMAINS`, which was itself missing `urdufatwa`. The
 * rulings were in the corpus and fully embedded the whole time; only the
 * mapping was wrong. Worth remembering as a pattern: an empty-looking
 * discipline is more often a stale mapping than an empty corpus.
 *
 * Still not offered, for the same reason `shamela-index` above is not: fiqh
 * and nahw live only in `shamela` (never ingested, 0 rows) and
 * `openiti-index` (ingested, but as general classical prose whose discipline
 * tagging is unverified), so a checkbox for either could only ever return
 * nothing.
 */

export type SourceGroupId = "corpus" | "classical" | "api" | "web";

export interface ResearchSource {
  /** Domain id sent to islamic-search. Must exist in its ALL_DOMAINS. */
  id: string;
  /** Urdu label. */
  ur: string;
  /** One-line note on what this actually is, shown under the label. */
  note: string;
  group: SourceGroupId;
}

export const SOURCE_GROUPS: Array<{ id: SourceGroupId; ur: string; note: string }> = [
  { id: "corpus", ur: "مقامی کارپس", note: "ہمارے اپنے ڈیٹابیس میں محفوظ، تصدیق شدہ متون" },
  { id: "classical", ur: "کلاسیکی موضوعات", note: "رجال، تفسیر اور لغت — عام قرآن و حدیث تلاش سے الگ" },
  { id: "api", ur: "براہِ راست API", note: "بیرونی خدمات سے فوری استفسار" },
  { id: "web", ur: "ویب سائٹس", note: "سوال کے وقت لائیو پڑھی جانے والی سائٹس" },
];

export const RESEARCH_SOURCES: ResearchSource[] = [
  // Tier K / Tier B — the corpus this project owns.
  { id: "tanzil", ur: "تنزیل — قرآن", note: "6,236 آیات، عثمانی متن", group: "corpus" },
  { id: "hadith-index", ur: "حدیث کارپس — معنوی تلاش", note: "بخاری، مسلم، مسند احمد، مصنف ابن ابی شیبہ سمیت ~350,000 احادیث، مفہوم کی بنیاد پر", group: "corpus" },
  { id: "hadith-json", ur: "حدیث کارپس — لفظی تلاش", note: "انہی احادیث میں الفاظ و اصطلاحات کی براہِ راست تلاش", group: "corpus" },
  { id: "openiti-index", ur: "OpenITI — کلاسیکی عربی", note: "کلاسیکی عربی نثر کا ذخیرہ", group: "corpus" },

  // Tier D — the Tier-2 classical corpus, scoped by discipline rather than
  // by domain. Auto-detected from the question ("راوی کا حال" → رجال) even
  // when nothing here is checked; checking one explicitly also forces that
  // discipline's search to run on a question that doesn't name it directly.
  { id: "classical-rijal", ur: "اسماء الرجال", note: "راویوں کے حالات و تراجم — جرح و تعدیل", group: "classical" },
  { id: "classical-tafsir", ur: "تفسیر ابن کثیر", note: "آیت بہ آیت تفسیر", group: "classical" },
  { id: "classical-lughat", ur: "لغتِ قرآن", note: "الفاظ کے لغوی معانی و مادہ", group: "classical" },
  { id: "classical-fatwa", ur: "فتاویٰ (موضوعاتی)", note: "22,775 اردو فتاویٰ — مفہوم کی بنیاد پر تلاش", group: "classical" },
  { id: "classical-mustalah", ur: "اصطلاحاتِ حدیث", note: "علوم الحدیث کی 66 اصطلاحات — متواتر، آحاد، مرسل، مدلس وغیرہ", group: "classical" },

  // Tier A — third-party APIs.
  { id: "dorar", ur: "دُرر السنیہ", note: "احادیث اور اُن کے درجات", group: "api" },
  { id: "alquran", ur: "AlQuran.cloud", note: "قرآن، متعدد تراجم", group: "api" },
  { id: "quran-com", ur: "Quran.com", note: "قرآن، تفسیر و ترجمہ", group: "api" },

  // Tier C — live-scraped sites.
  { id: "islamqa", ur: "IslamQA", note: "فتاویٰ", group: "web" },
  { id: "islamweb", ur: "IslamWeb", note: "فتاویٰ", group: "web" },
  { id: "urdufatwa", ur: "اردو فتویٰ", note: "اردو فتاویٰ (22,775 مقامی رولنگز بھی)", group: "web" },
  { id: "alulama", ur: "العلماء", note: "علمی مضامین و فتاویٰ", group: "web" },
  { id: "islamicurdubooks", ur: "اسلامک اردو بکس", note: "احادیث، تفسیر، اسماء الرجال", group: "web" },
  { id: "shamilaurdu", ur: "شاملہ اردو", note: "اردو کتب خانہ", group: "web" },
  { id: "mohaddis", ur: "محدث", note: "محدث لائبریری", group: "web" },
  { id: "magazine-mohaddis", ur: "ماہنامہ محدث", note: "علمی مجلہ", group: "web" },
  { id: "islamfort", ur: "اسلام فورٹ", note: "اردو اسلامی مواد", group: "web" },
  { id: "alminasa", ur: "المنصہ", note: "عربی علمی مواد", group: "web" },
  { id: "shamela", ur: "المکتبۃ الشاملۃ", note: "کلاسیکی عربی کتب", group: "web" },
];

export const ALL_SOURCE_IDS: string[] = RESEARCH_SOURCES.map((s) => s.id);

/**
 * What to actually send to islamic-search.
 *
 * `undefined` means "search everything" — the backend reads
 * `selectedDomains ?? ALL_DOMAINS`, so an EMPTY ARRAY is not the same thing:
 * it filters the fan-out down to nothing and every tier returns zero results.
 * An empty selection in the UI means the user has not narrowed anything, which
 * is the default and must map to `undefined`, never to `[]`.
 */
export function toSelectedDomains(selection: string[]): string[] | undefined {
  if (selection.length === 0) return undefined;
  const valid = selection.filter((id) => ALL_SOURCE_IDS.includes(id));
  if (valid.length === 0 || valid.length === ALL_SOURCE_IDS.length) return undefined;
  return valid;
}

/** Drop ids that are no longer in the catalogue (a stale localStorage value
 *  from before a source was renamed or removed). */
export function sanitizeSelection(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string" && ALL_SOURCE_IDS.includes(id));
}
