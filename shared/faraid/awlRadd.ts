/**
 * M12 Phase B — عول اور رد.
 *
 * عول (awl): the fixed shares sum to MORE than the whole estate — every
 * fixed-share heir is scaled down by the same factor (`asl` grows).
 * رد (radd): the fixed shares sum to LESS than the whole and there is no
 * residuary (`asaba`) heir to take what's left — the residue returns to the
 * fixed-share heirs proportionally, EXCLUDING a spouse (Jumhūr: a husband or
 * wife never receives radd — see `RULES.md`).
 *
 * Pure.
 */
import { add, isZero, mul, make, sub, type Rational, ZERO } from './rational.js';
import type { HeirType } from './heirs.js';

export interface Line { heir: HeirType; share: Rational }

/** Sum of a set of shares. */
export function sumShares(lines: Array<{ share: Rational }>): Rational {
  return lines.reduce((s, l) => add(s, l.share), ZERO);
}

/** عول — scale every line by `1 / total` so they sum to exactly 1. */
export function applyAwl(lines: Line[]): Line[] {
  const total = sumShares(lines);
  if (isZero(total)) return lines;
  return lines.map((l) => ({ heir: l.heir, share: mul(l.share, make(total.d, total.n)) }));
}

/**
 * رد — split `residue` among `lines` in proportion to their existing share,
 * except spouse heirs (husband/wife), who keep exactly what they were given.
 * Returns the FULL updated line set (spouse lines unchanged, others topped up).
 */
export function applyRadd(lines: Line[], residue: Rational): Line[] {
  if (isZero(residue)) return lines;
  const spouseTypes: HeirType[] = ['husband', 'wife'];
  const eligible = lines.filter((l) => !spouseTypes.includes(l.heir));
  const eligibleTotal = sumShares(eligible);
  if (isZero(eligibleTotal)) return lines; // nothing to redistribute onto (radd is moot)

  return lines.map((l) => {
    if (spouseTypes.includes(l.heir)) return l;
    const proportion = mul(l.share, make(eligibleTotal.d, eligibleTotal.n));
    const extra = mul(residue, proportion);
    return { heir: l.heir, share: add(l.share, extra) };
  });
}

export { sub, ZERO };
