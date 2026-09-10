/**
 * M12 Phase A — zakat engine types.
 *
 * The agent tool receives a JSON string and parses it into `ZakatInput`; the
 * engine returns `ZakatResult`. Every result carries a `note` (this is a
 * computation on the user's own figures, not a fatwā) and every line carries a
 * `dalil` / `ruleRef` — the model never does the arithmetic (ADR-0048).
 *
 * Pure.
 */
import type { GoldPurity } from './constants.js';

export type { GoldPurity };

/** How gold/silver held for personal use ("زیورِ استعمال") is treated. */
export type JewelleryRuling =
  /** Ḥanafī: all gold & silver is zakatable, including everyday personal jewellery. */
  | 'hanafi-all'
  /** Jumhūr view as commonly applied: jewellery in regular personal use is exempt. */
  | 'personal-exempt';

/** The intent behind a metal holding — drives the exemption under `personal-exempt`. */
export type MetalUse =
  /** Everyday personal wear. */
  | 'regular'
  /** Occasional / kept-for-events. */
  | 'occasional'
  /** Held as an investment / store of value. */
  | 'investment';

export interface GoldHolding {
  grams: number;
  purity?: GoldPurity;
  use?: MetalUse;
}

export interface SilverHolding {
  grams: number;
  use?: MetalUse;
}

export interface NisabInput {
  /** Price of one gram of PURE (24K) gold, in the user's currency. */
  goldPricePerGram: number;
  /** Price of one gram of silver, in the user's currency. */
  silverPricePerGram: number;
  /** Which metal's threshold to use. Silver is the cautious (فقراء-favouring) choice. */
  standard: 'gold' | 'silver' | 'lower';
  /** Override the silver weight — 612.36 (default) or 595. */
  silverNisabGrams?: number;
}

export interface ZakatInput {
  /** Has a full lunar year (حول) passed on the wealth? */
  hawlMet: boolean;
  /** Display label only — never affects the maths. */
  currency?: string;
  nisab: NisabInput;
  /** Default: `'personal-exempt'`. */
  jewelleryRuling?: JewelleryRuling;

  // ── assets ──
  /** All liquid cash aggregated (on hand + bank + digital wallets + foreign, converted). */
  cash?: number;
  gold?: GoldHolding[];
  silver?: SilverHolding[];
  /** Merchandise held for sale, at current market value. */
  tradeGoods?: number;
  /** Shares/units held for trading (zakatable in full) or the zakatable portion of long-term holdings. */
  investments?: number;
  /** Money owed to the payer that is expected to be recovered. */
  receivables?: number;
  /** Net rental income for the year (income − expenses), if ≥ 0. */
  rentalIncomeNet?: number;
  /** Property actively listed for sale, at market value. */
  propertyForSale?: number;
  /** Vacant land held (not primary residence, not in use). */
  vacantLand?: number;

  // ── liabilities (deducted) ──
  /** Debts due now / within the year. */
  debtsDue?: number;
  /** One year's instalments of a long-term debt. */
  longTermDebtAnnual?: number;
}

export interface ZakatLine {
  key: string;
  label: string;
  /** The asset's total value (may be 0 for a purely informational row). */
  value: number;
  /** How much of `value` counts toward the zakatable base (can be negative for a liability). */
  zakatable: number;
  /** Short fiqh basis for this line. */
  dalil: string;
  /** Pointer into `RULES.md`. */
  ruleRef: string;
}

export interface ZakatResult {
  currency?: string;
  hawlMet: boolean;
  jewelleryRuling: JewelleryRuling;

  /** Σ of the zakatable assets (before liabilities). */
  totalZakatableAssets: number;
  /** Σ of the deductible liabilities. */
  totalLiabilities: number;
  /** `max(0, assets − liabilities)`. */
  netZakatableBase: number;

  nisabThreshold: number;
  nisabStandardUsed: 'gold' | 'silver';
  nisabMet: boolean;

  rate: number;
  /** `nisabMet ? netZakatableBase * rate : 0`. */
  zakatDue: number;

  lines: ZakatLine[];
  /** The non-fatwā disclaimer — always present. */
  note: string;
}

// ── charity (فدیہ / کفارہ / صدقۃ الفطر) ──

export interface FidyaInput {
  missedFasts: number;
  /** Local price of one kg of wheat, in the user's currency. */
  wheatPricePerKg: number;
  currency?: string;
}

export interface KaffaraOathInput {
  brokenOaths: number;
  option: 'feeding' | 'clothing';
  /** Cost to feed/clothe one مسکین for the day. */
  costPerPerson: number;
  currency?: string;
}

export interface SadqaFitrInput {
  familyMembers: number;
  /** Local price of one kg of wheat. */
  wheatPricePerKg: number;
  currency?: string;
}

export interface CharityResult {
  amount: number;
  currency?: string;
  breakdown: string;
  dalil: string;
  note: string;
}
