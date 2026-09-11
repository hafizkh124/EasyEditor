/**
 * M12 Phase B — the closed heir vocabulary.
 *
 * These 24 types are exactly the categories that appear in the ilmsummit.org
 * gold-set (134 cases; see `src/test/fixtures/faraid/cases.ts`). Only agnatic
 * (male-line) collaterals reach 'aṣaba status in the Jumhūr view this engine
 * follows — a maternal grandfather, for instance, is not an heir type at all
 * (he is dhawil-arḥām, out of scope for this closed list).
 *
 * Pure.
 */

export type HeirType =
  // spouse
  | 'husband' | 'wife'
  // children
  | 'son' | 'daughter'
  // parents
  | 'father' | 'mother'
  // grandparents
  | 'paternalGrandfather' | 'paternalGrandmother' | 'maternalGrandmother'
  // grandchildren (son's line only — the agnatic branch)
  | 'grandson' | 'granddaughter'
  // siblings
  | 'fullBrother' | 'fullSister'
  | 'paternalBrother' | 'paternalSister'
  | 'maternalBrother' | 'maternalSister'
  // siblings' sons (asaba, further degree)
  | 'fullNephew' | 'paternalNephew'
  // paternal uncles (asaba, further degree)
  | 'fullUncle' | 'paternalUncle'
  // paternal uncles' sons (asaba, furthest degree in this closed set)
  | 'fullCousin' | 'paternalCousin' | 'paternalCousinsGrandson';

export const HEIR_TYPES: HeirType[] = [
  'husband', 'wife', 'son', 'daughter', 'father', 'mother',
  'paternalGrandfather', 'paternalGrandmother', 'maternalGrandmother',
  'grandson', 'granddaughter',
  'fullBrother', 'fullSister', 'paternalBrother', 'paternalSister', 'maternalBrother', 'maternalSister',
  'fullNephew', 'paternalNephew', 'fullUncle', 'paternalUncle',
  'fullCousin', 'paternalCousin', 'paternalCousinsGrandson',
];

export const HEIR_LABEL_UR: Record<HeirType, string> = {
  husband: 'شوہر', wife: 'بیوی', son: 'بیٹا', daughter: 'بیٹی',
  father: 'والد', mother: 'والدہ',
  paternalGrandfather: 'دادا', paternalGrandmother: 'دادی', maternalGrandmother: 'نانی',
  grandson: 'پوتا', granddaughter: 'پوتی',
  fullBrother: 'حقیقی بھائی', fullSister: 'حقیقی بہن',
  paternalBrother: 'علاتی بھائی (پدری)', paternalSister: 'علاتی بہن (پدری)',
  maternalBrother: 'اخیافی بھائی (مادری)', maternalSister: 'اخیافی بہن (مادری)',
  fullNephew: 'حقیقی بھتیجا', paternalNephew: 'علاتی بھتیجا',
  fullUncle: 'حقیقی چچا', paternalUncle: 'علاتی چچا',
  fullCousin: 'حقیقی چچا زاد', paternalCousin: 'علاتی چچا زاد', paternalCousinsGrandson: 'چچا زاد کا پوتا',
};

/** Male heir types — used for the ½/⅓ asaba-residue ratio and gender checks. */
export const MALE_HEIRS = new Set<HeirType>([
  'husband', 'son', 'father', 'paternalGrandfather', 'grandson',
  'fullBrother', 'paternalBrother', 'maternalBrother',
  'fullNephew', 'paternalNephew', 'fullUncle', 'paternalUncle',
  'fullCousin', 'paternalCousin', 'paternalCousinsGrandson',
]);

/** `{ heirType: count }` — the input to the engine. A boolean-ish heir (father, mother, …) is 0 or 1. */
export type HeirCounts = Partial<Record<HeirType, number>>;

export function countOf(heirs: HeirCounts, t: HeirType): number {
  const n = heirs[t];
  return Number.isFinite(n) && (n as number) > 0 ? Math.floor(n as number) : 0;
}

export function isPresent(heirs: HeirCounts, t: HeirType): boolean {
  return countOf(heirs, t) > 0;
}

export function hasAnyDescendant(heirs: HeirCounts): boolean {
  return ['son', 'daughter', 'grandson', 'granddaughter'].some((t) => isPresent(heirs, t as HeirType));
}

export function hasAnySon(heirs: HeirCounts): boolean {
  return isPresent(heirs, 'son') || isPresent(heirs, 'grandson');
}
