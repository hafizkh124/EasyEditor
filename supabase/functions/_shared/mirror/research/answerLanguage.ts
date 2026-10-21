// AUTO-MIRRORED from shared\research\answerLanguage.ts — edge deploy bundles only supabase/functions/.
// Edit shared\research\answerLanguage.ts and re-run: node scripts/mirror-shared.mjs
/**
 * Which language an answer should be written in, and how to tell the model.
 *
 * Seen live (2026-10-14): an Arabic question ("إنما الأعمال بالنيات") was
 * answered in English. The system prompt's only rule was "respond in the same
 * language as the user's question", buried among English instructions and an
 * English-labelled context block ("RETRIEVED SOURCES", "REFERENCE: …"), and the
 * Ask-mode agent prompt had no language rule at all.
 *
 * The scholar's rule is: answer in the language the question was asked in,
 * unless they explicitly ask for another one. The explicit request is left to
 * the model (it reads "اردو میں بتائیں" / "answer in English" better than a
 * regex would); what this module adds is the detected default, stated outright.
 *
 * Pure — no runtime globals.
 */

export type AnswerLanguage = 'urdu' | 'arabic' | 'english';

// Letters only Urdu/Persian-script Urdu uses: ٹ ڈ ڑ ں ے پ چ ژ گ ھ ہ ۂ, plus the
// Urdu forms of kaf/yeh (ک ی) which Arabic writes ك ي.
const URDU_LETTERS = /[ٹڈڑںےپچژگھہۂکی]/g;
const ARABIC_LETTERS = /[ء-يٱ-ۓ]/g;
// Letters/marks Arabic uses where Urdu does not: ك ي ة ى ؤ ئ ء ً ٌ ٍ َ ُ ِ ّ ْ
// eslint-disable-next-line no-misleading-character-class -- the range IS the tashkeel marks (U+064B–U+0652), on purpose
const ARABIC_ONLY = /[\u0643\u064A\u0629\u0649\u0624\u0626\u064B-\u0652]/g;
const LATIN = /[A-Za-z]/g;

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

/**
 * Detects the language of a question, or null when it cannot tell (an empty
 * string, digits only, or Arabic-script text with no letter that separates
 * Urdu from Arabic).
 */
export function detectQuestionLanguage(question: string | null | undefined): AnswerLanguage | null {
  const q = (question ?? '').trim();
  if (!q) return null;
  const arabicScript = count(q, ARABIC_LETTERS);
  const latin = count(q, LATIN);
  if (arabicScript === 0 && latin === 0) return null;
  if (latin > arabicScript) return 'english';

  const urdu = count(q, URDU_LETTERS);
  const arabicOnly = count(q, ARABIC_ONLY);
  if (urdu > 0 && arabicOnly === 0) return 'urdu';
  if (arabicOnly > 0 && urdu === 0) return 'arabic';
  // Both kinds of marker: a quoted Arabic phrase inside an Urdu sentence. The
  // sentence around it decides — Urdu function words carry Urdu-only letters.
  if (urdu > 0 && arabicOnly > 0) return urdu >= arabicOnly ? 'urdu' : 'arabic';
  return null;
}

const NAME: Record<AnswerLanguage, string> = {
  urdu: 'Urdu (اردو)',
  arabic: 'Arabic (العربية)',
  english: 'English',
};

/**
 * The instruction to put in a system prompt. With a detected language it names it;
 * without one it falls back to the general rule. Either way an explicit request
 * from the scholar wins, and quotations stay in their source language.
 */
export function languageInstruction(question: string | null | undefined): string {
  const lang = detectQuestionLanguage(question);
  const core = lang
    ? `LANGUAGE: The scholar asked in ${NAME[lang]}. Write your answer in ${NAME[lang]}.`
    : `LANGUAGE: Write your answer in the language of the scholar's question (Urdu, Arabic or English).`;
  return `${core} If the scholar explicitly asks for a particular language (for example "اردو میں بتائیں", "بالعربية", "answer in English"), use that language instead. These instructions and the retrieved sources may be in other languages — never copy their language into your answer. Quotations from sources (Qur'an, hadith, scholars) always stay in their original language.`;
}
