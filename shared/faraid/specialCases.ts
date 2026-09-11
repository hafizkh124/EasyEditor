/**
 * M12 Phase B — استثنائی مسائل: العمریتان (الغراویان) اور الجد مع الإخوة.
 *
 * Both are overrides applied BEFORE (or in place of) the plain fixed-share /
 * asaba computation in `calculator.ts`. Jumhūr view (see `RULES.md`).
 *
 * Pure.
 */
import { make, mul, sub, type Rational, ZERO } from './rational.js';
import { countOf, hasAnyDescendant, isPresent, type HeirCounts, type HeirType } from './heirs.js';
import { maternalSiblingExcluded, paternalGrandfatherExcluded, paternalLineSiblingExcluded } from './hajb.js';

export interface OverrideLine { heir: HeirType; share: Rational; dalil: string }

/**
 * العمریتان / الغراویان — spouse + father + mother, nothing else (no
 * descendant, fewer than two siblings). The mother's fixed share is 1/3 OF
 * THE REMAINDER after the spouse, not 1/3 of the whole estate; the father
 * takes the rest as residuary. (Jumhūr / Zayd b. Thābit's ruling — the widely
 * taught position; a minority, incl. some Ḥanafīs, give the mother a flat
 * 1/3. This engine follows Jumhūr, matching ilmsummit.org.)
 */
export function umariyyatan(h: HeirCounts): OverrideLine[] | null {
  const hasSpouse = isPresent(h, 'husband') || isPresent(h, 'wife');
  if (!hasSpouse || !isPresent(h, 'father') || !isPresent(h, 'mother')) return null;
  const onlyThree = (['son', 'daughter', 'grandson', 'granddaughter',
    'fullBrother', 'fullSister', 'paternalBrother', 'paternalSister', 'maternalBrother', 'maternalSister',
  ] as HeirType[]).every((t) => countOf(h, t) === 0);
  if (!onlyThree) return null;

  const spouseHeir: HeirType = isPresent(h, 'husband') ? 'husband' : 'wife';
  const spouseShare = spouseHeir === 'husband' ? make(1, 2) : make(1, 4);
  const remainder = sub(make(1, 1), spouseShare);
  const motherShare = mul(remainder, make(1, 3));
  const fatherShare = sub(remainder, motherShare);

  return [
    { heir: spouseHeir, share: spouseShare, dalil: 'زوج/زوجہ کا حصہ بلاتغیر (۴:۱۲)۔' },
    { heir: 'mother', share: motherShare, dalil: 'عمریتان: والدہ کو زوج کے حصے کے بعد باقی کا ۱/۳ (جمہور، زید بن ثابتؓ)۔' },
    { heir: 'father', share: fatherShare, dalil: 'عمریتان: باقی والد کو عصبۃً۔' },
  ];
}

/**
 * المشتركة (الحمارية) — a spouse + mother + 2-or-more maternal siblings + a
 * full BROTHER (with any full sister riding along in the same pool), no
 * father, no descendant. The full brother would otherwise get NOTHING (the
 * maternal siblings' 1/3 leaves him no residue as asaba) — the Jumhūr ruling
 * this engine follows (`ilmsummit.org`; attributed to ʿUthmān/Zayd, adopted
 * by the Mālikī/Ḥanbalī view) folds him into the maternal-siblings' pool: the
 * whole 1/3 is split EQUALLY per head across every maternal sibling AND every
 * full sibling present, regardless of sex. A full SISTER with no full
 * brother is NOT pooled this way — she already has her own guaranteed fixed
 * share and is not asaba, so she needs no rescuing; the plain fixed-share/
 * 'awl path applies instead. A paternal-only sibling (no full sibling at
 * all) is likewise never pooled. (A minority — some Ḥanafī texts — instead
 * give the full brother nothing; not this engine's position.)
 */
