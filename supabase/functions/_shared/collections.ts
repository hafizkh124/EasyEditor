// Canonical hadith-collection registry for the retrieval layer.
//
// WHY THIS EXISTS
// ---------------
// `queryPlanner.ts` used to hold a flat `COLLECTION_SLUGS` array of 17 strings
// copied from scripts/hadith_json_to_csv.py, and the LLM was allowed to pick
// scope targets only from that array. Two things were wrong with it:
//
//   1. It predated every ingestion after hadith-json. The 17 IUB books, the 5
//      easyquran-hadith books and the 14 tohed-hadith books could never be
//      named as a scope target, so "صرف مستدرک حاکم میں" was silently dropped
//      and the query fell back to searching everything.
//
//   2. A slug in that list is NOT necessarily the string stored in
//      `citation_ref->>'collection'`. Several books were ingested by older,
//      independent pipelines that never agreed on a naming convention, and a
//      later de-duplication kept whichever copy was larger. Confirmed against
//      a live pull of 33,080 rows (data/citation_backup_20260823_141244.csv,
//      2026-08-23): the surviving strings include `mishkat_almasabih`,
//      `aladab_almufrad`, `shamail_muhammadiyah` and `Muwatta Malik` — while
//      the planner's allowlist offered `mishkat`, `adab` and `malik`. Scoping
//      to مشکاۃ therefore matched zero rows even though 3,231 of them exist.
//
// THE FIX
// -------
// The planner now picks a CANONICAL BOOK ID (the `id` field below), and the
// retrieval layer expands that id to every `collection` string the book is
// known to be stored under before it reaches SQL. `p_collections` is an array
// parameter, so listing several variants costs nothing: the ones that don't
// exist simply match no rows, and the one that does matches all of them. That
// makes the mapping robust to naming drift instead of silently wrong when a
// guess is off — the exact failure mode this module replaces.
//
// SOURCES OF TRUTH used to build the table (all in-repo, all verifiable):
//   - live: data/citation_backup_*.csv (11 collections, pulled 2026-08-23)
//   - live: scripts/iub/registry.py `db_collection` (discovered live 2026-08-20)
//   - scripts/hadith_json_to_csv.py COLLECTION_META      (hadith-json, 17)
//   - scripts/convert_excel_to_csv.py COLLECTION_SLUGS   (urdu-hadith, 7)
//   - scripts/tohed_hadith_scraper.py TARGET_BOOKS       (tohed-hadith, 14)
//   - scripts/extract_easyhadees_books.py TARGET_BOOKS + registry.py
//                                                        (easyquran-hadith, 5)
//   - scripts/iub/registry.py is_new entries             (islamicurdubooks, 17)
//
// Run `python scripts/verify_collection_slugs.py` (needs the service-role key)
// to re-check every slug below against the live corpus and print any that
// match zero rows.

export interface CorpusBook {
  /** Canonical id — the only value the planner is allowed to emit. */
  id: string;
  /** Urdu label, shown back to the user in the scope line. */
  ur: string;
  /** Arabic title, used for name matching on Arabic queries. */
  ar: string;
  /** Every `citation_ref->>'collection'` string this book is known to be
   *  stored under, across every domain. Passed to SQL as a set. */
  slugs: string[];
  /** Domains the rows live in. Documentation + reachability reporting. */
  domains: string[];
  /** False when NO Arabic matn is stored for this book anywhere in the corpus
   *  (the tohed-hadith-only books — see the Corpus Atlas, 2026-08-20). Those
   *  are invisible to `search_documents_scoped`, which filters on
   *  `content_ar IS NOT NULL`; they can only be reached through the Urdu
   *  translation via `search_documents_smart`. Callers use this to pick the
   *  right RPC instead of running an Arabic-only search that must return 0. */
  arabicMatn: boolean;
  /** Extra surface names a user may type. Matched TOKEN-WISE, never as a
   *  substring — "مسلمان" must not scope a query to صحیح مسلم. */
  aliases?: string[];
}

