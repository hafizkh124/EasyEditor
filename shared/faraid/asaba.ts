/**
 * M12 Phase B — العصبة: the residuary heirs.
 *
 * The priority chain (Jumhūr): descendants → father/grandfather → siblings'
 * line → siblings' sons → paternal uncles → paternal uncles' sons. Within each
 * rung, full-blood outranks paternal-only, and a male anchor pulls in the
 * matching female at a 2:1 ratio (`asaba bi-nafsihi` + `asaba bi-ghayrihi`).
 * "العصبة مع الغير" — sisters becoming residuary alongside daughters when no
 * father/grandfather/full-brother stands between them — is the one case a
 * FEMALE-only group can be the residuary heir on her own line.
 *
 * `calculate(...)` returns who is entitled to the residue and in what ratio;
 * `calculator.ts` scales that ratio by whatever residue is actually left.
 *
 * Pure.
 */
import {
  countOf, isPresent, type HeirCounts, type HeirType,
} from './heirs.js';
import { paternalGrandfatherExcluded, paternalLineSiblingExcluded } from './hajb.js';

export interface AsabaShare {
  heir: HeirType;
  /** Relative weight within the residuary group (2 for a male anchor's own share unit, 1 for the paired female's). */
  weight: number;
  dalil: string;
}

export interface AsabaResult {
  /** Empty when no residuary heir exists at all (radd applies instead — calculator.ts). */
  shares: AsabaShare[];
  ruleRef: string;
}

const D_RESIDUE = 'باقی ماندہ ترکہ عصبہ کو، مرد کو عورت سے دو گنا (۴:۱۱)۔';
const D_RESIDUE_SISTERS = 'باپ/دادا/حقیقی بھائی کی عدم موجودگی میں بہنیں بیٹیوں کے ساتھ عصبہ (عصبہ مع الغیر)۔';

function group(anchor: HeirType, anchorN: number, female: HeirType, femaleN: number, dalil: string): AsabaShare[] {
  const out: AsabaShare[] = [];
  if (anchorN > 0) out.push({ heir: anchor, weight: 2 * anchorN, dalil });
  if (femaleN > 0) out.push({ heir: female, weight: 1 * femaleN, dalil });
  return out;
}

export function computeAsaba(h: HeirCounts): AsabaResult {
  // 1. Sons (with daughters at 2:1).
  const sonN = countOf(h, 'son');
  if (sonN > 0) {
    return { shares: group('son', sonN, 'daughter', countOf(h, 'daughter'), D_RESIDUE), ruleRef: 'RULES.md#asaba' };
  }
  // 2. Son's sons (with son's daughters at 2:1) — only reached if no son.
  const grandsonN = countOf(h, 'grandson');
  if (grandsonN > 0) {
    return { shares: group('grandson', grandsonN, 'granddaughter', countOf(h, 'granddaughter'), D_RESIDUE), ruleRef: 'RULES.md#asaba' };
  }

  const hasDaughterLine = countOf(h, 'daughter') > 0 || countOf(h, 'granddaughter') > 0;

  // 3. Father — asaba only when no son/grandson exists (fixed 1/6 already taken by shares.ts).
  if (isPresent(h, 'father')) {
    return { shares: [{ heir: 'father', weight: 1, dalil: 'باقی ترکہ باپ کو، اولاد میں بیٹا نہ ہونے کی صورت میں (۴:۱۱)۔' }], ruleRef: 'RULES.md#asaba' };
  }

  // 4. Paternal grandfather — same role as father when father is absent.
  if (isPresent(h, 'paternalGrandfather') && !paternalGrandfatherExcluded(h)) {
    return { shares: [{ heir: 'paternalGrandfather', weight: 1, dalil: 'دادا والد کے قائم مقام، اولاد میں بیٹا نہ ہونے کی صورت میں۔' }], ruleRef: 'RULES.md#asaba' };
  }

  // 5. "عصبہ مع الغیر" — sisters as residuary alongside a daughter/granddaughter,
  //    when no father/grandfather/full-brother stands ahead of them.
  if (hasDaughterLine && !paternalLineSiblingExcluded(h)) {
    const fullSisterN = countOf(h, 'fullSister');
    const fullBrotherN = countOf(h, 'fullBrother');
    if (fullBrotherN === 0 && fullSisterN > 0) {
      return { shares: [{ heir: 'fullSister', weight: fullSisterN, dalil: D_RESIDUE_SISTERS }], ruleRef: 'RULES.md#asaba-with-daughters' };
    }
    if (fullBrotherN === 0 && fullSisterN === 0) {
      const paternalSisterN = countOf(h, 'paternalSister');
      const paternalBrotherN = countOf(h, 'paternalBrother');
      if (paternalBrotherN === 0 && paternalSisterN > 0) {
        return { shares: [{ heir: 'paternalSister', weight: paternalSisterN, dalil: D_RESIDUE_SISTERS }], ruleRef: 'RULES.md#asaba-with-daughters' };
      }
    }
  }

  // 6. Siblings' line (ordinary asaba — no daughters involved, or daughters
  //    already fully absorbed the estate and there is nothing to defer).
  if (!paternalLineSiblingExcluded(h)) {
    const fullBrotherN = countOf(h, 'fullBrother');
    if (fullBrotherN > 0) {
      return { shares: group('fullBrother', fullBrotherN, 'fullSister', countOf(h, 'fullSister'), D_RESIDUE), ruleRef: 'RULES.md#asaba' };
    }
    // No full brother: full sister(s) alone were already handled as fixed-share
    // (shares.ts) unless the asaba-with-daughters branch above already returned.
    const paternalBrotherN = countOf(h, 'paternalBrother');
    if (paternalBrotherN > 0) {
      return { shares: group('paternalBrother', paternalBrotherN, 'paternalSister', countOf(h, 'paternalSister'), D_RESIDUE), ruleRef: 'RULES.md#asaba' };
    }
  }

  // 7. Siblings' sons (nephews) — only reached with no brother of either line.
  const chain: Array<[HeirType, string]> = [
    ['fullNephew', 'حقیقی بھائی کے بیٹے کو باقی، حقیقی بھائی کی عدم موجودگی میں۔'],
    ['paternalNephew', 'علاتی بھائی کے بیٹے کو باقی، حقیقی بھتیجے کی عدم موجودگی میں۔'],
    ['fullUncle', 'حقیقی چچا کو باقی، بھتیجوں کی عدم موجودگی میں۔'],
    ['paternalUncle', 'علاتی چچا کو باقی، حقیقی چچا کی عدم موجودگی میں۔'],
    ['fullCousin', 'حقیقی چچا زاد کو باقی، چچاؤں کی عدم موجودگی میں۔'],
    ['paternalCousin', 'علاتی چچا زاد کو باقی، حقیقی چچا زاد کی عدم موجودگی میں۔'],
    ['paternalCousinsGrandson', 'علاتی چچا زاد کے پوتے کو باقی، قریب تر عصبہ کی عدم موجودگی میں۔'],
  ];
  // Excluded from this whole further-collateral chain by the very same things
  // that exclude ordinary siblings (father, grandfather, a male descendant),
  // since every rung here is even more distant.
  if (!paternalLineSiblingExcluded(h)) {
    for (const [t, dalil] of chain) {
      const n = countOf(h, t);
      if (n > 0) return { shares: [{ heir: t, weight: n, dalil }], ruleRef: 'RULES.md#asaba' };
    }
  }

  return { shares: [], ruleRef: 'RULES.md#no-asaba' };
}
