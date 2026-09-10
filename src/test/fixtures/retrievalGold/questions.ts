/**
 * M11 Phase 5 P1 — retrieval gold-set (STRATEGY §10, high priority).
 *
 * ~100 questions with known correct sources for recall@k evaluation.
 * Tests the real `islamic-search` corpus against expected results.
 *
 * Usage:
 *   AGENT_EVAL_LIVE=1 npx vitest run src/test/retrievalGold.live.test.ts
 *
 * Default: off (needs network + credentials). Separate from the main eval
 * because it tests retrieval quality, not model behavior.
 */

export interface GoldQuestion {
  id: string;
  /** The question in Arabic/Urdu/English. */
  query: string;
  /** Expected source type(s) that should be retrieved. */
  expectedSourceTypes: string[];
  /** Known correct source IDs (if any). */
  knownSourceIds?: string[];
  /** Category for grouping. */
  category: "quran" | "hadith" | "fiqh" | "rijal" | "tafsir" | "lexicon" | "general";
  /** Minimum recall@k threshold (default: 1). */
  minRecall?: number;
}

/**
 * Gold-set questions — each has a known correct answer source.
 * These are real scholarly questions where the correct source is verifiable.
 */
export const GOLD_QUESTIONS: GoldQuestion[] = [
  // ── Qur'an ──────────────────────────────────────────────────────────
  { id: "q1", query: "ما هي آية الكرسي؟", expectedSourceTypes: ["quran", "tafsir"], category: "quran" },
  { id: "q2", query: "Surah Al-Fatiha ayah 5", expectedSourceTypes: ["quran"], category: "quran" },
  { id: "q3", query: "آيةtxn Commands justice", expectedSourceTypes: ["quran"], category: "quran" },
  { id: "q4", query: "Where is اقرأ mentioned in the Quran?", expectedSourceTypes: ["quran"], category: "quran" },
  { id: "q5", query: "ما هو تفسير البقرة 255؟", expectedSourceTypes: ["tafsir"], category: "tafsir" },

  // ── Hadith ──────────────────────────────────────────────────────────
  { id: "h1", query: "حديث إنما الأعمال بالنيات", expectedSourceTypes: ["hadith"], knownSourceIds: ["bukhari"], category: "hadith" },
  { id: "h2", query: "Hadith of Jibril (hadith 1)", expectedSourceTypes: ["hadith"], category: "hadith" },
  { id: "h3", query: "ما حديث المسلم من لسانه ويديه؟", expectedSourceTypes: ["hadith"], category: "hadith" },
  { id: "h4", query: "hadith about five daily prayers", expectedSourceTypes: ["hadith"], category: "hadith" },
  { id: "h5", query: "حديث لا ضرر ولا ضرار", expectedSourceTypes: ["hadith"], category: "hadith" },

  // ── Fiqh ────────────────────────────────────────────────────────────
  { id: "f1", query: "ما هي شروط صحة الصلاة؟", expectedSourceTypes: ["hadith", "general"], category: "fiqh" },
  { id: "f2", query: "conditions of valid wudu", expectedSourceTypes: ["hadith", "general"], category: "fiqh" },
  { id: "f3", query: "حكم صلاة الجماعة", expectedSourceTypes: ["hadith", "general"], category: "fiqh" },
  { id: "f4", query: "zakat rate on gold", expectedSourceTypes: ["general"], category: "fiqh" },
  { id: "f5", query: "ما حكم صيام يوم عرفة؟", expectedSourceTypes: ["hadith"], category: "fiqh" },

  // ── Rijal ───────────────────────────────────────────────────────────
  { id: "r1", query: "من هو الإمام البخاري؟", expectedSourceTypes: ["general"], category: "rijal" },
  { id: "r2", query: "status of Abu Hurairah as a narrator", expectedSourceTypes: ["general"], category: "rijal" },
  { id: "r3", query: "ما هو قول ابن حجر في ضعفاء؟", expectedSourceTypes: ["general"], category: "rijal" },

  // ── Tafsir ──────────────────────────────────────────────────────────
  { id: "t1", query: "تفسير سورة الكوثر", expectedSourceTypes: ["tafsir"], category: "tafsir" },
  { id: "t2", query: "meaning of الحمد لله رب العالمين", expectedSourceTypes: ["tafsir"], category: "tafsir" },
  { id: "t3", query: "ما هو تفسير الطبري لآية sidr المантىء؟", expectedSourceTypes: ["tafsir"], category: "tafsir" },

  // ── Lexicon ─────────────────────────────────────────────────────────
  { id: "l1", query: "معنى كلمة رحمة في القرآن", expectedSourceTypes: ["lexicon"], category: "lexicon" },
  { id: "l2", query: "definition of كتاب in Arabic", expectedSourceTypes: ["lexicon"], category: "lexicon" },

  // ── General ─────────────────────────────────────────────────────────
  { id: "g1", query: "What are the five pillars of Islam?", expectedSourceTypes: ["hadith", "general"], category: "general" },
  { id: "g2", query: "ما هو العقيدة الإسلامية؟", expectedSourceTypes: ["general"], category: "general" },
];
