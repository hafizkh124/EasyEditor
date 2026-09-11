/**
 * M12 Phase B — أصحاب الفروض: the Qur'anic fixed shares (4:11, 4:12, 4:176).
 *
 * Returns the fixed-share lines PLUS which heir types are deferred into the
 * residuary (`asaba.ts`) step instead of taking a fixed share — a daughter
 * joins a son at 2:1 rather than taking ½/⅔, exactly as a full sister joins a
 * full brother, and a paternal sister joins a paternal brother. That deferral
 * is the mechanism, not a separate rule.
 *
 * Jumhūr view (see `RULES.md`). Special cases (العمريتان, الجد مع الإخوة) are
 * applied by `specialCases.ts` as an override BEFORE this runs.
 *
 * Pure.
 */
import { make, type Rational, ZERO } from './rational.js';
import {
  countOf, hasAnyDescendant, hasAnySon, isPresent, type HeirCounts, type HeirType,
} from './heirs.js';
import {
  maternalGrandmotherExcluded, maternalSiblingExcluded, paternalGrandfatherExcluded,
  paternalGrandmotherExcluded, paternalLineSiblingExcluded,
} from './hajb.js';

export interface FixedShareLine {
  heir: HeirType;
  share: Rational;
  dalil: string;
}

export interface FixedSharesResult {
  lines: FixedShareLine[];
  /** No living son/grandson -> father (if present) also competes for the residue as asaba. */
  fatherIsAsaba: boolean;
  /** No living son/grandson, no father -> grandfather (if present & not excluded) competes for the residue. */
  grandfatherIsAsaba: boolean;
  /** Heir types whose count is > 0 here but who take NOTHING fixed (asaba, hajb, or a slot already filled) — for the result table. */
  excludedButPresent: HeirType[];
}

const D_SPOUSE = 'زوج/زوجہ کا حصہ اولاد کی موجودگی/عدم موجودگی سے متعین (۴:۱۲)۔';
const D_MOTHER = 'والدہ کا حصہ (۴:۱۱)۔';
const D_FATHER = 'والد کا مقررہ حصہ ۱/۶ (اولاد کی موجودگی میں) (۴:۱۱)۔';
const D_GF = 'دادا، والد کی غیر موجودگی میں والد کے قائم مقام (۴:۱۱ پر قیاس)۔';
const D_CHILD = 'اولاد کا مقررہ حصہ (۴:۱۱)۔';
const D_GCHILD = 'پوتے/پوتی کا حصہ، پوتے کی غیر موجودگی میں اولاد پر قیاس۔';
const D_GM = 'دادی/نانی کا حصہ ۱/۶ (مشترک) — سنت میں مقرر۔';
const D_SIB_FULL = 'حقیقی بھائی/بہن کا حصہ (۴:۱۲، ۴:۱۷۶)۔';
const D_SIB_PAT = 'علاتی بھائی/بہن کا حصہ، حقیقی بھائی/بہن کی طرز پر۔';
const D_SIB_MAT = 'اخیافی بھائی/بہن کا حصہ ۱/۶ یا ۱/۳ مشترک، مرد و عورت برابر (۴:۱۲)۔';

