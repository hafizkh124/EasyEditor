/**
 * M12 Phase A — فدیہ / کفارۃ الیمین / صدقۃ الفطر.
 *
 * Ported from `islamic-calculator` `store/modules/{fidya,kaffara,sadqaFitr}.ts`
 * (the arithmetic only; Zustand `StateCreator` dropped).
 *
 * Quantities follow the لجنۃ العلماء "مبنی بر احتیاط" reckoning:
 * - Sadaqat al-Fiṭr : 1 ṣāʿ = 2.5 kg wheat per person (Bukhārī 1503, 1506;
 *   ijmāʿ per al-Ijmāʿ li-Ibn al-Mundhir).
 * - Fidya           : half a ṣāʿ = 1.25 kg wheat per missed fast (Qur'an 2:184).
 * - Kaffārat al-yamīn: feed/clothe 10 مساکين per broken oath (Qur'an 5:89).
 *
 * Pure.
 */
import type { CharityResult, FidyaInput, KaffaraOathInput, SadqaFitrInput } from './types.js';

/** ṣāʿ, in kg — the احتیاط figure. */
export const SAA_KG = 2.5;
/** نصف صاع. */
export const HALF_SAA_KG = 1.25;
/** Standard miskīn count for kaffārat al-yamīn. */
export const KAFFARA_YAMIN_PEOPLE = 10;

const round = (v: number): number => (Number.isFinite(v) ? Math.round(v) : 0);
const n = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);

export function sadqaFitr(input: SadqaFitrInput): CharityResult {
  const members = Math.max(0, Math.floor(n(input.familyMembers)));
  const perPerson = round(n(input.wheatPricePerKg) * SAA_KG);
  return {
    amount: round(members * perPerson),
    currency: input.currency,
    breakdown: `${members} افراد × ${perPerson} (فی کس، ۱ صاع = ${SAA_KG} کلو گندم)`,
    dalil: 'صدقۃ الفطر ہر فرد پر ایک صاع (بخاري: ۱۵۰۳)؛ لجنۃ العلماء (فتویٰ ۲۹۰) کے مطابق قیمت بھی ادا کی جا سکتی ہے۔',
    note: 'یہ آپ کی دی گئی گندم کی قیمت پر حساب ہے — مقامی سرکاری فطرانہ اعلان سے موازنہ کر لیجیے۔',
  };
}

export function fidya(input: FidyaInput): CharityResult {
  const fasts = Math.max(0, Math.floor(n(input.missedFasts)));
  const perFast = round(n(input.wheatPricePerKg) * HALF_SAA_KG);
  return {
    amount: round(fasts * perFast),
    currency: input.currency,
    breakdown: `${fasts} روزے × ${perFast} (فی روزہ، نصف صاع = ${HALF_SAA_KG} کلو گندم)`,
    dalil: 'جو روزہ رکھنے سے مستقل عاجز ہو اُس پر ہر روزے کے بدلے ایک مسکین کا کھانا (البقرہ: ۱۸۴)؛ مقدار نصف صاع۔',
    note: 'یہ عاجزِ دائمی (بڑھاپا/مرضِ لاعلاج) کے لیے ہے — قضا کی طاقت رکھنے والے پر روزے کی قضا لازم ہے، فدیہ نہیں۔',
  };
}

export function kaffaraOath(input: KaffaraOathInput): CharityResult {
  const oaths = Math.max(0, Math.floor(n(input.brokenOaths)));
  const perPerson = round(n(input.costPerPerson));
  const perOath = KAFFARA_YAMIN_PEOPLE * perPerson;
  return {
    amount: round(oaths * perOath),
    currency: input.currency,
    breakdown: `${oaths} قسم × (${KAFFARA_YAMIN_PEOPLE} مساکین × ${perPerson}) [${input.option === 'clothing' ? 'کپڑے' : 'کھانا'}]`,
    dalil: 'کفارۃ الیمین: دس مسکینوں کو کھانا یا کپڑے، یا ایک غلام آزاد کرنا؛ اِن پر قادر نہ ہو تو تین دن روزے (المائدہ: ۸۹)۔',
    note: 'یہ صرف قسم توڑنے کا کفارہ ہے۔ روزہ توڑنے، ظہار یا قتل کا کفارہ مختلف ہے۔ روزے کا اختیار موجود ہے (مالی قیمت صفر)۔',
  };
}
