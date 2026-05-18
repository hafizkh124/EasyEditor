// Topic anchors: canonical Quran + Hadith references for common Islamic topics.
//
// PURPOSE — when the retrieval fan-out returns weak results for a recognized
// topic (e.g. user asks about "صدقہ" but FTS misses or embeddings score below
// threshold), the orchestrator looks the topic up in this map and force-fetches
// these specific references from `scholarly_documents`. This guarantees that
// every common Islamic topic returns at least the well-known canonical anchors.
//
// IMPORTANT — These references should be reviewed by a qualified scholar before
// production use. They are widely-cited, broadly-agreed-upon anchors but human
// review is required to confirm:
//   1. accuracy (correct surah:verse, correct book + hadith number)
//   2. relevance (each ref actually addresses the topic, not a passing mention)
//   3. completeness (no glaring omission of a critically-relevant ref)
//
// Hadith book identifiers carry multiple variant strings because different
// ingestion paths put different shapes into citation_ref.book and .collection:
// the same Sahih al-Bukhari row may have `book="sahih-bukhari"` (HadithAPI
// convention), `book="Sahih al-Bukhari"` (display name), `book="bukhari"`
// (short slug), or `book="صحيح البخاري"` (Arabic). Per Phase 10.1, we list
// ALL known aliases so the SQL filter at the call site can OR over each.

export interface QuranAnchor {
  surah: number;
  verse: number;
}

export interface HadithAnchor {
  books: string[];         // every known string variant that may identify the collection
  hadith_number: string;   // string because some collections use compound numbering
}

// ── Book-alias map ────────────────────────────────────────────────────────
// Resolves a canonical collection key (e.g. "bukhari") to the full set of
// strings the DB may carry for that collection. Add new aliases here when
// you find a row in the DB that's not yet matched.
const BOOK_ALIASES: Record<string, string[]> = {
  bukhari:         ["sahih-bukhari", "bukhari", "sahih_bukhari", "Sahih Bukhari", "Sahih al-Bukhari", "صحيح البخاري"],
  muslim:          ["sahih-muslim", "muslim", "sahih_muslim", "Sahih Muslim", "صحيح مسلم"],
  tirmidhi:        ["al-tirmidhi", "tirmidhi", "Jami` at-Tirmidhi", "Jami` al-Tirmidhi", "Jami al-Tirmidhi", "جامع الترمذي"],
  "abu-dawood":    ["abu-dawood", "abu-dawud", "abudawud", "Sunan Abi Dawud", "Abu Dawud", "سنن أبي داود"],
  "ibn-majah":     ["ibn-e-majah", "ibn-majah", "ibnmajah", "Sunan Ibn Majah", "سنن ابن ماجه"],
  nasai:           ["sunan-nasai", "nasai", "an-nasai", "Sunan an-Nasa'i", "Sunan al-Nasa'i", "سنن النسائي"],
  mishkat:         ["mishkat", "Mishkat al-Masabih", "مشكاة المصابيح"],
  "musnad-ahmad":  ["musnad-ahmad", "musnad_ahmad", "Musnad Ahmad", "مسند أحمد"],
  silsila:         ["al-silsila-sahiha", "silsila-sahiha", "Silsila Sahiha"],
  nawawi40:        ["nawawi40", "Forty Hadith of Imam Nawawi", "An-Nawawi's Forty Hadith", "الأربعون النووية"],
  bulugh:          ["bulugh_almaram", "Bulugh al-Maram", "بلوغ المرام"],
  riyad:           ["riyad_assalihin", "Riyad as-Salihin", "Riyadh as-Salihin", "رياض الصالحين"],
};

function bookSet(key: string): string[] {
  const set = BOOK_ALIASES[key];
  if (!set) throw new Error(`unknown hadith collection key: ${key}`);
  return set;
}

export interface TopicAnchorSet {
  quran:  QuranAnchor[];
  hadith: HadithAnchor[];
}

// Lookup-key normalization: lowercase + strip Arabic harakat/tashkeel.
// This lets "صدقہ", "صدقة", "sadaqah", "Charity" all hit the same entry.
function normalize(key: string): string {
  return key
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, "")            // strip harakat
    .replace(/[آأإٱ]/g, "ا") // alef variants → ا
    .trim();
}

