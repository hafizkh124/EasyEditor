/**
 * M9 Phase 6 — the fixed extraction instruction for `build_scholarly_indexes`.
 *
 * Same discipline as `draftSection.ts` / `refineText.ts`: the caller passes a
 * closed `kinds` set, never a prompt. The model returns a JSON array of
 * `{ find, entry }` — `find` is a literal phrase that appears in the chapter,
 * `entry` is the alphabetised index heading (with sub-entry after `:` where a
 * Word `XE` sub-entry is wanted).
 *
 * Pure — no runtime globals.
 */

export type IndexKind = 'quran' | 'hadith' | 'names' | 'places' | 'terms';

export const INDEX_KINDS: IndexKind[] = ['quran', 'hadith', 'names', 'places', 'terms'];

const KIND_RULE: Record<IndexKind, string> = {
  quran: 'Qur\'anic verses actually quoted or cited. `find` = a distinctive few words of the quoted verse as they appear; `entry` = "القرآن الكريم:<sūrah name> <āyah number>".',
  hadith: 'Hadith quoted or referenced. `find` = distinctive words of the matn or the takhrīj phrase as it appears; `entry` = "الأحاديث:<opening words of the matn>".',
  names: 'Names of people — scholars, narrators, historical figures. `find` = the name as written in the text; `entry` = the name in its conventional citation form (kunya/nisba as used in indexes).',
  places: 'Place names — cities, regions, landmarks. `find` = as written; `entry` = the standard form.',
  terms: 'Technical terms and key concepts the chapter defines or discusses substantively (not every passing mention). `find` = the term as written; `entry` = the term.',
};

export function buildIndexExtractionInstruction(kinds: IndexKind[]): string {
  const rules = kinds.map((k) => `- ${k}: ${KIND_RULE[k]}`).join('\n');
  return `You are a scholarly indexer preparing the back-matter indexes for a book chapter. From the CHAPTER TEXT, extract index entries for ONLY these kinds:
${rules}

HARD RULES:
1. \`find\` MUST be a short literal string that occurs verbatim in the chapter text — 2 to 8 words, enough to be unique. If a term appears many times, give it once; Word marks every occurrence.
2. Do NOT invent entries for things not in the text. Do NOT index a name or term that is only mentioned in passing with nothing said about it.
3. Keep the working script (Arabic names stay Arabic, etc.).
4. Output ONLY a JSON array of objects \`{"find": "...", "entry": "..."}\` — no prose, no markdown fences, no trailing commentary. An empty array is a valid answer.`;
}

/** Parse the model's reply into clean entries. Tolerates a stray fence or prose around the array. */
export function parseIndexEntries(raw: string): Array<{ find: string; entry: string }> {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  let arr: unknown;
  try { arr = JSON.parse(raw.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const out: Array<{ find: string; entry: string }> = [];
  for (const item of arr) {
    if (item && typeof item === 'object') {
      const find = String((item as Record<string, unknown>).find ?? '').trim();
      const entry = String((item as Record<string, unknown>).entry ?? '').trim();
      if (find && entry && find.length <= 120) out.push({ find, entry });
    }
  }
  return out;
}
