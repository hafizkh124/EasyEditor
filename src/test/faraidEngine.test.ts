/**
 * M12 Phase B — `calculateFaraid()` contract tests: invariants that must hold
 * for ANY input, independent of the gold-set fixtures (`faraidGoldSet.test.ts`
 * pins the fiqh outcomes; this file pins the shape of the result).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { calculateFaraid } from '~shared/faraid/calculator';
import { parseFraction, add, compare, ONE, ZERO } from '~shared/faraid/rational';
import type { HeirCounts } from '~shared/faraid/heirs';

function totalOf(heirs: HeirCounts) {
  const r = calculateFaraid({ heirs });
  return r.lines.reduce((s, l) => add(s, parseFraction(l.fraction)), ZERO);
}

describe('calculateFaraid — contract', () => {
  it('always returns a result with a non-fatwā note, even for an empty heir set', () => {
    const r = calculateFaraid({ heirs: {} });
    expect(r.note).toBeTruthy();
    expect(r.note).toMatch(/فتویٰ نہیں/);
    expect(r.lines).toEqual([]);
  });

  it('an excluded heir never appears in the result, even when another heir does', () => {
    // A maternal grandmother is excluded outright by the mother's presence;
    // the mother herself still inherits (fixed 1/3, topped up by radd to 1/1
    // since there is no asaba here either).
    const r = calculateFaraid({ heirs: { mother: 1, maternalGrandmother: 1 } });
    expect(r.lines.some((l) => l.heir === 'mother')).toBe(true);
    expect(r.lines.some((l) => l.heir === 'maternalGrandmother')).toBe(false);
    expect(r.raddApplied).toBe(true);
  });

  it('every line carries a dalil and a RULES.md ruleRef', () => {
    const r = calculateFaraid({ heirs: { wife: 1, son: 2, daughter: 1 } });
    expect(r.lines.length).toBeGreaterThan(0);
    for (const l of r.lines) {
      expect(l.dalil).toBeTruthy();
      expect(l.ruleRef).toContain('RULES.md');
    }
  });

  it('a fixed share + the asaba residue always sums to exactly 1', () => {
    // husband 1/4 (son is a descendant) + son takes the 3/4 residue as asaba.
    const heirs: HeirCounts = { husband: 1, son: 1 };
    expect(compare(totalOf(heirs), ONE)).toBe(0);
  });

  it('awl scales every fixed share down so the total is exactly 1', () => {
    // husband 1/2 + 2 daughters 2/3 + father 1/6 + mother 1/6 -> 3/2 before awl.
    const r = calculateFaraid({
      heirs: { husband: 1, daughter: 2, father: 1, mother: 1 },
    });
    expect(r.awlApplied).toBe(true);
    const total = r.lines.reduce((s, l) => add(s, parseFraction(l.fraction)), ZERO);
    expect(compare(total, ONE)).toBe(0);
  });

  it('radd redistributes the shortfall to fixed heirs, excluding a spouse', () => {
    // wife alone: 1/4 fixed, no asaba exists (no other heir at all) -> radd
    // gives the rest back to... only the wife exists, so nothing else to
    // redistribute onto; use mother + maternalGrandmother-style pair instead:
    // mother alone (no father, no descendant, no siblings) -> mother 1/3
    // fixed, no asaba -> radd tops her up to the whole estate.
    const r = calculateFaraid({ heirs: { mother: 1 } });
    expect(r.raddApplied).toBe(true);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].fraction).toBe('1/1');
  });

  it('radd never tops up a spouse', () => {
    const r = calculateFaraid({ heirs: { wife: 1, mother: 1 } });
    // wife 1/4 + mother 1/3 (siblingCount<2, no descendant) = 7/12 < 1 -> radd,
    // but no asaba exists either, so mother alone absorbs the rest; wife stays 1/4.
    expect(r.raddApplied).toBe(true);
    const wife = r.lines.find((l) => l.heir === 'wife');
    expect(wife?.fraction).toBe('1/4');
  });

  it('the asl is a positive integer LCM of the final denominators', () => {
    const r = calculateFaraid({ heirs: { wife: 1, son: 2, daughter: 1 } });
    expect(Number.isInteger(r.asl)).toBe(true);
    expect(r.asl).toBeGreaterThan(0);
    for (const l of r.lines) {
      const f = parseFraction(l.fraction);
      expect(r.asl % f.d).toBe(0);
    }
  });

  it('computes a money amount per line when estateValue is given, and passes currency through', () => {
    const r = calculateFaraid({ heirs: { wife: 1, son: 1 }, estateValue: 800_000, currency: 'PKR' });
    expect(r.currency).toBe('PKR');
    const wife = r.lines.find((l) => l.heir === 'wife')!;
    expect(wife.amount).toBe(100_000); // 1/8 of 800,000
    const son = r.lines.find((l) => l.heir === 'son')!;
    expect(son.amount).toBe(700_000);
  });

  it('perPerson is only set when count > 1, and splits the type total evenly', () => {
    const r = calculateFaraid({ heirs: { husband: 1, mother: 1, maternalBrother: 2 } });
    const maternalBrother = r.lines.find((l) => l.heir === 'maternalBrother')!;
    expect(maternalBrother.perPerson).toBeDefined();
    const total = parseFraction(maternalBrother.fraction);
    const per = parseFraction(maternalBrother.perPerson!);
    expect(compare(add(per, per), total)).toBe(0);

    const r2 = calculateFaraid({ heirs: { wife: 1, son: 1 } });
    const son = r2.lines.find((l) => l.heir === 'son')!;
    expect(son.perPerson).toBeUndefined();
  });
});
