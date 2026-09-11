/**
 * M12 Phase B — the fara'id orchestrator.
 *
 * Order: العمریتان override → fixed shares (`shares.ts`) → الجد مع الإخوة
 * override (if it applies) → ordinary عصبة (`asaba.ts`) → عول / رد
 * (`awlRadd.ts`). `asl` (اصل المسئلہ) is the LCM of every line's denominator
 * after all of the above.
 *
 * Every result carries a mandatory `note` (a computation, not a fatwā) and
 * every line its `dalil` + `ruleRef`. The model never runs this arithmetic
 * (ADR-0048).
 *
 * Pure.
 */
import { add, compare, isZero, lcmOfDenominators, make, mul, sub, ZERO, type Rational } from './rational.js';
import {
  countOf, isPresent, HEIR_LABEL_UR, type HeirCounts, type HeirType,
} from './heirs.js';
import { computeFixedShares } from './shares.js';
import { computeAsaba } from './asaba.js';
import { umariyyatan, musharaka, grandfatherWithSiblings } from './specialCases.js';
import { applyAwl, applyRadd, sumShares } from './awlRadd.js';
import { paternalGrandfatherExcluded, paternalLineSiblingExcluded } from './hajb.js';
import { noEligibleHeirNote } from './dhawilArham.js';

export interface FaraidInput {
  heirs: HeirCounts;
  /** Total estate value, for a money breakdown alongside the fractions. Optional — the fractions stand on their own. */
  estateValue?: number;
  currency?: string;
}

export interface FaraidLine {
  heir: HeirType;
  label: string;
  count: number;
  /** The TOTAL fraction of the estate this heir type receives (all individuals of that type combined). */
  fraction: string;
  /** Per-individual fraction, when count > 1. */
  perPerson?: string;
  amount?: number;
  dalil: string;
  ruleRef: string;
}

export interface FaraidResult {
  asl: number;
  awlApplied: boolean;
  raddApplied: boolean;
  specialCase: 'umariyyatan' | 'musharaka' | 'grandfather-with-siblings' | null;
  lines: FaraidLine[];
  currency?: string;
  note: string;
}

const NON_FATWA_NOTE =
  'یہ آپ کے دیے گئے ورثاء پر ایک شرعی حساب ہے — فتویٰ نہیں۔ ' +
  'ورثاء کی درست شناخت اور نسبت کی تصدیق کسی مستند مفتی سے کرا لیجیے۔';

interface WorkingLine { heir: HeirType; share: Rational; dalil: string; ruleRef: string }

