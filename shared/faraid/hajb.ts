/**
 * M12 Phase B — حجب الحرمان (total exclusion).
 *
 * Predicates only — WHO is excluded by WHOM, before any share is computed.
 * The asaba priority chain (`asaba.ts`) handles the collateral-line exclusions
 * (full brother excludes paternal brother, etc.) structurally, by construction
 * of the ordered chain; this file covers the direct-line exclusions that chain
 * does not: grandparents excluded by nearer parents, and any collateral
 * (sibling / nephew / uncle / cousin) excluded by a closer direct heir.
 *
 * Jumhūr (the view this engine follows, matching ilmsummit.org): see
 * `shared/faraid/RULES.md` §Hajb.
 *
 * Pure.
 */
import { hasAnySon, isPresent, type HeirCounts } from './heirs.js';

export function paternalGrandfatherExcluded(h: HeirCounts): boolean {
  return isPresent(h, 'father');
}

export function paternalGrandmotherExcluded(h: HeirCounts): boolean {
  // Excluded by her own son (the father) or by the mother.
  return isPresent(h, 'father') || isPresent(h, 'mother');
}

export function maternalGrandmotherExcluded(h: HeirCounts): boolean {
  return isPresent(h, 'mother');
}

export function grandchildrenExcluded(h: HeirCounts): boolean {
  // A living son stands closer than his own children.
  return isPresent(h, 'son');
}

/**
 * Full/paternal siblings: excluded by father or any male descendant.
 * A paternal GRANDFATHER, unlike the father, does NOT exclude them under the
 * Jumhūr view this engine follows — he co-shares with them instead
 * (`specialCases.ts` `grandfatherWithSiblings`).
 */
export function paternalLineSiblingExcluded(h: HeirCounts): boolean {
  if (isPresent(h, 'father')) return true;
  return hasAnySon(h);
}

/**
 * Maternal (uterine) siblings: excluded by a MALE descendant (son/grandson),
 * by father, or by the grandfather — matching ilmsummit.org's gold-set (a
 * daughter alone, with no son, does not exclude them; several classical
 * summaries teach the wider "any child" reading, but this engine matches the
 * Jumhūr-as-applied convention it is validated against — see `RULES.md`).
 */
export function maternalSiblingExcluded(h: HeirCounts): boolean {
  if (hasAnySon(h)) return true;
  if (isPresent(h, 'father')) return true;
  if (isPresent(h, 'paternalGrandfather') && !paternalGrandfatherExcluded(h)) return true;
  return false;
}
