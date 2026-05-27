/**
 * Shared plan/tier definitions used by Pricing and PendingApproval pages.
 * Feature labels use i18n key templates — call buildFeatures(t) to get translated labels.
 */

export type PaidTier = "basic" | "pro" | "ultra";

export interface PlanFeatureTemplate {
  /** e.g. "30 min" — the quantity prefix (already translated if numeric) */
  qty: string;
  /** i18n key for the feature name, e.g. "pricing.stt" */
  nameKey: string;
  /** Optional second i18n key appended after the name, e.g. "pricing.ocr" */
  suffixKey?: string;
  included: boolean;
  /** When true, shown with a "coming soon" badge instead of strikethrough */
  comingSoon?: boolean;
}

export interface PlanTier {
  id: PaidTier;
  nameKey: string;
  /** Manual PKR price (shown alongside card USD on pricing UI) */
  price: string;
  /** Card price in USD via SafePay — instant activation */
  cardPrice: string;
  priceAmountKey: string;
  popular: boolean;
  comingSoon: boolean;
  featureTemplates: PlanFeatureTemplate[];
}

export const PLAN_TIERS: PlanTier[] = [
  {
    id: "basic",
    nameKey: "settings.basic",
    price: "1,400 PKR",
    cardPrice: "$5",
    priceAmountKey: "pricing.payment_amount_basic",
    popular: false,
    comingSoon: false,
    featureTemplates: [
      { qty: "30 min",    nameKey: "pricing.stt",      included: true },
      { qty: "30",        nameKey: "pricing.pages",     suffixKey: "pricing.ocr", included: true },
      { qty: "20",        nameKey: "pricing.queries",   suffixKey: "pricing.research", included: true },
      { qty: "",          nameKey: "pricing.tts",       included: false },
      { qty: "",          nameKey: "pricing.voice_clone", included: false },
    ],
  },
  {
    id: "pro",
    nameKey: "settings.pro",
    price: "5,400 PKR",
    cardPrice: "$19",
    priceAmountKey: "pricing.payment_amount_pro",
    popular: true,
    comingSoon: false,
    featureTemplates: [
      { qty: "5 hrs",     nameKey: "pricing.stt",      included: true },
      { qty: "300",       nameKey: "pricing.pages",     suffixKey: "pricing.ocr", included: true },
      { qty: "200",       nameKey: "pricing.queries",   suffixKey: "pricing.research", included: true },
      { qty: "",          nameKey: "pricing.tts",       included: false },
      { qty: "",          nameKey: "pricing.voice_clone", included: false },
    ],
  },
  {
    id: "ultra",
    nameKey: "settings.ultra",
    price: "8,400 PKR",
    cardPrice: "$29",
    priceAmountKey: "pricing.payment_amount_ultra",
    popular: false,
    comingSoon: false,
    featureTemplates: [
      { qty: "10 hrs",    nameKey: "pricing.stt",      included: true },
      { qty: "2,000",     nameKey: "pricing.pages",     suffixKey: "pricing.ocr", included: true },
      { qty: "500",       nameKey: "pricing.queries",   suffixKey: "pricing.research", included: true },
      { qty: "",          nameKey: "pricing.tts",       included: false, comingSoon: true },
      { qty: "",          nameKey: "pricing.voice_clone", included: false, comingSoon: true },
    ],
  },
];

/** Build translated feature labels from templates. */
export function buildFeatures(
  templates: PlanFeatureTemplate[],
  t: (k: string) => string,
): { label: string; included: boolean; comingSoon?: boolean }[] {
  return templates.map((f) => {
    const parts = [f.qty, t(f.nameKey)].filter(Boolean);
    if (f.suffixKey) parts.push(t(f.suffixKey));
    return { label: parts.join(" "), included: f.included, comingSoon: f.comingSoon };
  });
}