// Each topic's keys are written in multiple scripts so that downstream callers
// can pass user input directly. The merge step at the bottom builds a single
// normalized lookup table.
const RAW_TOPIC_ANCHORS: Array<{ keys: string[]; anchors: TopicAnchorSet }> = [
  {
    keys: ["صدقہ", "صدقة", "الصدقة", "sadaqah", "charity", "donation"],
    anchors: {
      quran: [
        { surah: 2,  verse: 261 },  // multiplication of charity reward
        { surah: 2,  verse: 267 },  // give from good things
        { surah: 2,  verse: 271 },  // open vs secret charity
        { surah: 2,  verse: 274 },  // spending night and day
        { surah: 9,  verse: 103 },  // take charity to purify
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "1410" },
        { books: bookSet("muslim"), hadith_number: "1017" },
        { books: bookSet("bukhari"), hadith_number: "1442" },
        { books: bookSet("muslim"), hadith_number: "1006" },
      ],
    },
  },
  {
    keys: ["زکوٰۃ", "زکات", "الزكاة", "zakat", "zakah"],
    anchors: {
      quran: [
        { surah: 2,  verse: 43  },   // establish prayer and give zakat
        { surah: 2,  verse: 110 },
        { surah: 9,  verse: 60  },   // categories of zakat recipients
        { surah: 9,  verse: 103 },
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "1395" },
        { books: bookSet("muslim"), hadith_number: "19"   },
        { books: bookSet("bukhari"), hadith_number: "8"    },
      ],
    },
  },
  {
    keys: ["نماز", "الصلاة", "صلاة", "salah", "salat", "prayer"],
    anchors: {
      quran: [
        { surah: 2,   verse: 43  },
        { surah: 2,   verse: 238 },  // guard the middle prayer
        { surah: 4,   verse: 103 },  // prayer at appointed times
        { surah: 20,  verse: 14  },  // establish prayer for My remembrance
        { surah: 29,  verse: 45  },  // prayer prevents indecency
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "8"  },
        { books: bookSet("muslim"), hadith_number: "16" },
        { books: bookSet("bukhari"), hadith_number: "528" },
      ],
    },
  },
  {
    keys: ["روزہ", "الصوم", "صيام", "fasting", "sawm", "siyam"],
    anchors: {
      quran: [
        { surah: 2, verse: 183 },  // fasting prescribed
        { surah: 2, verse: 184 },
        { surah: 2, verse: 185 },  // ramadan
        { surah: 2, verse: 187 },
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "1903" },
        { books: bookSet("muslim"), hadith_number: "1151" },
        { books: bookSet("bukhari"), hadith_number: "38"   },
      ],
    },
  },
  {
    keys: ["حج", "الحج", "hajj", "pilgrimage"],
    anchors: {
      quran: [
        { surah: 2, verse: 196 },
        { surah: 2, verse: 197 },
        { surah: 3, verse: 97  },   // obligation of hajj
        { surah: 22, verse: 27 },
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "1521" },
        { books: bookSet("muslim"), hadith_number: "1218" },
      ],
    },
  },
  {
    keys: ["نکاح", "النكاح", "زواج", "nikah", "marriage"],
    anchors: {
      quran: [
        { surah: 4,  verse: 3   },
        { surah: 24, verse: 32  },
        { surah: 30, verse: 21  },   // among His signs: spouses for tranquility
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "5063" },
        { books: bookSet("muslim"), hadith_number: "1400" },
      ],
    },
  },
  {
    keys: ["طلاق", "الطلاق", "talaq", "divorce"],
    anchors: {
      quran: [
        { surah: 2,  verse: 229 },
        { surah: 2,  verse: 230 },
        { surah: 65, verse: 1   },   // surah at-talaq opening
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "5251" },
        { books: bookSet("muslim"), hadith_number: "1471" },
        { books: bookSet("abu-dawood"), hadith_number: "2178" },  // most hated halal
      ],
    },
  },
  {
    keys: ["وراثت", "میراث", "الميراث", "الإرث", "inheritance"],
    anchors: {
      quran: [
        { surah: 4, verse: 11  },
        { surah: 4, verse: 12  },
        { surah: 4, verse: 176 },
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "6732" },
        { books: bookSet("muslim"), hadith_number: "1614" },
      ],
    },
  },
  {
    keys: ["سود", "ربا", "الربا", "riba", "usury", "interest"],
    anchors: {
      quran: [
        { surah: 2, verse: 275 },
        { surah: 2, verse: 276 },
        { surah: 2, verse: 278 },
        { surah: 3, verse: 130 },
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "2086" },
        { books: bookSet("muslim"), hadith_number: "1597" },
      ],
    },
  },
  {
    keys: ["توبہ", "التوبة", "tawbah", "repentance"],
    anchors: {
      quran: [
        { surah: 2,  verse: 222 },
        { surah: 9,  verse: 104 },
        { surah: 39, verse: 53  },   // do not despair of Allah's mercy
        { surah: 66, verse: 8   },   // sincere repentance
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "6307" },
        { books: bookSet("muslim"), hadith_number: "2702" },
      ],
    },
  },
  {
    keys: ["ایمان", "الإيمان", "iman", "faith", "belief"],
    anchors: {
      quran: [
        { surah: 2,  verse: 285 },
        { surah: 49, verse: 14  },
        { surah: 49, verse: 15  },
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "50" },   // gabriel hadith
        { books: bookSet("muslim"), hadith_number: "8"  },
      ],
    },
  },
  {
    keys: ["توحید", "التوحيد", "tawhid", "monotheism"],
    anchors: {
      quran: [
        { surah: 2,   verse: 163 },
        { surah: 112, verse: 1   },
        { surah: 112, verse: 2   },
        { surah: 112, verse: 3   },
        { surah: 112, verse: 4   },
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "7372" },
        { books: bookSet("muslim"), hadith_number: "22"   },
      ],
    },
  },
  {
    keys: ["شرک", "الشرك", "shirk", "polytheism"],
    anchors: {
      quran: [
        { surah: 4,  verse: 48  },
        { surah: 4,  verse: 116 },
        { surah: 31, verse: 13  },   // luqman: shirk is great wrong
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "6861" },
        { books: bookSet("muslim"), hadith_number: "86"   },
      ],
    },
  },
  {
    keys: ["صبر", "الصبر", "sabr", "patience"],
    anchors: {
      quran: [
        { surah: 2, verse: 153 },
        { surah: 2, verse: 155 },
        { surah: 2, verse: 156 },
        { surah: 2, verse: 157 },
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "1469" },
        { books: bookSet("muslim"), hadith_number: "1053" },
      ],
    },
  },
  {
    keys: ["تقویٰ", "التقوى", "taqwa", "piety"],
    anchors: {
      quran: [
        { surah: 2,  verse: 2   },
        { surah: 3,  verse: 102 },
        { surah: 49, verse: 13  },   // most honored is most god-conscious
      ],
      hadith: [
        { books: bookSet("muslim"), hadith_number: "2628" },
        { books: bookSet("tirmidhi"), hadith_number: "1987" },  // taqwa wherever you are
      ],
    },
  },
  {
    keys: ["جنت", "الجنة", "jannah", "paradise"],
    anchors: {
      quran: [
        { surah: 2,  verse: 25  },
        { surah: 9,  verse: 72  },
        { surah: 47, verse: 15  },
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "6549" },
        { books: bookSet("muslim"), hadith_number: "2824" },
      ],
    },
  },
  {
    keys: ["جہنم", "النار", "jahannam", "hellfire"],
    anchors: {
      quran: [
        { surah: 2,  verse: 24 },
        { surah: 9,  verse: 81 },
        { surah: 66, verse: 6  },
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "6562" },
        { books: bookSet("muslim"), hadith_number: "2842" },
      ],
    },
  },
  {
    keys: ["جہاد", "الجهاد", "jihad"],
    anchors: {
      quran: [
        { surah: 2,  verse: 190 },
        { surah: 9,  verse: 36  },
        { surah: 22, verse: 78  },
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "2785" },
        { books: bookSet("muslim"), hadith_number: "1876" },
      ],
    },
  },
  {
    keys: ["حلال", "الحلال", "halal", "permissible"],
    anchors: {
      quran: [
        { surah: 2, verse: 168 },
        { surah: 5, verse: 3   },
        { surah: 5, verse: 4   },
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "52"   },   // halal is clear, haram is clear
        { books: bookSet("muslim"), hadith_number: "1599" },
      ],
    },
  },
  {
    keys: ["حرام", "الحرام", "haram", "forbidden"],
    anchors: {
      quran: [
        { surah: 2, verse: 173 },
        { surah: 5, verse: 3   },
        { surah: 6, verse: 151 },
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "52"   },
        { books: bookSet("muslim"), hadith_number: "1599" },
      ],
    },
  },
  {
    keys: ["والدین", "الوالدين", "parents", "والدین کے حقوق"],
    anchors: {
      quran: [
        { surah: 17, verse: 23 },
        { surah: 17, verse: 24 },
        { surah: 31, verse: 14 },
        { surah: 46, verse: 15 },
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "5971" },
        { books: bookSet("muslim"), hadith_number: "2548" },
      ],
    },
  },
  {
    keys: ["یتیم", "اليتيم", "orphan"],
    anchors: {
      quran: [
        { surah: 2,  verse: 220 },
        { surah: 4,  verse: 2   },
        { surah: 4,  verse: 10  },
        { surah: 93, verse: 9   },
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "6005" },
        { books: bookSet("muslim"), hadith_number: "2983" },
      ],
    },
  },
  {
    keys: ["جھوٹ", "الكذب", "lying", "lie", "falsehood"],
    anchors: {
      quran: [
        { surah: 16, verse: 105 },
        { surah: 39, verse: 60  },
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "33"   },
        { books: bookSet("muslim"), hadith_number: "59"   },
      ],
    },
  },
  {
    keys: ["غیبت", "الغيبة", "ghibah", "backbiting"],
    anchors: {
      quran: [
        { surah: 49, verse: 12 },
      ],
      hadith: [
        { books: bookSet("muslim"), hadith_number: "2589" },
        { books: bookSet("abu-dawood"), hadith_number: "4874" },
      ],
    },
  },
  {
    keys: ["علم", "العلم", "ilm", "knowledge"],
    anchors: {
      quran: [
        { surah: 20, verse: 114 },
        { surah: 39, verse: 9   },
        { surah: 58, verse: 11  },
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "71"   },
        { books: bookSet("muslim"), hadith_number: "2699" },
      ],
    },
  },
  {
    keys: ["نیت", "النية", "النيات", "niyyah", "intention"],
    anchors: {
      quran: [
        { surah: 98, verse: 5 },   // sincerity in worship
      ],
      hadith: [
        { books: bookSet("bukhari"), hadith_number: "1"    },  // actions by intentions
        { books: bookSet("muslim"), hadith_number: "1907" },
      ],
    },
  },
  {
    keys: ["دعا", "الدعاء", "dua", "supplication"],
    anchors: {
      quran: [
        { surah: 2,  verse: 186 },
        { surah: 40, verse: 60  },   // call upon Me, I will respond
      ],
      hadith: [
        { books: bookSet("tirmidhi"), hadith_number: "3370" },   // dua is the worship
        { books: bookSet("muslim"), hadith_number: "2735" },
      ],
    },
  },
  {
    keys: ["وضو", "الوضوء", "wudu", "ablution"],
    anchors: {
      quran: [
        { surah: 5, verse: 6 },
      ],
      hadith: [
        { books: bookSet("muslim"), hadith_number: "224" },
        { books: bookSet("bukhari"), hadith_number: "159" },
      ],
    },
  },
  {
    keys: ["شکر", "الشكر", "shukr", "gratitude"],
    anchors: {
      quran: [
        { surah: 2,  verse: 152 },
        { surah: 14, verse: 7   },
      ],
      hadith: [
        { books: bookSet("muslim"), hadith_number: "2999" },
      ],
    },
  },
];

