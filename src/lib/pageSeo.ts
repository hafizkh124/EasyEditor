/**
 * Per-route title/description for pages whose copy is localised, shared by the
 * pages (via useSeo) and scripts/seo.mts (which writes them into the prerendered
 * <head> so crawlers and link-preview bots see the right language).
 */
export type Lang = "en" | "ur" | "ar";
export type L10n = Record<Lang, string>;

export const ABOUT_SEO: { title: L10n; description: L10n } = {
  title: {
    en: "About Al-Ulama Easy Editor — AI Workspace for Islamic Scholars",
    ur: "العلماء ایزی ایڈیٹر کا تعارف — علماء کے لیے AI ورک اسپیس",
    ar: "عن العلماء إيزي إيديتور — مساحة عمل ذكية للعلماء",
  },
  description: {
    en: "Al-Ulama Easy Editor helps scholars and students research, write and verify work grounded in Quran, Hadith and classical sources, in Urdu, Arabic and English, on the web and as a desktop app.",
    ur: "العلماء ایزی ایڈیٹر علماء اور طلبہ کو قرآن، حدیث اور کلاسیکی ماخذ پر مبنی تحقیق، تحریر اور تصدیق میں مدد دیتا ہے — اردو، عربی اور انگریزی میں، ویب اور ڈیسک ٹاپ ایپ پر۔",
    ar: "يعين العلماء إيزي إيديتور العلماء والطلاب على البحث والكتابة والتوثيق استنادًا إلى القرآن والحديث والمصادر الكلاسيكية، بالأردية والعربية والإنجليزية، على الويب وكتطبيق مكتبي.",
  },
};

export const SHAMELA_GUIDE_SEO: { title: L10n; description: L10n } = {
  title: {
    en: "Maktaba Shamila (المكتبة الشاملة) — Using It with AI for Citation-Checked Islamic Research",
    ur: "مکتبہ شاملہ — AI کے ساتھ حوالہ جانچ کر تحقیق کیسے کریں",
    ar: "المكتبة الشاملة: كيف توثّق بحثك الشرعي بمساعدة الذكاء الاصطناعي",
  },
  description: {
    en: "What Maktaba Shamila offers today, how its own AI search differs from a citation-checking workflow, and how to carry a passage from Shamela into Al-Ulama Easy Editor for Urdu translation, source checking and writing.",
    ur: "مکتبہ شاملہ آج کیا دیتی ہے، اس کی اپنی AI سرچ اور حوالہ جانچ کے عمل میں کیا فرق ہے، اور شاملہ کی عبارت کو العلماء ایزی ایڈیٹر میں اردو ترجمے، ماخذ کی جانچ اور تحریر کے لیے کیسے لائیں۔",
    ar: "ما تقدّمه المكتبة الشاملة اليوم، وكيف يختلف بحثها بالذكاء الاصطناعي عن سير عمل التوثيق، وكيف تنقل نصًا منها إلى العلماء إيزي إيديتور للترجمة إلى الأردية وفحص المصادر والكتابة.",
  },
};
