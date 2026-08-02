import { describe, it, expect } from 'vitest';
import { normalizeArabicForSearch } from '../../shared/text/arabicSearch.js';
import { normalizeArabic } from '../utils/arabicUtils.js';

/**
 * SPEC-M6 Phase 5: the main-process search index normalizes Arabic exactly
 * like the renderer's embedding/search path does (src/utils/arabicUtils.ts).
 * If these ever drift, keyword search would match text the reader/vector
 * search treats as different — a silent retrieval inconsistency.
 */
describe('normalizeArabicForSearch mirrors normalizeArabic', () => {
  it('applies the same transform on representative samples', () => {
    const samples = [
      'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
      'ذَخَائِرُ الْعُقْبَى فِي مَنَاقِبِ ذَوِي الْقُرْبَى',
      'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَالَمِينَ',
      'هَٰذَا كِتَابٌ عَلَىٰ مَسَائِلِ الْمُسْتَشْفِعِينَ',
      'أَحْمَد بْن مُحَمَّد المِصري عَلَيهِ السَّلَامُ',
    ];
    for (const s of samples) {
      expect(normalizeArabicForSearch(s)).toBe(normalizeArabic(s));
    }
  });
});