export function computeFixedShares(h: HeirCounts): FixedSharesResult {
  const lines: FixedShareLine[] = [];
  const excludedButPresent: HeirType[] = [];
  const anyDescendant = hasAnyDescendant(h);
  const sonLine = hasAnySon(h);

  // ── spouse ──
  if (isPresent(h, 'husband')) {
    lines.push({ heir: 'husband', share: anyDescendant ? make(1, 4) : make(1, 2), dalil: D_SPOUSE });
  }
  if (isPresent(h, 'wife')) {
    lines.push({ heir: 'wife', share: anyDescendant ? make(1, 8) : make(1, 4), dalil: D_SPOUSE });
  }

  // ── mother / father (Umariyyatān handled upstream by specialCases.ts) ──
  const siblingCount = (['fullBrother', 'fullSister', 'paternalBrother', 'paternalSister', 'maternalBrother', 'maternalSister'] as HeirType[])
    .reduce((n, t) => n + countOf(h, t), 0);
  if (isPresent(h, 'mother')) {
    const third = anyDescendant || siblingCount >= 2;
    lines.push({ heir: 'mother', share: third ? make(1, 6) : make(1, 3), dalil: D_MOTHER });
  }

  let fatherIsAsaba = false;
  if (isPresent(h, 'father')) {
    if (anyDescendant) lines.push({ heir: 'father', share: make(1, 6), dalil: D_FATHER });
    fatherIsAsaba = !sonLine; // no son/grandson -> father also takes the residue
  }

  let grandfatherIsAsaba = false;
  if (isPresent(h, 'paternalGrandfather') && !paternalGrandfatherExcluded(h)) {
    if (anyDescendant) lines.push({ heir: 'paternalGrandfather', share: make(1, 6), dalil: D_GF });
    grandfatherIsAsaba = !sonLine;
  }

  // ── grandmothers — share 1/6 between however many are not excluded ──
  const gmActive: HeirType[] = [];
  if (isPresent(h, 'paternalGrandmother') && !paternalGrandmotherExcluded(h)) gmActive.push('paternalGrandmother');
  if (isPresent(h, 'maternalGrandmother') && !maternalGrandmotherExcluded(h)) gmActive.push('maternalGrandmother');
  for (const gm of gmActive) {
    lines.push({ heir: gm, share: make(1, 6 * gmActive.length), dalil: D_GM });
  }

  // ── children ──
  const sonN = countOf(h, 'son');
  const daughterN = countOf(h, 'daughter');
  const daughterDeferred = sonN > 0;
  if (!daughterDeferred && daughterN > 0) {
    lines.push({ heir: 'daughter', share: daughterN === 1 ? make(1, 2) : make(2, 3), dalil: D_CHILD });
  }

  // ── son's-line grandchildren (only relevant if no son) ──
  const grandsonN = sonN > 0 ? 0 : countOf(h, 'grandson');
  const granddaughterN = sonN > 0 ? 0 : countOf(h, 'granddaughter');
  const granddaughterDeferred = grandsonN > 0;
  if (sonN > 0 && countOf(h, 'grandson') + countOf(h, 'granddaughter') > 0) {
    excludedButPresent.push('grandson', 'granddaughter');
  } else if (!granddaughterDeferred && granddaughterN > 0) {
    if (daughterN === 0) {
      lines.push({ heir: 'granddaughter', share: granddaughterN === 1 ? make(1, 2) : make(2, 3), dalil: D_GCHILD });
    } else if (daughterN === 1) {
      lines.push({ heir: 'granddaughter', share: make(1, 6), dalil: D_GCHILD });
    } else {
      excludedButPresent.push('granddaughter'); // 2+ daughters already complete 2/3
    }
  }

  // ── sibling lines ──
  const paternalLineOut = paternalLineSiblingExcluded(h);
  const fullBrotherN = paternalLineOut ? 0 : countOf(h, 'fullBrother');
  const fullSisterN = paternalLineOut ? 0 : countOf(h, 'fullSister');
  const fullSisterDeferred = fullBrotherN > 0;
  // "عصبہ مع الغیر" — with no father and no full brother, a full/paternal
  // sister standing beside a daughter/granddaughter is residuary (asaba.ts),
  // not fixed-share; her fixed line here would double-count.
  const hasDaughterLine = countOf(h, 'daughter') > 0 || countOf(h, 'granddaughter') > 0;
  const sisterAsabaWithDaughters = !isPresent(h, 'father') && hasDaughterLine;
  if (paternalLineOut) {
    for (const t of ['fullBrother', 'fullSister', 'paternalBrother', 'paternalSister'] as HeirType[]) {
      if (isPresent(h, t)) excludedButPresent.push(t);
    }
  } else {
    const fullSisterAsAsaba = fullBrotherN === 0 && fullSisterN > 0 && sisterAsabaWithDaughters;
    if (!fullSisterDeferred && !fullSisterAsAsaba && fullSisterN > 0) {
      lines.push({ heir: 'fullSister', share: fullSisterN === 1 ? make(1, 2) : make(2, 3), dalil: D_SIB_FULL });
    }
    // Paternal siblings: a real full brother excludes them outright (he alone
    // absorbs all residue as the stronger same-rank residuary).
    const paternalOut = fullBrotherN > 0;
    const paternalBrotherN = paternalOut ? 0 : countOf(h, 'paternalBrother');
    const paternalSisterN = paternalOut ? 0 : countOf(h, 'paternalSister');
    const paternalSisterDeferred = paternalBrotherN > 0;
    const paternalSisterAsAsaba =
      !paternalOut && paternalBrotherN === 0 && paternalSisterN > 0 && fullSisterN === 0 && sisterAsabaWithDaughters;
    if (paternalOut) {
      for (const t of ['paternalBrother', 'paternalSister'] as HeirType[]) if (isPresent(h, t)) excludedButPresent.push(t);
    } else if (!paternalSisterDeferred && !paternalSisterAsAsaba && paternalSisterN > 0) {
      if (fullSisterN === 0) {
        lines.push({ heir: 'paternalSister', share: paternalSisterN === 1 ? make(1, 2) : make(2, 3), dalil: D_SIB_PAT });
      } else if (fullSisterN === 1) {
        lines.push({ heir: 'paternalSister', share: make(1, 6), dalil: D_SIB_PAT });
      } else {
        excludedButPresent.push('paternalSister'); // 2+ full sisters already complete 2/3
      }
    }
  }

  // ── maternal (uterine) siblings — always fixed, never asaba, 1:1 regardless of gender ──
  if (!maternalSiblingExcluded(h)) {
    const n = countOf(h, 'maternalBrother') + countOf(h, 'maternalSister');
    if (n === 1) {
      const heir: HeirType = isPresent(h, 'maternalBrother') ? 'maternalBrother' : 'maternalSister';
      lines.push({ heir, share: make(1, 6), dalil: D_SIB_MAT });
    } else if (n >= 2) {
      const each = make(1, 3 * n);
      if (isPresent(h, 'maternalBrother')) lines.push({ heir: 'maternalBrother', share: make(each.n * countOf(h, 'maternalBrother'), each.d), dalil: D_SIB_MAT });
      if (isPresent(h, 'maternalSister')) lines.push({ heir: 'maternalSister', share: make(each.n * countOf(h, 'maternalSister'), each.d), dalil: D_SIB_MAT });
    }
  } else {
    for (const t of ['maternalBrother', 'maternalSister'] as HeirType[]) if (isPresent(h, t)) excludedButPresent.push(t);
  }

  return {
    lines: lines.filter((l) => l.share.n !== 0),
    fatherIsAsaba,
    grandfatherIsAsaba,
    excludedButPresent,
  };
}

export { ZERO };
