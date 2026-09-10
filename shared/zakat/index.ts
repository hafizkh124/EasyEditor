/**
 * M12 Phase A — public surface of the zakat engine.
 *
 * Ported (arithmetic only) from the لجنۃ العلماء–verified `islamic-calculator`
 * project; see `RULES.md`. Pure — the model never computes (ADR-0048).
 */
export { calculateZakat } from './calculator.js';
export { nisabThreshold, type NisabResult } from './nisab.js';
export { computeMetalZakat, type MetalZakat } from './metals.js';
export { sadqaFitr, fidya, kaffaraOath, SAA_KG, HALF_SAA_KG, KAFFARA_YAMIN_PEOPLE } from './charity.js';
export {
  ZAKAT_RATE, NISAB, SILVER_NISAB_ALT_GRAMS, GOLD_PURITY, TOLA_GRAMS, OUNCE_GRAMS,
  EXAMPLE_METAL_PRICES, FALLBACK_RATES, toGrams,
} from './constants.js';
export type {
  ZakatInput, ZakatResult, ZakatLine, NisabInput, JewelleryRuling, MetalUse,
  GoldHolding, SilverHolding, GoldPurity,
  FidyaInput, KaffaraOathInput, SadqaFitrInput, CharityResult,
} from './types.js';