export const CORPUS_BOOKS: CorpusBook[] = [
  // ── hadith-json + urdu-hadith (the two share lowercase slugs) ─────────────
  { id: "bukhari", ur: "صحیح بخاری", ar: "صحيح البخاري",
    slugs: ["bukhari"], domains: ["hadith-json", "urdu-hadith"], arabicMatn: true,
    aliases: ["بخاری", "بخاري", "البخاري", "bukhari"] },
  { id: "muslim", ur: "صحیح مسلم", ar: "صحيح مسلم",
    slugs: ["muslim"], domains: ["hadith-json", "urdu-hadith"], arabicMatn: true,
    aliases: ["مسلم شریف", "مسلم شريف", "muslim"] },
  { id: "tirmidhi", ur: "جامع ترمذی", ar: "سنن الترمذي",
    slugs: ["tirmidhi"], domains: ["hadith-json", "urdu-hadith"], arabicMatn: true,
    aliases: ["ترمذی", "ترمذي", "الترمذي", "tirmidhi"] },
  { id: "abudawud", ur: "سنن ابو داؤد", ar: "سنن أبي داود",
    slugs: ["abudawud"], domains: ["hadith-json", "urdu-hadith"], arabicMatn: true,
    aliases: ["ابو داؤد", "ابو داود", "ابوداؤد", "ابوداود", "abu dawud", "abudawud", "abudawood"] },
  { id: "ibnmajah", ur: "سنن ابن ماجہ", ar: "سنن ابن ماجه",
    slugs: ["ibnmajah"], domains: ["hadith-json", "urdu-hadith"], arabicMatn: true,
    aliases: ["ماجہ", "ماجه", "ibnmajah"] },
  { id: "nasai", ur: "سنن نسائی", ar: "سنن النسائي",
    slugs: ["nasai"], domains: ["hadith-json", "urdu-hadith"], arabicMatn: true,
    aliases: ["نسائی", "نسائي", "النسائي", "nasai"] },
  // Live-confirmed: the surviving hadith-json copy is stored as "Muwatta Malik".
  { id: "malik", ur: "موطأ امام مالک", ar: "موطأ مالك",
    slugs: ["malik", "Muwatta Malik"], domains: ["hadith-json", "urdu-hadith"], arabicMatn: true,
    aliases: ["موطأ", "موطا", "امام مالک", "مالک کی موطا", "malik", "muwatta"] },
  { id: "darimi", ur: "سنن دارمی", ar: "سنن الدارمي",
    slugs: ["darimi"], domains: ["hadith-json"], arabicMatn: true,
    aliases: ["دارمی", "دارمي", "الدارمي", "darimi"] },
  { id: "ahmed", ur: "مسند احمد", ar: "مسند أحمد",
    slugs: ["ahmed", "musnad-ahmad"], domains: ["hadith-json", "easyquran-hadith"], arabicMatn: true,
    aliases: ["مسنداحمد", "مسند احمد", "musnad ahmad", "musnad ahmed"] },
  { id: "nawawi40", ur: "اربعین نووی", ar: "الأربعون النووية",
    slugs: ["nawawi40"], domains: ["hadith-json"], arabicMatn: true,
    aliases: ["اربعین", "الأربعون", "نووی", "النووية", "nawawi"] },
  // Live-confirmed 2026-08-23 (SELECT collection, count(*) FROM
  // scholarly_documents WHERE domain='hadith-json' GROUP BY collection):
  // hadith-json actually stores this as "qudsi40" / "The Forty Hadith Qudsi",
  // never bare "qudsi" -- the original slug matched zero rows.
  { id: "qudsi", ur: "احادیث قدسیہ", ar: "الأحاديث القدسية",
    slugs: ["qudsi", "qudsi40", "The Forty Hadith Qudsi"], domains: ["hadith-json"], arabicMatn: true,
    aliases: ["قدسی", "قدسیہ", "القدسية", "qudsi"] },
  // Live-confirmed 2026-08-23: hadith-json stores this under TWO real strings
  // ("riyad_assalihin", 1,896 rows; "Riyad as-Salihin", 589 rows) -- the
  // original single guessed slug "riyadussalihin" matched neither.
  { id: "riyadussalihin", ur: "ریاض الصالحین", ar: "رياض الصالحين",
    slugs: ["riyadussalihin", "riyad_assalihin", "Riyad as-Salihin"], domains: ["hadith-json"], arabicMatn: true,
    aliases: ["الصالحین", "الصالحين", "riyad us salihin", "riyadussalihin"] },
  // Live-confirmed 2026-08-23: hadith-json also stores this under
  // "bulugh_almaram" (1,767 rows) and "Bulugh al-Maram" (400 rows) -- neither
  // matched the original two slugs, leaving 2,167 hadith-json rows
  // unreachable (separate from the islamicurdubooks-hadith IUB copy below).
  { id: "bulughalmaram", ur: "بلوغ المرام", ar: "بلوغ المرام",
    slugs: ["bulughalmaram", "bulugh-al-maram", "bulugh_almaram", "Bulugh al-Maram"],
    domains: ["hadith-json", "islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["بلوغ", "المرام", "bulugh"] },
  // Live-confirmed: hadith-json stores الأدب المفرد as "aladab_almufrad".
  { id: "adab", ur: "الأدب المفرد", ar: "الأدب المفرد",
    slugs: ["adab", "aladab_almufrad"], domains: ["hadith-json"], arabicMatn: true,
    aliases: ["المفرد", "ادب المفرد", "adab al mufrad", "mufrad"] },
  { id: "shahih-al-jami", ur: "صحیح الجامع", ar: "صحيح الجامع",
    slugs: ["shahih-al-jami"], domains: ["hadith-json"], arabicMatn: true,
    aliases: ["صحیح الجامع", "صحيح الجامع", "sahih al jami"] },
  // Live-confirmed: hadith-json stores مشکاۃ as "mishkat_almasabih";
  // tohed-hadith carries a second copy under "mishkat-al-masabih".
  // Live-confirmed 2026-08-23: hadith-json ALSO stores 800 rows under the
  // capitalized "Mishkat al-Masabih" (space-separated, no underscore/hyphen)
  // alongside the already-known "mishkat_almasabih" (4,428 rows) -- a third
  // real variant the original two-slug list (plus the always-dead "mishkat")
  // didn't cover.
  { id: "mishkat", ur: "مشکاۃ المصابیح", ar: "مشكاة المصابيح",
    slugs: ["mishkat", "mishkat_almasabih", "mishkat-al-masabih", "Mishkat al-Masabih"],
    domains: ["hadith-json", "tohed-hadith"], arabicMatn: true,
    aliases: ["مشکاۃ", "مشکوۃ", "مشكاة", "المصابیح", "المصابيح", "mishkat"] },
  { id: "hisn-alhisar", ur: "حصن المسلم", ar: "حصن المسلم",
    slugs: ["hisn-alhisar", "hisn-al-muslim"],
    domains: ["hadith-json", "islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["حصن", "hisn"] },
  // Live-confirmed: stored as "shamail_muhammadiyah", never as "shamail".
  { id: "shamail", ur: "شمائل ترمذی", ar: "الشمائل المحمدية",
    slugs: ["shamail_muhammadiyah", "shamail-tirmidhi"], domains: ["hadith-json"], arabicMatn: true,
    aliases: ["شمائل", "الشمائل", "shamail"] },

  // ── easyquran-hadith (100% Arabic matn — the healthiest slice) ────────────
  { id: "musannaf-ibn-abi-shaybah", ur: "مصنف ابن ابی شیبہ", ar: "مصنف ابن أبي شيبة",
    slugs: ["musannaf-ibn-abi-shaybah"],
    domains: ["easyquran-hadith", "tohed-hadith"], arabicMatn: true,
    aliases: ["شیبہ", "شيبة", "مصنف ابن ابی شیبہ", "musannaf"] },
  { id: "sunan-kubra-bayhaqi", ur: "السنن الکبریٰ للبیہقی", ar: "السنن الكبرى للبيهقي",
    slugs: ["sunan-kubra-bayhaqi"], domains: ["easyquran-hadith"], arabicMatn: true,
    aliases: ["بیہقی", "البيهقي", "بيهقي", "bayhaqi", "baihaqi"] },
  { id: "kanz-ul-ummal", ur: "کنز العمال", ar: "كنز العمال",
    slugs: ["kanz-ul-ummal"], domains: ["easyquran-hadith"], arabicMatn: true,
    aliases: ["کنز", "كنز", "العمال", "kanz"] },
  { id: "tahawi-shareef", ur: "طحاوی شریف (شرح معانی الآثار)", ar: "شرح معاني الآثار",
    slugs: ["tahawi-shareef"], domains: ["easyquran-hadith"], arabicMatn: true,
    aliases: ["طحاوی", "طحاوي", "الطحاوي", "tahawi"] },

  // ── formerly tohed-hadith-only, re-sourced from IUB 2026-08-24 ────────────
  // These 11 had NO Arabic matn anywhere in the corpus (Corpus Atlas finding
  // #2) until this date: tohed.com's own export never carried it, confirmed
  // by scanning all 74,946 rows of data/tohed_hadiths.csv (0 with content_ar,
  // 0 with a recoverable matn in `content`). Re-scraped from
  // islamicurdubooks.com instead — full tashkeel matn, hukm, takhreej, and a
  // complete isnad chain on every book, live-verified before scraping.
  // 30,931 rows loaded under domain islamicurdubooks-hadith, 30,838 (99.7%)
  // with content_ar, all embedded. The superseded tohed-hadith rows for these
  // 11 books (33,446 of them) were then deleted -- the IUB copy is strictly
  // better (has everything tohed's did, plus matn/hukm/takhreej/isnad it
  // never did) and keeping both would only invite duplicate citations.
  //
  // Two of the eleven were re-slugged along the way: IUB's own registry
  // (scripts/iub/registry.py) stores "sunan-darqutni" / "sahih-ibn-khuzaimah"
  // where tohed used bare "darqutni" / "ibn-khuzaimah" -- ground-truthed
  // against the actual scraped CSVs (data/iub/*.csv), not assumed. The old
  // tohed slugs are dead now that those rows are gone; not carried forward.
  { id: "ibn-khuzaimah", ur: "صحیح ابن خزیمہ", ar: "صحيح ابن خزيمة",
    slugs: ["sahih-ibn-khuzaimah"], domains: ["islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["خزیمہ", "خزيمة", "khuzaimah"] },
  { id: "sahih-ibn-hibban", ur: "صحیح ابن حبان", ar: "صحيح ابن حبان",
    slugs: ["sahih-ibn-hibban"], domains: ["islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["حبان", "hibban"] },
  { id: "darqutni", ur: "سنن دارقطنی", ar: "سنن الدارقطني",
    slugs: ["sunan-darqutni"], domains: ["islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["دارقطنی", "الدارقطني", "دارقطني", "darqutni"] },
  { id: "silsilah-sahihah", ur: "سلسلہ احادیث صحیحہ", ar: "سلسلة الأحاديث الصحيحة",
    slugs: ["silsilah-sahihah"], domains: ["islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["الصحيحة", "سلسلہ صحیحہ", "silsilah sahihah"] },
  { id: "muntaqa-ibn-al-jarud", ur: "المنتقیٰ لابن الجارود", ar: "المنتقى لابن الجارود",
    slugs: ["muntaqa-ibn-al-jarud"], domains: ["islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["المنتقی", "المنتقى", "الجارود", "muntaqa"] },
  { id: "sunan-saeed-bin-mansur", ur: "سنن سعید بن منصور", ar: "سنن سعيد بن منصور",
    slugs: ["sunan-saeed-bin-mansur"], domains: ["islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["منصور", "سعید", "سعيد"] },
  { id: "lulu-wal-marjan", ur: "اللؤلؤ والمرجان", ar: "اللؤلؤ والمرجان",
    slugs: ["lulu-wal-marjan"], domains: ["islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["اللؤلؤ", "والمرجان", "المرجان"] },
  { id: "sahifa-hammam", ur: "صحیفہ ہمام بن منبہ", ar: "صحيفة همام بن منبه",
    slugs: ["sahifa-hammam"], domains: ["islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["صحیفہ", "صحيفة", "ہمام", "همام"] },
  { id: "musnad-shafii", ur: "مسند امام شافعی", ar: "مسند الإمام الشافعي",
    slugs: ["musnad-shafii"], domains: ["islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["شافعی", "الشافعي", "شافعي", "shafii"] },
  { id: "musnad-humaydi", ur: "مسند الحمیدی", ar: "مسند الحميدي",
    slugs: ["musnad-humaydi"], domains: ["islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["الحمیدی", "الحميدي", "humaydi"] },
  { id: "musnad-ishaq", ur: "مسند اسحاق بن راہویہ", ar: "مسند إسحاق بن راهويه",
    slugs: ["musnad-ishaq"], domains: ["islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["اسحاق", "إسحاق", "راہویہ", "راهويه", "ishaq"] },
  // Present in tohed WITHOUT Arabic and in IUB WITH Arabic — the IUB copy is
  // what makes an Arabic-term search on this book work, hence arabicMatn:true.
  { id: "sahih-adab-al-mufrad", ur: "صحیح الادب المفرد", ar: "صحيح الأدب المفرد",
    slugs: ["sahih-adab-al-mufrad", "sahih-adab-al-mufrad-iub"],
    domains: ["tohed-hadith", "islamicurdubooks-hadith"], arabicMatn: true },

  // ── islamicurdubooks-hadith (this corpus's most recent ingestion) ─────────
  { id: "jami-kamil", ur: "الجامع الکامل", ar: "الجامع الكامل في الحديث الصحيح الشامل",
    slugs: ["jami-kamil"], domains: ["islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["الکامل", "الكامل", "kamil"] },
  { id: "mustadrak-hakim", ur: "المستدرک علی الصحیحین", ar: "المستدرك على الصحيحين",
    slugs: ["mustadrak-hakim"], domains: ["islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["المستدرک", "المستدرك", "مستدرک حاکم", "mustadrak"] },
  // Ingested but deliberately NOT embedded — it duplicates Musnad Ahmad, which
  // is already in the corpus. Lexically searchable, semantically absent.
  { id: "fath-al-rabbani", ur: "الفتح الربانی", ar: "الفتح الرباني",
    slugs: ["fath-al-rabbani"], domains: ["islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["الربانی", "الرباني", "fath al rabbani"] },
  { id: "musnad-al-shihab", ur: "مسند الشہاب", ar: "مسند الشهاب",
    slugs: ["musnad-al-shihab"], domains: ["islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["الشہاب", "الشهاب", "shihab"] },
  { id: "silsilah-daeefah", ur: "سلسلہ احادیث ضعیفہ", ar: "سلسلة الأحاديث الضعيفة",
    slugs: ["silsilah-daeefah"], domains: ["islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["ضعیفہ", "الضعيفة", "daeefah"] },
  { id: "mujamm-saghir-tabarani", ur: "المعجم الصغیر للطبرانی", ar: "المعجم الصغير للطبراني",
    slugs: ["mujamm-saghir-tabarani"], domains: ["islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["طبرانی", "الطبراني", "معجم صغیر", "tabarani"] },
  { id: "sunan-mathurah-shafii", ur: "السنن المأثورہ للشافعی", ar: "السنن المأثورة",
    slugs: ["sunan-mathurah-shafii"], domains: ["islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["المأثورہ", "المأثورة"] },
  { id: "muwatta-malik-qasim", ur: "موطأ امام مالک (روایت ابن القاسم)", ar: "موطأ مالك رواية ابن القاسم",
    slugs: ["muwatta-malik-qasim"], domains: ["islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["ابن القاسم", "ابن قاسم", "ibn al qasim"] },
  { id: "musnad-ibn-al-mubarak", ur: "مسند عبداللہ بن مبارک", ar: "مسند عبد الله بن المبارك",
    slugs: ["musnad-ibn-al-mubarak"], domains: ["islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["المبارك", "ابن مبارک", "ابن المبارک", "ibn al mubarak"] },
  { id: "musnad-ibn-umar", ur: "مسند عبداللہ بن عمر", ar: "مسند عبد الله بن عمر",
    slugs: ["musnad-ibn-umar"], domains: ["islamicurdubooks-hadith"], arabicMatn: true },
  { id: "musnad-umar-bin-abdulaziz", ur: "مسند عمر بن عبدالعزیز", ar: "مسند عمر بن عبد العزيز",
    slugs: ["musnad-umar-bin-abdulaziz"], domains: ["islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["عبدالعزیز", "العزيز"] },
  { id: "musnad-abdurrahman-bin-awf", ur: "مسند عبدالرحمن بن عوف", ar: "مسند عبد الرحمن بن عوف",
    slugs: ["musnad-abdurrahman-bin-awf"], domains: ["islamicurdubooks-hadith"], arabicMatn: true,
    aliases: ["عوف", "awf"] },
  { id: "mukhtasar-bukhari", ur: "مختصر صحیح بخاری", ar: "مختصر صحيح البخاري",
    slugs: ["mukhtasar-bukhari"], domains: ["islamicurdubooks-hadith"], arabicMatn: true },
  { id: "mukhtasar-muslim", ur: "مختصر صحیح مسلم", ar: "مختصر صحيح مسلم",
    slugs: ["mukhtasar-muslim"], domains: ["islamicurdubooks-hadith"], arabicMatn: true },
];

/** Canonical ids — the allowlist the planner's output is validated against. */
export const BOOK_IDS: readonly string[] = CORPUS_BOOKS.map((b) => b.id);

const BY_ID = new Map(CORPUS_BOOKS.map((b) => [b.id, b]));

export function getBook(id: string): CorpusBook | undefined {
  return BY_ID.get(id);
}

/** Urdu label for a canonical id, falling back to the id itself. */
export function bookLabel(id: string): string {
  return BY_ID.get(id)?.ur ?? id;
}

/**
 * Expand canonical book ids to every `citation_ref->>'collection'` string they
 * are stored under. This is what goes into `p_collections`.
 *
 * Unknown ids are passed through unchanged rather than dropped: a caller may
 * legitimately hold a raw DB slug (an older saved plan, a scopeOverride from
 * another surface), and dropping it would silently widen the scope to
 * everything — the opposite of what the user asked for.
 */
export function resolveCollectionSlugs(ids: string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const book = BY_ID.get(id);
    if (book) for (const s of book.slugs) out.add(s);
    else out.add(id);
  }
  return [...out];
}

/**
 * True when at least one of the scoped books actually has Arabic matn stored.
 *
 * `search_documents_scoped` filters on `content_ar IS NOT NULL`, so a scope
 * made up entirely of tohed-only books can never return a row from it — the
 * caller must use `search_documents_smart` (which also matches the Urdu
 * `content`) and post-filter by collection instead. An empty scope means
 * "everything", which certainly includes Arabic.
 */
export function scopeHasArabicMatn(ids: string[]): boolean {
  if (ids.length === 0) return true;
  return ids.some((id) => BY_ID.get(id)?.arabicMatn !== false);
}

// ── Name matching ────────────────────────────────────────────────────────────

/** Diacritic/letter-variant normalization, close enough to SQL's
 *  normalize_arabic_text() for NAME matching (not for content matching). */
function normalizeName(text: string): string {
  return text
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ىی]/g, "ي")
    .replace(/ہ|ۃ/g, "ه")
    .replace(/ک/g, "ك")
    .toLowerCase()
    .trim();
}

/** Split text into comparable tokens. Token-wise matching is deliberate: a
 *  substring test makes "مسلمان" scope the query to صحیح مسلم — the bug the
 *  old /مسلم|muslim/ heuristic had. */
function tokenize(text: string): string[] {
  return normalizeName(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3);
}

/** Every name phrase that identifies a book: its two titles plus its aliases.
 *  A phrase matches only when ALL of its tokens are present, which is what
 *  keeps "صحیح بخاری" from also matching مختصر صحیح بخاری. */
const BOOK_PHRASES: Array<{ id: string; phrases: string[][]; allTokens: Set<string> }> =
  CORPUS_BOOKS.map((b) => {
    const phrases = [b.ur, b.ar, ...(b.aliases ?? [])]
      .map(tokenize)
      .filter((toks) => toks.length > 0);
    return { id: b.id, phrases, allTokens: new Set(phrases.flat()) };
  });

/**
 * Keyword book detection — the no-model path (`fallbackPlan`) and the safety
 * net for when the LLM omits a book the user clearly named.
 *
 * Two rules, both needed:
 *
 *   1. A book matches when one of its name phrases is fully present. Requiring
 *      every token of the phrase is what separates بخاری from مختصر بخاری —
 *      matching on any single shared token would scope a plain "صحیح بخاری"
 *      query to both books.
 *   2. When two matched books' hit-sets nest, the more specific one wins:
 *      "مختصر صحیح بخاری" matches bukhari on {بخاري} and mukhtasar-bukhari on
 *      {مختصر, بخاري}, and only the latter is what the user asked for.
 */
export function detectBooks(query: string): string[] {
  const tokens = new Set(tokenize(query));
  if (tokens.size === 0) return [];

  const matched: Array<{ id: string; hits: Set<string> }> = [];
  for (const { id, phrases, allTokens } of BOOK_PHRASES) {
    if (!phrases.some((phrase) => phrase.every((t) => tokens.has(t)))) continue;
    const hits = new Set([...allTokens].filter((t) => tokens.has(t)));
    matched.push({ id, hits });
  }

  return matched
    .filter(({ hits }) => !matched.some((other) =>
      other.hits !== hits &&
      other.hits.size > hits.size &&
      [...hits].every((t) => other.hits.has(t))))
    .map((m) => m.id);
}

/** The book list injected into the planner's system prompt, as
 *  `id — اردو نام` lines. Built from the table so the prompt can never drift
 *  from the allowlist `coercePlan` validates against. */
export function booksPromptList(): string {
  return CORPUS_BOOKS.map((b) => `${b.id} — ${b.ur}`).join("\n     ");
}