// ── Build a fast normalized lookup ─────────────────────────────────────────
const NORMALIZED_INDEX: Record<string, TopicAnchorSet> = (() => {
  const out: Record<string, TopicAnchorSet> = {};
  for (const entry of RAW_TOPIC_ANCHORS) {
    for (const k of entry.keys) {
      out[normalize(k)] = entry.anchors;
    }
  }
  return out;
})();

/**
 * Look up the canonical anchor set for a free-text query. Tokenizes the query,
 * tries each token against the normalized index, and merges anchor sets when
 * multiple topics match (e.g. "صدقہ اور زکوٰۃ" → union of both).
 *
 * Returns null if no token matched any known topic.
 */
export function lookupTopicAnchors(query: string): TopicAnchorSet | null {
  const tokens = query.split(/\s+/).filter(Boolean);
  const quran: QuranAnchor[]  = [];
  const hadith: HadithAnchor[] = [];
  const seenQ = new Set<string>();
  const seenH = new Set<string>();
  let matched = false;

  for (const tok of tokens) {
    const hit = NORMALIZED_INDEX[normalize(tok)];
    if (!hit) continue;
    matched = true;
    for (const q of hit.quran) {
      const k = `${q.surah}:${q.verse}`;
      if (!seenQ.has(k)) { seenQ.add(k); quran.push(q); }
    }
    for (const h of hit.hadith) {
      // Dedupe by (canonical first alias, hadith_number) — first alias
      // is the canonical slug in BOOK_ALIASES, so it's stable.
      const k = `${h.books[0]}:${h.hadith_number}`;
      if (!seenH.has(k)) { seenH.add(k); hadith.push(h); }
    }
  }

  return matched ? { quran, hadith } : null;
}

/**
 * Count how many entries in the topic database. Useful for telemetry and tests.
 */
export function topicAnchorCount(): number {
  return RAW_TOPIC_ANCHORS.length;
}
