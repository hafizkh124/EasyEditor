/**
 * M12 Phase A — the zakat orchestrator.
 *
 * Combines cash + metals + trade goods + investments + receivables + rental +
 * property-for-sale + vacant land, subtracts due debts, compares the net base
 * against the nisāb, and applies 2.5%.
 *
 * `netBase = max(0, Σ zakatable assets − Σ liabilities)` (from
 * `islamic-calculator` `store/zakatStore.ts:732`, with its safety cap).
 *
 * Pure. The model never runs this arithmetic (ADR-0048).
 */
import { ZAKAT_RATE } from './constants.js';
import { nisabThreshold } from './nisab.js';
import { computeMetalZakat } from './metals.js';
import type { ZakatInput, ZakatLine, ZakatResult } from './types.js';

const NON_FATWA_NOTE =
  'یہ آپ کے فراہم کردہ اعداد و شمار اور قیمتوں پر ایک شرعی حساب ہے — فتویٰ نہیں۔ ' +
  'قیمتیں اور نیتِ استعمال آپ نے دی ہیں؛ کسی مستند مفتی سے تصدیق کرا لیجیے۔';

const num = (v: number | undefined): number => (Number.isFinite(v) && (v as number) > 0 ? (v as number) : 0);

export function calculateZakat(input: ZakatInput): ZakatResult {
  const ruling = input.jewelleryRuling ?? 'personal-exempt';
  const hawlMet = Boolean(input.hawlMet);
  const lines: ZakatLine[] = [];

  // ── metals ──
  const metals = computeMetalZakat(
    input.gold,
    input.silver,
    input.nisab.goldPricePerGram,
    input.nisab.silverPricePerGram,
    hawlMet,
    ruling,
  );
  if (metals.goldValueTotal > 0) {
    lines.push({
      key: 'gold',
      label: 'سونا',
      value: round(metals.goldValueTotal),
      zakatable: round(metals.goldZakatable),
      dalil: ruling === 'hanafi-all'
        ? 'حنفی: ہر سونا زکوٰۃ کے تابع، بشمول زیرِ استعمال زیور۔'
        : 'زیرِ استعمال زیور (نیتِ استعمال) پر جمہور کے نزدیک زکوٰۃ نہیں۔',
      ruleRef: 'RULES.md#gold-silver',
    });
  }
  if (metals.silverValueTotal > 0) {
    lines.push({
      key: 'silver',
      label: 'چاندی',
      value: round(metals.silverValueTotal),
      zakatable: round(metals.silverZakatable),
      dalil: 'چاندی نقدین میں ہے؛ نصاب کو پہنچے تو ۲.۵٪۔',
      ruleRef: 'RULES.md#gold-silver',
    });
  }

  // ── straightforward cash-like assets ──
  const flat: Array<[keyof ZakatInput, string, string]> = [
    ['cash', 'نقد و بینک', 'نقدین — پورا حول پر زکوٰۃ کے تابع (حديث: "…فِي الرِّقَةِ رُبْعُ الْعُشْرِ")۔'],
    ['tradeGoods', 'مالِ تجارت', 'عروضِ تجارت پر بمطابق قیمتِ بازار زکوٰۃ ہے۔'],
    ['investments', 'سرمایہ کاری (قابلِ زکوٰۃ حصہ)', 'برائے فروخت شیئرز پوری قیمت پر؛ طویل مدتی کا قابلِ زکوٰۃ حصہ۔'],
    ['receivables', 'واجب الوصول قرض', 'قرضِ قوی (وصولی کی امید) پر زکوٰۃ ہے۔'],
    ['rentalIncomeNet', 'خالص کرایہ آمدنی', 'کرایہ کی خالص آمدنی نقدین میں شامل ہو کر زکوٰۃ کے تابع ہے۔'],
    ['propertyForSale', 'برائے فروخت جائیداد', 'برائے فروخت جائیداد عروضِ تجارت کے حکم میں ہے۔'],
    ['vacantLand', 'خالی زمین', 'غیر مستعمل، برائے نفع رکھی گئی زمین قابلِ زکوٰۃ ہے۔'],
  ];
  for (const [k, label, dalil] of flat) {
    const v = num(input[k] as number | undefined);
    if (v > 0) {
      lines.push({
        key: k as string,
        label,
        value: round(v),
        zakatable: round(hawlMet ? v : 0),
        dalil,
        ruleRef: 'RULES.md#zakatable-assets',
      });
    }
  }

  // ── liabilities ──
  const debtsDue = num(input.debtsDue);
  const longTermAnnual = num(input.longTermDebtAnnual);
  if (debtsDue > 0) {
    lines.push({
      key: 'debtsDue', label: 'واجب الادا قرض', value: round(debtsDue), zakatable: round(-debtsDue),
      dalil: 'فوری واجب الادا قرض قابلِ زکوٰۃ مال سے منہا ہوتا ہے۔', ruleRef: 'RULES.md#liabilities',
    });
  }
  if (longTermAnnual > 0) {
    lines.push({
      key: 'longTermDebtAnnual', label: 'طویل مدتی قرض (سالانہ قسط)', value: round(longTermAnnual), zakatable: round(-longTermAnnual),
      dalil: 'طویل مدتی قرض کی صرف سالانہ قسط منہا کی جاتی ہے، کل اصل نہیں۔', ruleRef: 'RULES.md#liabilities',
    });
  }

  const totalZakatableAssets = round(
    lines.filter((l) => l.zakatable > 0).reduce((s, l) => s + l.zakatable, 0),
  );
  const totalLiabilities = round(
    lines.filter((l) => l.zakatable < 0).reduce((s, l) => s - l.zakatable, 0),
  );
  const netZakatableBase = round(Math.max(0, totalZakatableAssets - totalLiabilities));

  const n = nisabThreshold(input.nisab);
  const nisabMet = netZakatableBase >= n.threshold && n.threshold > 0;
  const zakatDue = round(nisabMet ? netZakatableBase * ZAKAT_RATE : 0);

  return {
    currency: input.currency,
    hawlMet,
    jewelleryRuling: ruling,
    totalZakatableAssets,
    totalLiabilities,
    netZakatableBase,
    nisabThreshold: round(n.threshold),
    nisabStandardUsed: n.standardUsed,
    nisabMet,
    rate: ZAKAT_RATE,
    zakatDue,
    lines,
    note: NON_FATWA_NOTE,
  };
}

/** Round to 2 dp without floating-point cruft. */
function round(v: number): number {
  return Number.isFinite(v) ? Math.round((v + Number.EPSILON) * 100) / 100 : 0;
}