export function musharaka(h: HeirCounts): OverrideLine[] | null {
  const hasSpouse = isPresent(h, 'husband') || isPresent(h, 'wife');
  if (!hasSpouse || !isPresent(h, 'mother')) return null;
  if (hasAnyDescendant(h) || isPresent(h, 'father') || isPresent(h, 'paternalGrandfather')) return null;
  if (maternalSiblingExcluded(h)) return null;

  const maternalN = countOf(h, 'maternalBrother') + countOf(h, 'maternalSister');
  if (maternalN < 2) return null;
  if (paternalLineSiblingExcluded(h)) return null;

  // Musharaka exists to rescue a full BROTHER who would otherwise take
  // nothing as asaba (the maternal pool + spouse + mother already exhaust
  // the estate). A full SISTER already has her own guaranteed fixed share —
  // she is not asaba and needs no rescuing, so her presence alone (with no
  // full brother) does NOT trigger this pooling; the plain fixed-share/'awl
  // path handles that case correctly. A paternal-only sibling never triggers
  // it either (per the gold-set). When a full brother IS present, any full
  // sister rides along in the same pool (they are one "full sibling" tier).
  if (countOf(h, 'fullBrother') === 0) return null;
  const brotherOrSisterN = countOf(h, 'fullBrother') + countOf(h, 'fullSister');

  // Neither spouse has a descendant in this scenario: husband=1/2, wife=1/4.
  const spouseHeir: HeirType = isPresent(h, 'husband') ? 'husband' : 'wife';
  const spouseShare = spouseHeir === 'husband' ? make(1, 2) : make(1, 4);
  const motherShare = make(1, 6); // 2+ siblings of ANY kind reduce mother to 1/6.
  const pool = make(1, 3); // the maternal-siblings' own fixed share, shared per head with the joining tier.
  const heads = maternalN + brotherOrSisterN;
  const each = mul(pool, make(1, heads));

  const out: OverrideLine[] = [
    { heir: spouseHeir, share: spouseShare, dalil: 'زوج/زوجہ کا حصہ بلاتغیر۔' },
    { heir: 'mother', share: motherShare, dalil: 'دو یا زیادہ بھائی بہنوں کی موجودگی میں والدہ کا حصہ ۱/۶۔' },
  ];
  const maternalTypes: HeirType[] = ['maternalBrother', 'maternalSister'];
  const siblingTypes: HeirType[] = ['fullBrother', 'fullSister'];
  for (const t of [...maternalTypes, ...siblingTypes]) {
    const n = countOf(h, t);
    if (n > 0) out.push({ heir: t, share: mul(each, make(n, 1)), dalil: 'المشتركہ: اخیافی بھائی بہنوں کے ۱/۳ کے حصے میں فی کس برابر شرکت (جمہور)۔' });
  }
  return out;
}

/**
 * الجد مع الإخوة (paternal grandfather competing with full/paternal siblings,
 * father absent) — the grandfather takes the BEST of: (a) 1/6 of the whole
 * estate, (b) sharing the sibling tier's pool as if he were one more brother
 * (muqāsama), or (c) ⅓ of that pool. This is the Ḥanafī/Ḥanbalī position
 * (Jumhūr, "الجد كالأخ حتى ينقص عن الثلث"); the grandfather does NOT exclude
 * the siblings the way a father would.
 *
 * `poolShare` — what the sibling tier would have received (fixed 1/2 or 2/3,
 * or asaba residue) BEFORE the grandfather is folded in. Returns the
 * grandfather's line plus each sibling's reduced share, replacing the
 * caller's own entries for that tier.
 */
export function grandfatherWithSiblings(
  h: HeirCounts,
  poolShare: Rational,
  siblingWeights: Array<{ heir: HeirType; weight: number }>,
): OverrideLine[] | null {
  if (!isPresent(h, 'paternalGrandfather') || paternalGrandfatherExcluded(h)) return null;
  if (paternalLineSiblingExcluded(h)) return null;
  if (siblingWeights.length === 0) return null;

  const totalWeight = siblingWeights.reduce((s, w) => s + w.weight, 0) + 1; // grandfather = 1 unit
  const muqasama = mul(poolShare, make(1, totalWeight));
  const oneThird = mul(poolShare, make(1, 3));
  const oneSixthWhole = make(1, 6);

  let best = muqasama;
  if (oneThird.n * best.d > best.n * oneThird.d) best = oneThird;
  if (oneSixthWhole.n * best.d > best.n * oneSixthWhole.d) best = oneSixthWhole;
  // Never claim more than the whole pool.
  if (best.n * poolShare.d > poolShare.n * best.d) best = poolShare;

  const remaining = sub(poolShare, best);
  const out: OverrideLine[] = [{ heir: 'paternalGrandfather', share: best, dalil: 'دادا بھائیوں کے ساتھ: مقاسمہ، ۱/۳، یا ۱/۶ میں جو زیادہ ہو (جمہور)۔' }];
  for (const w of siblingWeights) {
    const share = totalWeight > 1 && remaining.n !== 0
      ? mul(remaining, make(w.weight, totalWeight - 1))
      : ZERO;
    if (share.n !== 0) out.push({ heir: w.heir, share, dalil: 'دادا کے ساتھ باقی، مرد:عورت ۲:۱ (۴:۱۱)۔' });
  }
  return out;
}
