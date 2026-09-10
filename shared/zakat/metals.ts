/**
 * M12 Phase A — gold & silver zakat.
 *
 * Ported from `islamic-calculator` `store/utils/index.ts:139-220`
 * (`computeMetalsResults` — the purity-aware, 3-bucket implementation, the
 * canonical one; NOT `lib/assets/precious-metals.ts`). Dropped: the module-level
 * `Map` cache, `Math.random()` sampled `console.log`, and `new Date()`.
 *
 * The one change of substance: `jewelleryRuling: 'hanafi-all'` makes the
 * everyday-use bucket zakatable too (M12 decision — the source hard-coded it
 * exempt, contradicting its own stated Ḥanafī nisāb).
 *
 * Pure.
 */
import { GOLD_PURITY, type GoldPurity } from './constants.js';
import type { GoldHolding, JewelleryRuling, MetalUse, SilverHolding } from './types.js';

const validPurity = (p: GoldPurity | undefined): GoldPurity =>
  p && p in GOLD_PURITY ? p : '24K';

const resolveUse = (u: MetalUse | undefined): MetalUse => u ?? 'investment';

/** A holding is zakatable unless it is everyday personal wear under the Jumhūr-applied view. */
function isZakatable(u: MetalUse, ruling: JewelleryRuling, hawlMet: boolean): boolean {
  if (!hawlMet) return false;
  if (ruling === 'hanafi-all') return true;
  return u !== 'regular';
}

export interface MetalZakat {
  goldValueTotal: number;
  silverValueTotal: number;
  goldZakatable: number;
  silverZakatable: number;
  /** Weight of gold that counted toward the zakatable base (for the breakdown). */
  goldGramsZakatable: number;
  silverGramsZakatable: number;
}

export function computeMetalZakat(
  gold: GoldHolding[] | undefined,
  silver: SilverHolding[] | undefined,
  goldPricePerGram: number,
  silverPricePerGram: number,
  hawlMet: boolean,
  ruling: JewelleryRuling,
): MetalZakat {
  const gp = Number.isFinite(goldPricePerGram) && goldPricePerGram > 0 ? goldPricePerGram : 0;
  const sp = Number.isFinite(silverPricePerGram) && silverPricePerGram > 0 ? silverPricePerGram : 0;

  let goldValueTotal = 0;
  let goldZakatable = 0;
  let goldGramsZakatable = 0;
  for (const h of gold ?? []) {
    const grams = Number.isFinite(h.grams) && h.grams > 0 ? h.grams : 0;
    const value = grams * gp * GOLD_PURITY[validPurity(h.purity)];
    goldValueTotal += value;
    if (isZakatable(resolveUse(h.use), ruling, hawlMet)) {
      goldZakatable += value;
      goldGramsZakatable += grams;
    }
  }

  let silverValueTotal = 0;
  let silverZakatable = 0;
  let silverGramsZakatable = 0;
  for (const h of silver ?? []) {
    const grams = Number.isFinite(h.grams) && h.grams > 0 ? h.grams : 0;
    const value = grams * sp;
    silverValueTotal += value;
    if (isZakatable(resolveUse(h.use), ruling, hawlMet)) {
      silverZakatable += value;
      silverGramsZakatable += grams;
    }
  }

  return {
    goldValueTotal,
    silverValueTotal,
    goldZakatable,
    silverZakatable,
    goldGramsZakatable,
    silverGramsZakatable,
  };
}
