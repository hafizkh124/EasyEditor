// AUTO-MIRRORED from shared\text\takhrij.ts — edge deploy bundles only supabase/functions/.
// Edit shared\text\takhrij.ts and re-run: node scripts/mirror-shared.mjs
// Hadith takhrij matching — the ONE definition of "these two narrations are the
// same hadith", shared by the Deno citation engine (`takhrijHadith`) and the
// MCP `takhrij_hadith` tool.
//
// Why this lives in shared/: the MCP tool was written with its own copy of the
// tokenizer — different stopwords, a `>= 3` length cut instead of `> 3`, and a
// 0.4 default threshold instead of 0.5 — so the same hadith could match in the
// app and not through MCP (or the reverse). One implementation cannot drift.
//
// Runtime-agnostic: no Deno / node / DOM APIs (it is bundled into both the
// edge functions and the MCP server).

/** Below this content-word overlap two narrations are not treated as the same. */
export const TAKHRIJ_MIN_OVERLAP = 0.5;

/** Words too common in hadith matn/isnad to be evidence of a shared narration
 *  (قال، رسول، الله، عن، حدثنا …). Overlap on these means nothing. */
export const TAKHRIJ_COMMON_WORDS: ReadonlySet<string> = new Set([
  "قال", "قالت", "قالوا", "رسول", "الله", "النبي", "عليه", "وسلم", "صلي",
  "حدثنا", "حدثني", "اخبرنا", "اخبرني", "سمعت", "روي", "عنه", "عنها",
  "رضي", "بن", "ابن", "ابي", "عبد", "كان", "كانت", "الذي", "التي", "علي",
  "الي", "من", "في", "عن", "انه", "انها", "هذا", "هذه", "ذلك",
]);

/**
 * Same normalization as `normalizeHamzaAndAlif` in
 * supabase/functions/_shared/arabicRoot.ts (tashkeel stripped; alif forms, ya,
 * ta-marbuta and hamza carriers folded). Duplicated here only because that
 * module is Deno-side and cannot be bundled into the MCP server; a parity test
 * (takhrij.test.ts) fails if the two ever diverge.
 */
export function normalizeArabicForTakhrij(text: string): string {
  if (!text) return "";
  return text
    .replace(/[ً-ٰٟۖ-ۜ۟-۪ۨ-ۭ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

/** Content-word set for matn comparison: normalized (tashkeel/hamza/ta-marbuta),
 *  boilerplate removed, short tokens dropped. */
export function takhrijTokens(text: string): Set<string> {
  return new Set(
    normalizeArabicForTakhrij(text || "")
      .split(/[\s،.:؛()«»"'-]+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 3 && !TAKHRIJ_COMMON_WORDS.has(w)),
  );
}

/**
 * Content-word overlap between two token sets, normalized by the SMALLER side so
 * an abridged narration still matches its fuller version. Returns `null` when
 * either side has too little content to judge (< 3 tokens) — omit rather than guess.
 */
export function takhrijOverlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number | null {
  if (a.size < 3 || b.size < 3) return null;
  let shared = 0;
  for (const w of b) if (a.has(w)) shared++;
  return shared / Math.min(a.size, b.size);
}
