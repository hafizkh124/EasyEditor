// Bilingual Islamic-research synonym map.
//
// Maps a term (Arabic / Urdu / English / transliterated) to its equivalents in
// the other scripts. Used by both islamic-search (FTS query expansion) and the
// future citations pipeline (claim segmentation).
//
// Each key includes itself in its own bucket implicitly — the consumer adds
// the original term to the expansion set before looking up. Entries are
// bidirectional: if "صدقہ" maps to "sadaqah", then "sadaqah" also maps back
// to "صدقہ". Keep this property when adding new terms.
//
// Coverage target: top ~50 topics across aqidah, ibadah, muamalat, akhlaq.
// Adding more is welcome; never remove an existing entry (downstream tests
// rely on stable expansion).

export const BILINGUAL_MAP: Record<string, string[]> = {
  // ── Aqidah / Beliefs ──────────────────────────────────────────────────────
  "توحید":   ["التوحيد", "tawhid", "tawheed", "monotheism", "oneness"],
  "التوحيد": ["توحید", "tawhid", "tawheed", "monotheism"],
  "tawhid":  ["توحید", "التوحيد", "tawheed", "monotheism"],
  "tawheed": ["توحید", "التوحيد", "tawhid", "monotheism"],

  "شرک":    ["الشرك", "shirk", "polytheism", "associating partners"],
  "الشرك":  ["شرک", "shirk", "polytheism"],
  "shirk":  ["شرک", "الشرك", "polytheism"],

  "ایمان":    ["الإيمان", "إيمان", "iman", "faith", "belief", "ايمان"],
  "الإيمان":  ["ایمان", "iman", "faith", "belief"],
  "iman":     ["ایمان", "الإيمان", "faith", "belief"],
  "faith":    ["ایمان", "الإيمان", "iman", "belief"],

  "کفر":   ["الكفر", "kufr", "disbelief"],
  "الكفر": ["کفر", "kufr", "disbelief"],
  "kufr":  ["کفر", "الكفر", "disbelief"],

  "نفاق":   ["النفاق", "nifaq", "hypocrisy", "munafiq", "منافق"],
  "النفاق": ["نفاق", "nifaq", "hypocrisy"],
  "nifaq":  ["نفاق", "النفاق", "hypocrisy", "munafiq"],

  "نبوت":  ["النبوة", "nubuwwah", "prophethood"],
  "النبوة":["نبوت", "nubuwwah", "prophethood"],

  "ملائکہ":   ["الملائكة", "angels", "malaikah", "ملائكه"],
  "الملائكة": ["ملائکہ", "angels", "malaikah"],
  "angels":   ["ملائکہ", "الملائكة", "malaikah"],

  "جنت":   ["الجنة", "jannah", "paradise", "heaven", "جنه"],
  "الجنة": ["جنت", "jannah", "paradise"],
  "jannah":["جنت", "الجنة", "paradise"],
  "paradise":["جنت", "الجنة", "jannah"],

  "جہنم":   ["جهنم", "النار", "jahannam", "hellfire", "hell"],
  "النار":  ["جہنم", "جهنم", "hellfire", "hell"],
  "jahannam":["جہنم", "جهنم", "النار", "hellfire"],

  "قیامت":   ["القيامة", "qiyamah", "resurrection", "judgement day", "آخرت", "الآخرة"],
  "القيامة": ["قیامت", "qiyamah", "resurrection", "judgement day"],
  "آخرت":    ["الآخرة", "akhirah", "hereafter", "قیامت", "القيامة"],
  "الآخرة":  ["آخرت", "akhirah", "hereafter"],

  "تقدیر":  ["القدر", "qadar", "predestination", "decree"],
  "القدر":  ["تقدیر", "qadar", "predestination", "decree", "ليلة القدر", "laylat al-qadr"],

  // ── Ibadah / Worship ──────────────────────────────────────────────────────
  "نماز":      ["الصلاة", "صلاة", "salah", "salat", "prayer", "نمازیں"],
  "الصلاة":    ["نماز", "salah", "salat", "prayer"],
  "salah":     ["نماز", "الصلاة", "صلاة", "prayer"],
  "salat":     ["نماز", "الصلاة", "صلاة", "prayer"],
  "prayer":    ["نماز", "الصلاة", "صلاة", "salah"],

  "روزہ":   ["الصوم", "صوم", "صيام", "fasting", "sawm", "siyam", "رمضان", "ramadan"],
  "الصوم":  ["روزہ", "صوم", "fasting", "sawm"],
  "صيام":   ["روزہ", "الصوم", "fasting", "siyam"],
  "fasting":["روزہ", "الصوم", "صيام", "sawm"],
  "ramadan":["رمضان", "ramadhan", "fasting month", "الصوم"],
  "رمضان":  ["ramadan", "ramadhan", "fasting month"],

  "زکوٰۃ":   ["الزكاة", "زکات", "zakat", "zakah", "obligatory charity", "الزكاه"],
  "الزكاة":  ["زکوٰۃ", "زکات", "zakat", "zakah"],
  "zakat":   ["زکوٰۃ", "زکات", "الزكاة", "zakah"],
  "zakah":   ["زکوٰۃ", "زکات", "الزكاة", "zakat"],

  "صدقہ":    ["صدقة", "الصدقة", "صدقات", "sadaqah", "charity", "donation", "almsgiving", "انفاق", "infaq"],
  "صدقة":    ["صدقہ", "الصدقة", "sadaqah", "charity"],
  "الصدقة":  ["صدقہ", "صدقة", "sadaqah", "charity"],
  "sadaqah": ["صدقہ", "صدقة", "الصدقة", "charity", "donation"],
  "charity": ["صدقہ", "صدقة", "الصدقة", "الزكاة", "sadaqah", "zakat", "infaq", "انفاق"],
  "donation":["صدقہ", "الصدقة", "sadaqah", "charity"],
  "انفاق":   ["الإنفاق", "infaq", "spending in the way of Allah", "صدقہ"],
  "infaq":   ["انفاق", "الإنفاق", "spending", "صدقہ", "charity"],

  "حج":      ["الحج", "hajj", "pilgrimage"],
  "الحج":    ["حج", "hajj", "pilgrimage"],
  "hajj":    ["حج", "الحج", "pilgrimage"],
  "pilgrimage":["حج", "الحج", "hajj"],

  "عمرہ":  ["العمرة", "umrah", "minor pilgrimage"],
  "العمرة":["عمرہ", "umrah"],
  "umrah": ["عمرہ", "العمرة"],

  "دعا":   ["الدعاء", "دعاء", "dua", "supplication"],
  "الدعاء":["دعا", "دعاء", "dua", "supplication"],
  "dua":   ["دعا", "الدعاء", "دعاء", "supplication"],

  "ذکر":   ["الذكر", "dhikr", "zikr", "remembrance of Allah"],
  "الذكر": ["ذکر", "dhikr", "zikr", "remembrance"],
  "dhikr": ["ذکر", "الذكر", "zikr", "remembrance"],

  "وضو":   ["الوضوء", "وضوء", "wudu", "ablution"],
  "الوضوء":["وضو", "wudu", "ablution"],
  "wudu":  ["وضو", "الوضوء", "ablution"],
  "ablution":["وضو", "الوضوء", "wudu"],

  "غسل":  ["الغسل", "ghusl", "ritual bath"],
  "الغسل":["غسل", "ghusl"],
  "ghusl":["غسل", "الغسل"],

  "اذان":  ["الأذان", "adhan", "azan", "call to prayer"],
  "الأذان":["اذان", "adhan", "azan"],
  "adhan": ["اذان", "الأذان", "azan", "call to prayer"],

  "جمعہ":   ["الجمعة", "jumuah", "jumah", "friday prayer", "صلاة الجمعة"],
  "الجمعة": ["جمعہ", "jumuah", "friday"],
  "jumuah": ["جمعہ", "الجمعة", "friday prayer"],

  "تہجد":     ["التهجد", "tahajjud", "night prayer", "قیام اللیل"],
  "التهجد":   ["تہجد", "tahajjud", "night prayer"],
  "tahajjud": ["تہجد", "التهجد", "night prayer", "qiyam al-layl"],

  "تراویح":  ["التراويح", "tarawih", "ramadan night prayer"],
  "التراويح":["تراویح", "tarawih"],

  "اعتکاف":   ["الاعتكاف", "itikaf", "spiritual retreat"],
  "الاعتكاف": ["اعتکاف", "itikaf"],

  // ── Muamalat / Transactions ──────────────────────────────────────────────
  "نکاح":   ["النكاح", "زواج", "nikah", "marriage", "nikkah"],
  "النكاح": ["نکاح", "nikah", "marriage", "زواج"],
  "nikah":  ["نکاح", "النكاح", "marriage"],
  "marriage":["نکاح", "النكاح", "nikah", "زواج"],

  "طلاق":  ["الطلاق", "talaq", "divorce"],
  "الطلاق":["طلاق", "talaq", "divorce"],
  "talaq": ["طلاق", "الطلاق", "divorce"],
  "divorce":["طلاق", "الطلاق", "talaq"],

  "خلع":  ["الخلع", "khula", "khul", "wife-initiated divorce"],
  "الخلع":["خلع", "khula", "khul"],

  "مہر":  ["المهر", "mahr", "dowry", "bridal gift"],
  "المهر":["مہر", "mahr", "dowry"],
  "mahr": ["مہر", "المهر", "dowry"],

  "عدت":  ["العدة", "iddah", "iddat", "waiting period"],
  "العدة":["عدت", "iddah", "iddat"],

  "وراثت":     ["الميراث", "الإرث", "inheritance", "faraid", "فرائض", "ميراث"],
  "الميراث":   ["وراثت", "inheritance", "faraid"],
  "inheritance":["وراثت", "الميراث", "الإرث", "faraid"],

  "وصیت":  ["الوصية", "wasiyyah", "will", "bequest"],
  "الوصية":["وصیت", "wasiyyah", "will"],

  "سود":   ["الربا", "ربا", "riba", "usury", "interest", "بیاج"],
  "الربا": ["سود", "ربا", "riba", "usury"],
  "riba":  ["سود", "الربا", "ربا", "usury", "interest"],
  "usury": ["سود", "الربا", "riba", "interest"],

  "بیع":  ["البيع", "bay", "buying selling", "trade", "تجارة"],
  "البيع":["بیع", "bay", "trade"],

  "وقف":  ["الوقف", "waqf", "endowment"],
  "الوقف":["وقف", "waqf"],

  "امانت":  ["الأمانة", "amanah", "trust"],
  "الأمانة":["امانت", "amanah", "trust"],

  // ── Akhlaq / Ethics ───────────────────────────────────────────────────────
  "صبر":     ["الصبر", "sabr", "patience", "perseverance"],
  "الصبر":   ["صبر", "sabr", "patience"],
  "patience":["صبر", "الصبر", "sabr", "perseverance"],

  "شکر":     ["الشكر", "shukr", "gratitude", "thankfulness"],
  "الشكر":   ["شکر", "shukr", "gratitude"],
  "gratitude":["شکر", "الشكر", "shukr"],

  "تقویٰ":   ["التقوى", "taqwa", "piety", "god-consciousness", "تقوی"],
  "التقوى":  ["تقویٰ", "taqwa", "piety"],
  "taqwa":   ["تقویٰ", "التقوى", "piety"],
  "piety":   ["تقویٰ", "التقوى", "taqwa"],

  "توبہ":      ["التوبة", "tawbah", "tauba", "repentance"],
  "التوبة":    ["توبہ", "tawbah", "repentance"],
  "tawbah":    ["توبہ", "التوبة", "repentance"],
  "repentance":["توبہ", "التوبة", "tawbah"],

  "اخلاص":  ["الإخلاص", "ikhlas", "sincerity"],
  "الإخلاص":["اخلاص", "ikhlas", "sincerity"],

  "تواضع":  ["التواضع", "tawadhu", "humility"],
  "التواضع":["تواضع", "tawadhu", "humility"],

  "عدل":    ["العدل", "adl", "justice", "fairness", "انصاف"],
  "العدل":  ["عدل", "adl", "justice"],
  "justice":["عدل", "العدل", "adl", "fairness"],

  "حلال":  ["الحلال", "halal", "permissible", "lawful"],
  "الحلال":["حلال", "halal", "permissible"],
  "halal": ["حلال", "الحلال", "permissible", "lawful"],

  "حرام":  ["الحرام", "haram", "forbidden", "unlawful"],
  "الحرام":["حرام", "haram", "forbidden"],
  "haram": ["حرام", "الحرام", "forbidden", "unlawful"],

  "جھوٹ":  ["الكذب", "كذب", "lying", "falsehood", "lie"],
  "الكذب": ["جھوٹ", "lying", "falsehood"],

  "غیبت":  ["الغيبة", "ghibah", "backbiting", "gossip"],
  "الغيبة":["غیبت", "ghibah", "backbiting"],

  "حسد":   ["الحسد", "hasad", "envy", "jealousy"],
  "الحسد": ["حسد", "hasad", "envy"],

  "تکبر":  ["الكبر", "kibr", "arrogance", "pride"],
  "الكبر": ["تکبر", "kibr", "arrogance"],

  // ── Sources / Sciences ────────────────────────────────────────────────────
  "قرآن":  ["القرآن", "quran", "qur'an", "qoran", "the noble quran"],
  "القرآن":["قرآن", "quran", "qur'an"],
  "quran": ["قرآن", "القرآن", "qur'an"],

  "حدیث":  ["الحديث", "hadith", "hadis", "narration", "احادیث", "احاديث"],
  "الحديث":["حدیث", "hadith", "narration", "احاديث"],
  "hadith":["حدیث", "الحديث", "narration"],

  "سنت":   ["السنة", "sunnah", "sunna", "prophetic tradition"],
  "السنة": ["سنت", "sunnah", "sunna"],
  "sunnah":["سنت", "السنة", "sunna"],

  "تفسیر":  ["التفسير", "tafsir", "tafseer", "quranic exegesis"],
  "التفسير":["تفسیر", "tafsir", "tafseer"],
  "tafsir": ["تفسیر", "التفسير", "tafseer"],

  "فقہ":   ["الفقه", "fiqh", "islamic jurisprudence"],
  "الفقه": ["فقہ", "fiqh"],
  "fiqh":  ["فقہ", "الفقه", "jurisprudence"],

  "اجتہاد":  ["الاجتهاد", "ijtihad", "independent reasoning"],
  "الاجتهاد":["اجتہاد", "ijtihad"],

  "جہاد":   ["الجهاد", "jihad", "struggle", "striving"],
  "الجهاد": ["جہاد", "jihad", "struggle"],
  "jihad":  ["جہاد", "الجهاد", "struggle"],

  "شہادت":  ["الشهادة", "shahadah", "testimony", "martyrdom"],
  "الشهادة":["شہادت", "shahadah", "testimony"],

  // ── Family / Society ──────────────────────────────────────────────────────
  "والدین":  ["الوالدين", "parents", "والدین کے حقوق", "rights of parents"],
  "الوالدين":["والدین", "parents"],
  "parents": ["والدین", "الوالدين"],

  "یتیم":   ["اليتيم", "اليتامى", "orphan", "orphans"],
  "اليتيم": ["یتیم", "orphan"],
  "orphan": ["یتیم", "اليتيم", "اليتامى"],

  "علم":      ["العلم", "ilm", "knowledge", "seeking knowledge", "طلب العلم"],
  "العلم":    ["علم", "ilm", "knowledge"],
  "knowledge":["علم", "العلم", "ilm"],

  "صحابہ":  ["الصحابة", "sahaba", "companions", "صحابی"],
  "الصحابة":["صحابہ", "sahaba", "companions"],
};

import { isStopword, dropStopwords } from "./stopwords.ts";

/**
 * Expand a free-text query into a deduplicated set of search terms.
 * Splits on whitespace, drops stopwords, looks each remaining token up
 * (case-preserving and lowercase) in BILINGUAL_MAP, and returns the
 * content-bearing tokens plus all matched expansions.
 *
 * Stopwords are filtered BEFORE expansion: a query like
 * "نماز سے متعلق آیات اور احادیث" yields just ["نماز", ...salah expansions],
 * not the original 8 tokens. This prevents generic words like "آیات" from
 * dragging unrelated verses to the top of the smart-search ranking.
 */
export function expandQueryTerms(query: string): string[] {
  const rawTokens = query.trim().split(/\s+/).filter(Boolean);
  const contentTokens = dropStopwords(rawTokens);
  const out = new Set<string>(contentTokens);
  for (const word of contentTokens) {
    const direct = BILINGUAL_MAP[word];
    if (direct) {
      for (const t of direct) if (!isStopword(t)) out.add(t);
      continue;
    }
    const lower = word.toLowerCase();
    const lo = BILINGUAL_MAP[lower];
    if (lo) {
      for (const t of lo) if (!isStopword(t)) out.add(t);
    }
  }
  return [...out];
}
