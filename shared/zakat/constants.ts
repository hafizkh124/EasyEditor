/**
 * M12 Phase A — zakat constants, ported verbatim from the لجنۃ العلماء–verified
 * `islamic-calculator` project (`src/lib/constants.ts`, `constants/metals.ts`,
 * `constants/currency.ts`, `utils/units.ts`).
 *
 * Pure. See `shared/zakat/RULES.md` for the fiqh basis.
 */

/** 2.5% — the zakat rate on مالِ نامی (Qur'an 9:103; sunnah, ijmāʿ). */
export const ZAKAT_RATE = 0.025;

/** 1 tola = 11.664 g (subcontinental standard). */
export const TOLA_GRAMS = 11.664;
/** 1 troy ounce = 31.1035 g. */
export const OUNCE_GRAMS = 31.1035;

/**
 * Nisāb weights, in grams.
 * - Gold: 85 g (≈ 7.5 tola / 20 mithqāl) — agreed.
 * - Silver: 612.36 g (52.5 tola, the Ḥanafī reckoning). Some contemporary
 *   bodies use 595 g (700 mithqāl); `NisabInput.silverNisabGrams` overrides.
 */
export const NISAB = {
  gold: { grams: 85, label: 'سونا — ۸۵ گرام (۷.۵ تولہ)' },
  silver: { grams: 612.36, label: 'چاندی — ۶۱۲.۳۶ گرام (۵۲.۵ تولہ)' },
} as const;

/** The alternative silver nisāb some academies adopt. */
export const SILVER_NISAB_ALT_GRAMS = 595;

/**
 * Gold purity → fraction of pure gold. A price quoted per gram of pure (24K)
 * gold is scaled by this for a holding of a lower karat.
 */
export const GOLD_PURITY: Record<GoldPurity, number> = {
  '24K': 1.0,
  '22K': 0.9167,
  '21K': 0.875,
  '18K': 0.75,
};

export type GoldPurity = '24K' | '22K' | '21K' | '18K';

/**
 * Example metal prices per gram of pure metal, keyed by currency — a SEED for
 * the UI only. The engine never reads a price it was not given: a wrong price
 * is a wrong fiqh result (ADR-0048).
 */
export const EXAMPLE_METAL_PRICES: Record<string, { gold: number; silver: number }> = {
  USD: { gold: 166.0, silver: 2.85 },
  PKR: { gold: 46480, silver: 798 },
  SAR: { gold: 622, silver: 10.69 },
  AED: { gold: 609, silver: 10.46 },
  GBP: { gold: 132.55, silver: 2.27 },
  INR: { gold: 15059, silver: 259 },
};

/**
 * Fallback FX rates — units per 1 USD. Used only by the charity helpers to
 * scale a base amount into an unfamiliar currency; never for zakat itself.
 */
export const FALLBACK_RATES: Record<string, number> = {
  USD: 1.0, PKR: 280.0, SAR: 3.75, AED: 3.6725, GBP: 0.79, EUR: 0.92,
  INR: 83.3, BDT: 110.0, TRY: 32.0, MYR: 4.7, IDR: 15600, CAD: 1.36,
  AUD: 1.52, ZAR: 18.5, NGN: 1500, EGP: 48.0, QAR: 3.64, KWD: 0.307,
  BHD: 0.376, OMR: 0.385,
};

/** Convert a weight in tola/ounce to grams. */
export function toGrams(value: number, unit: 'gram' | 'tola' | 'ounce'): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  if (unit === 'tola') return value * TOLA_GRAMS;
  if (unit === 'ounce') return value * OUNCE_GRAMS;
  return value;
}
