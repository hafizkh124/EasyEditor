/**
 * M12 Phase A — nisāb threshold.
 *
 * Ported from `islamic-calculator` `store/utils/nisabUtils.ts:24-51` (the pure
 * function; NOT `lib/utils/nisabCalculations.ts`, which reads
 * `FALLBACK_METAL_PRICES.gold` on a currency-keyed object → `undefined` → NaN).
 *
 * Pure.
 */
import { NISAB } from './constants.js';
import type { NisabInput } from './types.js';

export interface NisabResult {
  goldThreshold: number;
  silverThreshold: number;
  /** The threshold that applies given `standard`. */
  threshold: number;
  standardUsed: 'gold' | 'silver';
}

/**
 * `standard: 'gold' | 'silver'` picks that metal's threshold outright.
 * `standard: 'lower'` takes `min(gold, silver)` — in practice silver, the
 * cautious choice that favours the poor.
 */
export function nisabThreshold(input: NisabInput): NisabResult {
  const g = Number.isFinite(input.goldPricePerGram) && input.goldPricePerGram > 0 ? input.goldPricePerGram : 0;
  const s = Number.isFinite(input.silverPricePerGram) && input.silverPricePerGram > 0 ? input.silverPricePerGram : 0;
  const silverGrams = input.silverNisabGrams && input.silverNisabGrams > 0 ? input.silverNisabGrams : NISAB.silver.grams;

  const goldThreshold = g * NISAB.gold.grams;
  const silverThreshold = s * silverGrams;

  let standardUsed: 'gold' | 'silver';
  let threshold: number;
  if (input.standard === 'gold') {
    standardUsed = 'gold';
    threshold = goldThreshold;
  } else if (input.standard === 'silver') {
    standardUsed = 'silver';
    threshold = silverThreshold;
  } else {
    // 'lower' — whichever is smaller (both must be usable)
    if (goldThreshold > 0 && (silverThreshold === 0 || goldThreshold <= silverThreshold)) {
      standardUsed = 'gold';
      threshold = goldThreshold;
    } else {
      standardUsed = 'silver';
      threshold = silverThreshold;
    }
  }

  return { goldThreshold, silverThreshold, threshold, standardUsed };
}
