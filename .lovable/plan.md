
## مقصد
پوری ایپ کو عربی (Modern Standard Arabic) میں ٹرانسلیٹ کرنا، اور تمام public پیجز (Landing, About, Pricing, FAQ, Legal pages) کو `/ar/...` prefix پر SEO-friendly اردو/انگلش کی طرز پر سرو کرنا۔

## بڑے قدم

### 1. Language infrastructure
- `LanguageContext.tsx` میں `"ar"` کا اضافہ، direction = `rtl`، localStorage key وہی۔
- نیا `src/locales/ar.json` بنانا — `en.json` (820 keys) کی پروفیشنل MSA ترجمہ شدہ کاپی۔ AI gateway script (`google/gemini-2.5-pro`) سے ترجمہ کر کے بیچ میں آپ کے لیے editable ہوگا۔
- `translationMap` میں `ar` رجسٹر۔
- RTL fonts: مناسب Arabic فونٹ (Noto Naskh Arabic یا موجودہ Urdu فونٹ) tailwind میں ensure۔

### 2. `/ar/...` routing
- ایک `LocalePrefixSwitcher` کمپوننٹ جو URL سے `/ar/` detect کر کے `setLanguage("ar")` کرے، اور language change پر URL کو بھی sync کرے۔
- `App.tsx` میں ہر public route کا `/ar/...` mirror:
  - `/ar`, `/ar/about`, `/ar/pricing-info`, `/ar/faq/is-ai-haram-in-islam`, `/ar/terms`, `/ar/privacy`, `/ar/refund-policy`، plus `/ar/login`, `/ar/signup`، اور moved-pricing وغیرہ۔
- Protected/app routes (`/dashboard`, `/editor`, ...) `/ar/` prefix کے بغیر رہیں گے — صرف public marketing سرفیس i18n‌ـsensitive ہے۔ ان میں language toggle سے اردو/انگلش/عربی switch ہوتی رہے گی۔

### 3. SEO: hreflang + canonical + sitemap
- `useSeo` hook کو expand کریں تاکہ ہر public پیج پر `hreflang` کے 3 alternate ٹیگ (`en`, `ur`, `ar`, plus `x-default`) inject ہوں — canonical اسی locale variant پر۔
- `public/sitemap.xml` میں ہر public URL کے `en`, `ur`, `ar` ورژن، اور `<xhtml:link rel="alternate" hreflang=...>` annotations۔
- `public/robots.txt` بغیر تبدیلی۔
- `index.html` کی `<html lang>` runtime پر LanguageContext پہلے سے update کرتا ہے — کوئی تبدیلی نہیں۔
- `public/llms.txt` میں عربی section شامل۔

### 4. Public پیجز کی hard-coded strings کو i18n میں منتقل
- `Landing`, `About`, `FaqAiHaram` (پہلے سے bilingual hard-coded ur/en — اب 3-way object کی صورت میں ar شامل)۔
- `PricingInfo`, `Terms`, `Privacy`, `Refund` (انگلش ہارڈ کوڈ شدہ) — ان کی عربی mirror cleanly رینڈر کریں: ہر پیج میں ایک locale-conditional content block (en/ur/ar) ڈالا جائے گا تاکہ legal content کا full faithful ترجمہ alongside لینڈ ہو۔
- `PublicLayout`, `Pricing` (login سے پہلے دکھنے والی صورت), navigation labels۔

### 5. Language switcher UI
- `PublicLayout` میں موجودہ EN/UR toggle کو 3-way dropdown (EN / اردو / العربية) سے بدلیں۔ منتخب language URL میں `/ar/` add/remove کرے بغیر page reload۔

### 6. AI ترجمہ pipeline
- `lovable_ai.py` skill استعمال کرتے ہوئے بیچ ٹرانسلیشن:
  1. `src/locales/en.json` → `src/locales/ar.json` (MSA, professional, technical terms preserved مثلاً "OCR", "AI", product names)۔
  2. ہر public پیج کے انگلش پیراگرافس → ar variants۔
- ترجمہ JSON-validated، product names "Easy Editor", "Al-Ulama", "Hafiz Khizar Hayat" وغیرہ untouched۔

### 7. Verification
- `tsgo` typecheck۔
- Playwright سے `/ar`, `/ar/about`, `/ar/privacy` پر screenshot لیں — RTL layout، Arabic فونٹ، hreflang ٹیگز DOM میں confirm۔

## آپ کے لیے نوٹس
- ترجمہ AI سے professional MSA انداز میں ہوگا، لیکن `src/locales/ar.json` اور legal/marketing strings آپ بعد میں آرام سے edit کر سکتے ہیں — سب ایک ہی جگہ keyed ہیں۔
- App کے اندرونی (logged-in) صفحات کا UI: locale keys سب translated ہوں گے، یعنی toggle سے dashboard وغیرہ بھی عربی میں آ جائے گا۔
- Credits کا خیال: ~820 keys + ~6 long pages کا ترجمہ Lovable AI Gateway سے ہوگا۔ یہ ایک بار کا cost ہے۔
