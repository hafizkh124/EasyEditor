/**
 * M12 Phase B — ذوو الأرحام (distant kindred).
 *
 * Out of scope for THIS engine's closed heir list (`heirs.ts`'s 24 types are
 * exactly the ilmsummit.org gold-set categories, and every one of them is
 * either a دهي الفرض (fixed-share heir) or an agnatic (male-line) عصبة —
 * daughter's children, a maternal uncle, etc. are true dhawil-arḥām and are
 * simply not representable as input here.
 *
 * `hasNoFardOrAsaba` exists so `calculator.ts` can detect the one case this
 * DOES matter: every fixed-share and asaba slot came back empty (an estate
 * with, say, only a maternal grandmother who turned out to be excluded — a
 * degenerate input). In the closed heir set that can only happen when the
 * caller passed an empty or fully-excluded heir list; the engine reports it
 * plainly rather than guessing at an escheat rule (بيت المال) it was never
 * asked to model.
 *
 * Pure.
 */
export function noEligibleHeirNote(): string {
  return 'دیے گئے ورثاء میں سے کسی کو حصہ نہیں ملتا — یا تو کوئی وارث درج نہیں ہوا، یا ' +
    'تمام درج شدہ ورثاء کسی قریب تر وارث کی وجہ سے محجوب ہیں۔ دور کے رحمی رشتہ داروں ' +
    '(ذوی الارحام) کا حساب اس انجن کے دائرہ کار میں شامل نہیں — مفتی سے رجوع کریں۔';
}