export function calculateFaraid(input: FaraidInput): FaraidResult {
  const h = input.heirs;

  const um = umariyyatan(h);
  const mush = um ? null : musharaka(h);
  let lines: WorkingLine[];
  let specialCase: FaraidResult['specialCase'] = null;
  let raddApplied = false;

  if (um) {
    specialCase = 'umariyyatan';
    lines = um.map((l) => ({ ...l, ruleRef: 'RULES.md#umariyyatan' }));
  } else if (mush) {
    specialCase = 'musharaka';
    lines = mush.map((l) => ({ ...l, ruleRef: 'RULES.md#musharaka' }));
  } else {
    const fixed = computeFixedShares(h);
    lines = fixed.lines.map((l) => ({ heir: l.heir, share: l.share, dalil: l.dalil, ruleRef: 'RULES.md#fixed-shares' }));

    const siblingTierPresent =
      !paternalLineSiblingExcluded(h) &&
      (countOf(h, 'fullBrother') > 0 || countOf(h, 'fullSister') > 0 ||
        countOf(h, 'paternalBrother') > 0 || countOf(h, 'paternalSister') > 0);
    const grandfatherActive = isPresent(h, 'paternalGrandfather') && !paternalGrandfatherExcluded(h);

    if (grandfatherActive && siblingTierPresent) {
      specialCase = 'grandfather-with-siblings';
      const tierIsFull = countOf(h, 'fullBrother') > 0 || countOf(h, 'fullSister') > 0;
      const brotherType: HeirType = tierIsFull ? 'fullBrother' : 'paternalBrother';
      const sisterType: HeirType = tierIsFull ? 'fullSister' : 'paternalSister';
      const brotherN = countOf(h, brotherType);
      const sisterN = countOf(h, sisterType);
      const gfBaseline = lines.find((l) => l.heir === 'paternalGrandfather')?.share ?? ZERO;

      if (brotherN > 0) {
        // A real brother is asaba: he would take 100% of whatever's left after
        // every OTHER fixed heir (incl. grandfather's own baseline). When that
        // residue is genuinely positive, grandfather negotiates the BEST of
        // 1/6-flat / muqāsama / ⅓-of-residue over it (Jumhūr). When it is
        // zero or negative (an 'awl scenario already), there is nothing to
        // negotiate — grandfather keeps only his baseline and the normal
        // 'awl below scales everyone, brother included, uniformly.
        const otherFixedTotal = sumShares(lines.filter((l) => l.heir !== 'paternalGrandfather'));
        const trueResidue = sub(make(1, 1), add(otherFixedTotal, gfBaseline));
        if (compare(trueResidue, ZERO) > 0) {
          const siblingWeights: Array<{ heir: HeirType; weight: number }> = [{ heir: brotherType, weight: 2 * brotherN }];
          if (sisterN > 0) siblingWeights.push({ heir: sisterType, weight: sisterN });
          const gfLines = grandfatherWithSiblings(h, trueResidue, siblingWeights);
          if (gfLines) {
            lines = lines.filter((l) => l.heir !== 'paternalGrandfather');
            for (const l of gfLines) {
              const extra = l.heir === 'paternalGrandfather' ? add(gfBaseline, l.share) : l.share;
              lines.push({ ...l, share: extra, ruleRef: 'RULES.md#grandfather-with-siblings' });
            }
          }
        }
        // trueResidue <= 0: leave the existing fixed lines (gf's baseline, if
        // any) exactly as they are; the brother has no fixed line to touch.
      } else if (sisterN > 0) {
        // No brother — only a sister of that tier. She already has her own
        // fixed line (½ / ⅔ / the completing ⅙). If she and grandfather's
        // baseline together do not fit the remaining room, they are pooled
        // and PRE-split 2:1 (grandfather:sister) so that the uniform 'awl
        // scaling below preserves that ratio (Jumhūr, matching the gold-set's
        // "grandfather & sister share the 'awl-reduced amount 2:1" pattern).
        const sisterNaive = lines.find((l) => l.heir === sisterType)?.share ?? ZERO;
        const otherFixedTotal = sumShares(lines.filter((l) => l.heir !== 'paternalGrandfather' && l.heir !== sisterType));
        const roomForPair = sub(make(1, 1), otherFixedTotal);
        // Unlike the brother branch, grandfather's seed here is a flat 1/6 even
        // with no descendant (matching the gold-set: he is always given that
        // nominal attempt before pooling with a sister — see RULES.md).
        const gfSeedForPooling = isZero(gfBaseline) ? make(1, 6) : gfBaseline;
        const combinedNaive = add(gfSeedForPooling, sisterNaive);
        if (compare(combinedNaive, roomForPair) > 0) {
          lines = lines.filter((l) => l.heir !== 'paternalGrandfather' && l.heir !== sisterType);
          lines.push({ heir: 'paternalGrandfather', share: mul(combinedNaive, make(2, 3)), dalil: 'دادا بہن کے ساتھ، مشترکہ حصے میں ۲/۳ (۲:۱ کی نسبت)۔', ruleRef: 'RULES.md#grandfather-with-siblings' });
          lines.push({ heir: sisterType, share: mul(combinedNaive, make(1, 3)), dalil: 'بہن دادا کے ساتھ، مشترکہ حصے میں ۱/۳ (۲:۱ کی نسبت)۔', ruleRef: 'RULES.md#grandfather-with-siblings' });
        }
        // Otherwise there is room for both at their naive amounts — leave as is.
      }
    } else {
      const asaba = computeAsaba(h);
      if (asaba.shares.length > 0) {
        const fixedTotal = sumShares(lines);
        const residue = sub(make(1, 1), fixedTotal);
        if (compare(residue, ZERO) > 0) {
          const totalWeight = asaba.shares.reduce((s, a) => s + a.weight, 0);
          for (const a of asaba.shares) {
            const share = mul(residue, make(a.weight, totalWeight));
            lines.push({ heir: a.heir, share, dalil: a.dalil, ruleRef: asaba.ruleRef });
          }
        }
      }
    }
  }

  // Merge duplicate heir entries (e.g. father: 1/6 fixed + residue as asaba).
  const merged = new Map<HeirType, WorkingLine>();
  for (const l of lines) {
    const prev = merged.get(l.heir);
    merged.set(l.heir, prev ? { ...prev, share: add(prev.share, l.share) } : l);
  }
  let finalLines = [...merged.values()].filter((l) => !isZero(l.share));

  // عول / رد
  const total = sumShares(finalLines);
  let awlApplied = false;
  if (compare(total, make(1, 1)) > 0) {
    awlApplied = true;
    finalLines = applyAwl(finalLines).map((l) => ({ ...l, dalil: merged.get(l.heir)!.dalil, ruleRef: merged.get(l.heir)!.ruleRef }));
  } else if (compare(total, make(1, 1)) < 0 && specialCase === null) {
    // Radd only applies when there was no residuary heir to soak up the rest
    // (an asaba result already consumes exactly the residue, by construction;
    // and every special-case branch above is excluded from this leg entirely).
    const hadAsaba = computeAsaba(h).shares.length > 0;
    if (!hadAsaba && finalLines.length > 0) {
      raddApplied = true;
      const residue = sub(make(1, 1), total);
      finalLines = applyRadd(finalLines, residue).map((l) => ({ ...l, dalil: merged.get(l.heir)!.dalil, ruleRef: merged.get(l.heir)!.ruleRef }));
    }
  }

  const asl = finalLines.length > 0 ? lcmOfDenominators(finalLines.map((l) => l.share)) : 1;

  const result: FaraidLine[] = finalLines.map((l) => {
    const count = Math.max(1, countOf(h, l.heir));
    const per = count > 1 ? mul(l.share, make(1, count)) : l.share;
    return {
      heir: l.heir,
      label: HEIR_LABEL_UR[l.heir],
      count,
      fraction: `${l.share.n}/${l.share.d}`,
      perPerson: count > 1 ? `${per.n}/${per.d}` : undefined,
      amount: input.estateValue ? round((l.share.n / l.share.d) * input.estateValue) : undefined,
      dalil: l.dalil,
      ruleRef: l.ruleRef,
    };
  });

  return {
    asl,
    awlApplied,
    raddApplied,
    specialCase,
    lines: result,
    currency: input.currency,
    note: result.length > 0 ? NON_FATWA_NOTE : `${NON_FATWA_NOTE} ${noEligibleHeirNote()}`,
  };
}

function round(v: number): number {
  return Number.isFinite(v) ? Math.round((v + Number.EPSILON) * 100) / 100 : 0;
}
