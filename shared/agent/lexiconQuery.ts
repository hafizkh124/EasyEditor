/**
 * Connectors Hub (Phase 6, ADR-0043) — the Arabic → Urdu lexicon query builder.
 *
 * `lookup_lexicon` does NOT synthesise a gloss and stamp a printed-page citation
 * on it — that would be a fabricated reference, exactly what the citation ledger
 * exists to prevent. Instead it reuses the corpus's existing verified
 * Arabic → Urdu lexical material (لغتِ قرآن, `islamicurdubooks-lexicon`,
 * reachable through `islamic-search`'s Tier D `lughat` discipline) — the same
 * move `lookup_narrator` makes for rijāl — plus an honest, user-verified link
 * to al-Maany.
 *
 * Miṣbāḥ al-Lughāt / al-Qāmūs al-Wāḥid printed-page citations are added only if
 * a real root→page index file is supplied later (`resources/lexicon/`).
 *
 * Pure — no runtime globals.
 */

export type LexiconDict = 'misbah' | 'qamus' | 'both';

/** Normalise an Arabic word for matching (drop ḥarakāt, unify hamza / yāʾ). */
export function normaliseArabicWord(word: string): string {
  let out = '';
  for (const ch of word) {
    const cp = ch.codePointAt(0) ?? 0;
    const isMark =
      (cp >= 0x0610 && cp <= 0x061a) ||
      (cp >= 0x064b && cp <= 0x065f) ||
      cp === 0x0670 || cp === 0x0640 || cp === 0x200c || cp === 0x200d;
    if (!isMark) out += ch;
  }
  return out
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ىئ]/g, 'ی')
    .replace(/ؤ/g, 'و')
    .replace(/[ۃة]/g, 'ت')
    .trim();
}

export function buildLexiconQuery(word: string): string {
  const w = word.trim();
  return `المعنى اللغوي والمادة (الجذر) للكلمة «${w}» — المعنى بالأردية، الاشتقاق، والشواهد القرآنية (لغت، معجم، مفردات، لغوی معنیٰ)`;
}

/** The user-facing al-Maany deep link — a place to VERIFY, not a citation. */
export function almaanyUrl(word: string): string {
  return `https://www.almaany.com/ur/dict/ar-ur/${encodeURIComponent(word.trim())}/`;
}
