/**
 * M11 Phase 4 — Zakat calculation engine (ADR-0048).
 * Pure computation: assets − liabilities → nisab comparison → 2.5%.
 * The model never does math — it only provides fiqh text and dalail.
 * Gold/silver prices are user-provided (no live feed).
 */

/** Individual asset entry. */
export interface ZakatAsset {
  /** Category label (e.g., "Cash", "Gold", "Silver", "Business Inventory"). */
  category: string;
  /** Value in the user's base currency. */
  amount: number;
  /** Whether this asset is subject to zakat. */
  subjectToZakat: boolean;
}

/** Individual liability (debt due). */
export interface ZakatLiability {
  description: string;
  amount: number;
}

/** Nisab thresholds (user-provided prices). */
export interface NisabInput {
  /** Price per gram of gold in user's currency. */
  goldPricePerGram: number;
  /** Price per gram of silver in user's currency. */
  silverPricePerGram: number;
  /** Which nisab standard to use. */
  standard: "gold" | "silver";
}

/** Result of zakat calculation. */
export interface ZakatResult {
  /** Total zakatable assets. */
  totalAssets: number;
  /** Total liabilities (debts due). */
  totalLiabilities: number;
  /** Net zakatable base (assets − liabilities). */
  netBase: number;
  /** Nisab threshold in user's currency. */
  nisabThreshold: number;
  /** Whether the net base meets or exceeds nisab. */
  nisabMet: boolean;
  /** Zakat amount at 2.5%. */
  zakatAmount: number;
  /** The rate applied (always 0.025). */
  rate: number;
  /** Which nisab standard was used. */
  nisabStandard: "gold" | "silver";
  /** Breakdown by category. */
  breakdown: Array<{
    category: string;
    amount: number;
    subjectToZakat: boolean;
  }>;
}

/**
 * Calculate zakat on given assets and liabilities.
 *
 * Rules:
 * - Only assets marked `subjectToZakat: true` are included.
 * - Liabilities are subtracted from total zakatable assets.
 * - If the net base >= nisab, zakat = 2.5% of net base.
 * - If the net base < nisab, no zakat is due.
 *
 * @param assets - List of assets
 * @param liabilities - List of debts due
 * @param nisab - Nisab input (gold/silver price + standard)
 * @returns Complete zakat calculation result
 */
export function calculateZakat(
  assets: ZakatAsset[],
  liabilities: ZakatLiability[],
  nisab: NisabInput,
): ZakatResult {
  const totalAssets = assets
    .filter((a) => a.subjectToZakat)
    .reduce((sum, a) => sum + Math.max(0, a.amount), 0);

  const totalLiabilities = liabilities
    .reduce((sum, l) => sum + Math.max(0, l.amount), 0);

  const netBase = Math.max(0, totalAssets - totalLiabilities);

  // Nisab: gold = 85g × price/g, silver = 595g × price/g
  const nisabThreshold = nisab.standard === "gold"
    ? 85 * nisab.goldPricePerGram
    : 595 * nisab.silverPricePerGram;

  const nisabMet = netBase >= nisabThreshold;
  const rate = 0.025; // 2.5%
  const zakatAmount = nisabMet ? netBase * rate : 0;

  return {
    totalAssets,
    totalLiabilities,
    netBase,
    nisabThreshold,
    nisabMet,
    zakatAmount,
    rate,
    nisabStandard: nisab.standard,
    breakdown: assets.map((a) => ({
      category: a.category,
      amount: a.amount,
      subjectToZakat: a.subjectToZakat,
    })),
  };
}

/**
 * Common zakat categories with default subject-to-zakat flags.
 */
export const ZAKAT_CATEGORIES = [
  { id: "cash", label: "Cash (savings, deposits)", subjectToZakat: true },
  { id: "gold", label: "Gold (jewelry, coins, bars)", subjectToZakat: true },
  { id: "silver", label: "Silver (jewelry, coins)", subjectToZakat: true },
  { id: "business", label: "Business inventory", subjectToZakat: true },
  { id: "investments", label: "Investments (stocks, shares)", subjectToZakat: true },
  { id: "receivables", label: "Receivables (money owed to you)", subjectToZakat: true },
  { id: "personal", label: "Personal use items (home, car)", subjectToZakat: false },
  { id: "necessities", label: "Necessities (food, clothing for a year)", subjectToZakat: false },
] as const;
