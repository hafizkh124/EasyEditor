# EasyEditor UI/UX Audit 2026 — موبائل · ڈیسک ٹاپ · ویب

**Status:** مسودہ برائے منظوری (مرحلہ A) · **Date:** 2026-10-20
**Scope:** صرف کاموں کی فہرست۔ اس مرحلے میں کوڈ میں کوئی تبدیلی نہیں۔
**اگلے مراحل:** B) اسکرینز کی ڈیزائننگ (`docs/design/screens/`) → C) پروجیکٹ میں نفاذ۔
**متعلقہ:** `docs/SPEC-UIUX.md` (2026-08 کا آڈٹ، F1–F8)، ADR-0011 (elevation/typography charter)، `src/core/capabilities/registry.ts` (پلیٹ فارم کے فیچر گیٹس)۔

> SPEC-UIUX کے پرانے findings (A–H) یہاں دہرائے نہیں گئے۔ جو ابھی تک ادھورے ہیں (C, D, F, G, H) وہ نیچے متعلقہ کام میں شامل ہیں۔

---

## 1. بنیادی اصول (آپ کی ہدایات)

1. تینوں پلیٹ فارمز (موبائل، ڈیسک ٹاپ، ویب) میں **فیچرز یکساں** ہوں۔
2. صرف تین جائز فرق ہیں (نیچے جدول)۔ اسکرین سائز، ٹچ/ماؤس اور نیویگیشن کے فرق UI/UX کے لحاظ سے میں خود سنبھالوں گا۔
3. معیار: 2026 کی ہائی لیول، پروفیشنل ایپ۔ ریفرنس بینچ مارک `SPEC-UIUX.md` §2 میں ہیں (Perplexity، Linear، Scrivener، Obsidian، Raycast وغیرہ)۔
4. موبائل کا مطلب فی الحال وہی ویب/PWA بلڈ ہے جو چھوٹی اسکرین پر چلے (`useIsMobile`، 768px بریک پوائنٹ)۔ الگ نیٹیو موبائل ایپ کوڈ میں نہیں ہے۔

## 2. Feature Parity Matrix

### 2.1 ہدف (آپ کی ہدایت کے مطابق)

| فیچر | ویب | موبائل | ڈیسک ٹاپ |
|---|---|---|---|
| رجسٹریشن / سائن ان | لازمی | لازمی | لازمی نہیں، اختیاری "ڈیٹابیس سے جوڑیں" |
| اپنی API (key/endpoint) لگانا | **؟** (نیچے سوال Q1) | **؟** (Q1) | ہاں |
| لوکل مکتبہ شاملہ | ہاں (bridge) | **نہیں** | ہاں |
| باقی سب | یکساں | یکساں | یکساں |

### 2.2 موجودہ حالت بمقابلہ ہدف (کوڈ سے ثابت شدہ فرق)

`registry.ts` میں ڈیسک ٹاپ پر یہ فیچر بند ہیں، جو آپ کے اصول "باقی سب یکساں" کے خلاف ہیں:

| فیچر | ویب | ڈیسک ٹاپ آج | مسئلہ |
|---|---|---|---|
| OCR (`/ocr`, `/ocr/review`) | ہے | **بند** ("cloud edge function") | پیریٹی ٹوٹی |
| کتاب کا ترجمہ (`/translate-book`) | ہے | **بند** | پیریٹی ٹوٹی |
| Transcribe / Speak | ہے | صرف `VITE_LOCAL_VOICE` فلیگ پر | فلیگ کے بغیر غائب |
| Voice cloning | ہے | **بند** | پیریٹی ٹوٹی |
| Token meter | ہے | **بند** (BYOK کی وجہ سے) | معقول، مگر UI میں متبادل (استعمال کا اشارہ) درکار |
| Admin | ہے | بند | قابلِ قبول (کلاؤڈ اکاؤنٹس کا انتظام) — تصدیق درکار (Q3) |
| Landing/About/Legal/Pricing | ہیں | `/workspace` پر redirect | قابلِ قبول، مگر Pricing/Profile کا راستہ دیکھنا ہے (Q3) |
| ڈیسک ٹاپ پر اختیاری سائن ان | — | **موجود** (`DesktopAccountMenu`, `ConnectDevice`) | صرف UI پالش درکار |
| لوکل شاملہ | bridge پینل | مکمل | موبائل پر چھپانے کا فیصلہ ابھی کوڈ میں نہیں |

**نتیجہ:** UI کا کام بعد میں، لیکن پہلے یہ پروڈکٹ فیصلہ لازمی ہے کہ ڈیسک ٹاپ پر OCR/ترجمہ/وائس کلوننگ کیسے چلیں گے (صارف کی اپنی API key سے؟)۔ اس کے بغیر ڈیسک ٹاپ کے لیے ان اسکرینز کا ڈیزائن ادھورا رہے گا۔ دیکھیں Q2۔

## 3. کھلے سوالات (ڈیزائن شروع کرنے سے پہلے آپ کا فیصلہ)

- **Q1.** ویب پر پہلے سے `WebByokKeyPanel` (Gemini/Groq/OpenRouter/Cohere کی keys) موجود ہے۔ آپ نے "اپنی API صرف ڈیسک ٹاپ" کہا تھا۔ کیا ویب/موبائل سے یہ پینل ہٹانا ہے، یا ویب پر رہنے دیں اور صرف ڈیسک ٹاپ کو "اپنا endpoint" کی اضافی سہولت دیں؟
- **Q2.** ڈیسک ٹاپ پر OCR، کتاب کا ترجمہ اور وائس کلوننگ: (الف) صارف کی اپنی API key سے چلیں، (ب) ڈیٹابیس سے جڑنے پر کلاؤڈ سے چلیں، یا (ج) فی الحال بند رہیں؟ میری تجویز: (الف)+(ب) دونوں، اور بند ہونے کی صورت میں اسکرین غائب نہیں بلکہ واضح "یہ سہولت کیسے آن کریں" حالت دکھائے۔
- **Q3.** ڈیسک ٹاپ پر Pricing، Profile، Admin، Dashboard: کون سے رہیں؟ میری تجویز: Dashboard اور Profile رہیں (جڑنے پر)، Pricing جڑنے کے بعد، Admin صرف ایڈمن اکاؤنٹ کے لیے۔

---

## 4. مشترکہ کام (تینوں پلیٹ فارمز پر)

ہر آئٹم: ID · ترجیح · کیا · کہاں۔

### 4.1 ڈیزائن سسٹم / ٹوکنز
- **S-01 · P0** سیمینٹک رنگ ٹوکنز `success / warning / info` (لائٹ+ڈارک) شامل کرنا۔ ابھی صرف `destructive` ہے۔ `src/index.css`, `tailwind.config.ts`.
- **S-02 · P0** خام palette رنگ (`bg-/text-/border-(red|green|amber|emerald|orange|…)-NNN`) کی جگہ ٹوکنز۔ میری grep کے مطابق اوپر کی 12 ڈائریکٹریز میں تقریباً 365 مقامات: `workspace` 113، `pages` 54، `research` 48، `admin` 28، `shamela` 21، `settings` 19، `pricing` 16، `editor` 13، `tafsir` 12، `mcp` 10۔
- **S-03 · P1** Trust/confidence رنگوں کو ADR-0011 §4.5 کے مطابق quiet chips بنانا (emerald/amber/orange/red) اور ڈارک موڈ میں خودکار جوڑی۔ `TrustTab.tsx`, `TaskRunCard.tsx`, `SourceCardList.tsx`.
- **S-04 · P1** Chart رنگ colorblind-distinct بنانا (ابھی سبز/خاکستری)۔ `index.css` chart ٹوکنز۔
- **S-05 · P1** Shadow اسکیل درست کرنا (`2xs=xs`، `shadow=sm`، `2xl` < `xl`)۔
- **S-06 · P2** آئیکن زبان: سائز فی رول اور رنگ کا اصول (SPEC-UIUX row C) لنٹ سے نافذ کرنا۔
- **S-07 · P2** 2026 کی بصری پالش: گہرائی (layered surfaces)، ہلکی بارڈرز، بہتر خالی جگہ، یکساں corner radius، glass/blur صرف جہاں مفید (sticky bars)۔

### 4.2 RTL اور زبانیں (اردو، عربی، انگریزی)
- **R-01 · P0** فزیکل ڈائریکشن کلاسز (`ml- mr- pl- pr- left- right-`، تقریباً 89 مقامات) کو لاجیکل (`ms- me- ps- pe- start- end-`) میں بدلنا؛ لنٹ کی grandfathered فہرست ختم کرنا۔
- **R-02 · P0** ہارڈ کوڈڈ `dir="rtl"` دور کرنا: `MobileTaskSheet.tsx:49`, `SlashCommandMenu.tsx:230`۔ لوکیل سے ڈائریکشن لیں۔
- **R-03 · P1** ٹائپوگرافی ہائرارکی: چیٹ/UI میں اردو کے لیے نسخ، دستاویز/ریڈر میں نستعلیق، قرآنی متن الگ؛ line-height اور سائز کی جانچ ہر اسکرین پر۔
- **R-04 · P1** آئیکن مرر (تیر، back/forward، chevrons) RTL میں درست ہوں۔
- **R-05 · P2** `/ar` اور `/ur` کے نقل شدہ routes (`src/App.tsx` 109–140) کو ایک جنریٹر سے بنانا تاکہ drift نہ ہو۔

### 4.3 حالتیں (States) اور فیڈبیک
- **ST-01 · P0** Loading: `Skeleton` اب صرف چند جگہ (workspace/App کا PageLoader)۔ `Dashboard`, `Profile`, `Settings`, `Admin`, `Pricing`, `Transcribe`, `Speak`, `OCR`, `TranslateBook` کے لیے مخصوص skeletons۔ نوٹ: `PageLoader` میں `h-screen` ہے جو موبائل پر ایڈریس بار کے ساتھ غلط بنتا ہے (`100vh` کا مسئلہ)، `dvh` یا `min-h-dvh` درکار۔
- **ST-02 · P0** Empty states: `EmptyState` صرف 8 workspace کمپوننٹس میں۔ باقی pages اور ٹولز (OCR، ترجمہ، ریکارڈنگ لسٹ، Dashboard) میں بھی۔
- **ST-03 · P0** Error states: `ErrorBoundary` کی اسکرین ڈیزائن کرنا (دوبارہ کوشش، رپورٹ، واپس)، نیٹ ورک/آف لائن/کوٹا/اجازت کی الگ حالتیں۔
- **ST-04 · P1** ہر طویل کام (AI رن، OCR، ترجمہ، ingestion) کے لیے یکساں progress + cancel + نتیجہ کا پیٹرن۔
- **ST-05 · P1** Toast/inline فیڈبیک کا اصول: عارضی (sonner) بمقابلہ مستقل (inline alert)۔
- **ST-06 · P1** آف لائن حالت: `public/offline.html` اور ایپ کے اندر آف لائن بینر کو برانڈ کے مطابق بنانا۔

### 4.4 Motion
- **M-01 · P1** ایک motion اسکیل (150–250ms ease-out) اور `motion-safe:` گارڈ، SPEC-UIUX row H کے مطابق۔
- **M-02 · P1** پینل/ڈرور/ڈائیلاگ/شیٹ ٹرانزیشنز؛ route پر ہلکا page-fade۔
- **M-03 · P2** چھوٹی micro-interactions: بٹن دبانا، کامیابی چیک مارک، rank تبدیلی، streaming ٹیکسٹ کا نرم ظہور۔

### 4.5 Accessibility
- **A-01 · P0** فوکس رنگ/رنگ کنٹراسٹ آڈٹ (WCAG AA) ڈارک موڈ سمیت، خصوصاً نئے ٹوکنز کے بعد۔
- **A-02 · P1** کی بورڈ نیویگیشن اور فوکس ٹریپ ہر ڈائیلاگ/شیٹ/مینو میں؛ `sr-only` لیبل جہاں آئیکن اکیلا ہے۔
- **A-03 · P1** ٹچ ٹارگٹ ≥44px (`min-h-touch`) ہر انٹرایکٹو عنصر پر۔
- **A-04 · P2** فونٹ کے سائز کی ترتیب (صارف کے لیے بڑا متن)، خاص طور پر اردو قارئین کے لیے۔

### 4.6 بھاری pages اور نیویگیشن
- **N-01 · P1** بڑے pages کو لے آؤٹ اور لاجک میں تقسیم: `TranslationWorkspace` 550، `Landing` 523، `Speak` 475، `PendingApproval` 451، `Transcribe` 350، `OCR` 333، `TranslateBook` 329 سطریں۔
- **N-02 · P1** نیویگیشن کی یکسانیت: `appNav.ts` + `AppSidebar` + `WorkspaceAppMenu` + `CommandPalette` سب `registry.ts` سے چلتے ہیں؛ اسی بنیاد پر ایک واضح information architecture۔
- **N-03 · P2** `src/App.css` (خالی) ہٹانا؛ README کے بیجز (Electron 33 / TS 5.7) کو `package.json` (Electron 43 / TS 5.8) کے مطابق کرنا۔

---

## 5. موبائل (≤768px، PWA، بنیادی ڈیوائس)

- **MB-01 · P0** Workspace ٹاپ بار: <640px پر تقریباً 6 کلسٹرز (app menu، back، library toggle، title، language toggle، Workbench toggle) → ہدف ≤2۔ language/RTL toggle کو app menu میں منتقل کرنا۔ `WorkspaceTopBar.tsx:135–278`. (SPEC-UIUX G, D)
- **MB-02 · P0** نیچے والا مستقل نیویگیشن (bottom nav) اور ایک ہاتھ سے استعمال: اہم ایکشنز انگوٹھے کی پہنچ میں؛ `mobileBottomNav` ٹیسٹ پہلے سے موجود ہے، ڈیزائن اس پر بنے۔
- **MB-03 · P0** ایڈیٹر + کی بورڈ: کی بورڈ کھلنے پر toolbar/selection bar کا برتاؤ، viewport (`visualViewport`/`dvh`)، کرسر نظر آتا رہے۔ `SelectionActionBar.tsx`, `RichEditor`.
- **MB-04 · P1** Selection bubble/slash menu: ≤5 ایکشنز، گروپ شدہ (متن/ڈھانچہ/AI)، انگوٹھے کے لیے بڑے ٹارگٹ۔ (SPEC-UIUX F6)
- **MB-05 · P1** Drawers/Sheets (Library، Workbench، Task sheet، Version history، Annotation): ایک ہی ڈرور پیٹرن (`vaul`)، swipe-to-dismiss، سپورٹ برائے back بٹن۔
- **MB-06 · P1** PWA: انسٹال پرامپٹ، splash، safe-area insets (notch)، standalone ٹاپ بار، آف لائن شیل۔
- **MB-07 · P1** Workbench ٹیبز (Research/Extract/Tasks/Trust/Study/Agent) کا موبائل پیٹرن: چھوٹی اسکرین پر segmented/scrollable tabs یا sheet۔
- **MB-08 · P1** فارمز (Login/Signup/Profile/Settings): ایک کالم، 16px inputs (iOS zoom گارڈ پہلے سے ہے)، درست `inputmode`/`autocomplete`۔
- **MB-09 · P1** لوکل مکتبہ شاملہ موبائل پر **چھپانا** (ہدایت): `LocalShamelaConnector`/bridge پینل اور متعلقہ settings، onboarding اور guide صفحے کی جگہیں۔ باقی Shamela cloud/reader موجود رہے۔ ایک مرکزی capability (`shamela.local`) کے ذریعے، بکھرے ہوئے `if` سے نہیں۔
- **MB-10 · P2** Pull-to-refresh/gesture، haptics (جہاں PWA اجازت دے)، کم بینڈوڈتھ پر ہلکی تصاویر۔

## 6. ڈیسک ٹاپ (Electron 1024px+)

- **DT-01 · P0** سائن ان لازمی نہیں: پہلی بار کھولنے پر سیدھا workspace، ٹاپ بار/سائڈ بار میں واضح مگر غیر مداخلتی "ڈیٹابیس سے جوڑیں" داخلہ، جڑنے کی حالت (جڑا/جڑا نہیں/ہم آہنگی جاری) کا مستقل اشارہ۔ `DesktopAccountMenu.tsx`, `ConnectDevice.tsx`, `ModeBadge.tsx`.
- **DT-02 · P0** "اپنی API لگائیں" کی مکمل اسکرین: provider منتخب کریں، key ڈالیں، **ٹیسٹ کنکشن**، اپنا endpoint/base-URL (نیا)، ماڈل کا انتخاب، حالت (فعال/غلط/کوٹا ختم)، کی کا خفیہ رہنا۔ `ByokKeyPanel.tsx` کو گائیڈڈ فلو میں بدلنا۔ (Q1 کے جواب پر انحصار)
- **DT-03 · P0** جو فیچر ابھی ڈیسک ٹاپ پر بند ہیں (OCR، ترجمہ، وائس کلوننگ) ان کے لیے "فعال کریں" حالت، چاہے API key سے ہو یا ڈیٹابیس سے۔ (Q2)
- **DT-04 · P1** Title bar اور ونڈو کروم: `DesktopTitleBarSync` کو تھیم کے مطابق، macOS/Windows کی روایات (کنٹرولز کی جگہ)۔
- **DT-05 · P1** تین پلر لے آؤٹ (Library / Canvas / Workbench): resizable پینلز کی ہینڈلز، یادداشت (سائز یاد رکھنا)، collapse/expand کی نرم ٹرانزیشن، ملٹی-ڈاکیومنٹ ٹیبز۔
- **DT-06 · P1** کی بورڈ-فرسٹ: Command Palette (`⌘/Ctrl+K`)، شارٹ کٹس کی فہرست اسکرین، ہر مینو میں شارٹ کٹ لیبل (`modifierKeyLabel()` موجود ہے)۔
- **DT-07 · P1** ماؤس کے لیے hover حالتیں، context menus (دایاں کلک)، drag-and-drop (فائلیں، متن)، نیٹیو فائل ڈائیلاگ۔
- **DT-08 · P1** ہم آہنگی (sync) کی حالت کی UI: آف لائن/مقامی بمقابلہ ڈیٹابیس؛ تنازع کی صورت میں واضح حل۔ `LegacyImportBanner.tsx` جیسے بینرز کا یکساں انداز۔
- **DT-09 · P2** اپڈیٹ کی اطلاع اور ریلیز نوٹس کی اسکرین؛ پہلی بار چلانے کا گائیڈ (ماڈلز کا ڈاؤن لوڈ، Whisper/Piper)۔
- **DT-10 · P2** Settings میں ڈیسک ٹاپ مخصوص حصے (voice engines، project folder، لوکل شاملہ) کی منطقی ترتیب۔

## 7. ویب ایپ (ڈیسک ٹاپ براؤزر + ٹیبلیٹ)

- **WB-01 · P0** Landing: 2026 کے معیار کا ہیرو، واضح قدر، سماجی ثبوت/اعتماد، قیمت کا خلاصہ، دو بڑے CTA۔ فی الحال 523 سطروں کا ایک فائل؛ سیکشن کمپوننٹس میں تقسیم۔ `/`, `/ar`, `/ur`.
- **WB-02 · P0** Auth فلو: Login، Signup، ForgotPassword، ResetPassword، CompleteProfile، PendingApproval، AccountRejected — ایک یکساں بصری زبان، واضح غلطیاں، پاس ورڈ کی طاقت کا اشارہ، Google سائن ان کی جگہ۔ (`PendingApproval` 451 سطریں)
- **WB-03 · P1** Dashboard (282 سطریں): ٹول گرڈ (registry سے)، حالیہ دستاویزات، استعمال/ٹوکن بیلنس، پہلی بار کی رہنمائی۔
- **WB-04 · P1** Settings، Profile، Pricing، CheckoutSuccess: سیکشنز کی ترتیب، sticky نیویگیشن، واضح محفوظ/غیر محفوظ حالت۔
- **WB-05 · P1** Admin (28 خام رنگ): جدولیں، فلٹرز، bulk ایکشنز، ڈارک موڈ۔ (صرف ویب)
- **WB-06 · P1** عوامی صفحات (About، FAQ، Answers، Terms، Privacy، Refund، PricingInfo، Maktaba Shamila Guide): یکساں ٹائپوگرافی (typography plugin)، مواد کی چوڑائی، فہرستِ مضامین، SEO کو متاثر کیے بغیر۔
- **WB-07 · P1** ٹیبلیٹ بریک پوائنٹ (768–1024px): دو پینل لے آؤٹ، Workbench ڈرور یا ساتھ میں۔
- **WB-08 · P1** ٹولز: Transcribe، Speak، OCR، OcrReview، TranslateBook کا یکساں "ٹول شیل" (ان پٹ ← پروسیس ← نتیجہ ← محفوظ/برآمد)۔
- **WB-09 · P2** کمانڈ پیلیٹ اور شارٹ کٹس ویب پر بھی (ڈیسک ٹاپ کے برابر)۔
- **WB-10 · P2** ویب پر لوکل شاملہ bridge پینل کو واضح مرحلہ وار گائیڈ میں بدلنا۔

---

## 8. اسکرینز کی فہرست جو مرحلہ B میں ڈیزائن ہوں گی

ہر اسکرین: موبائل 375px · ڈیسک ٹاپ/ویب 1440px (اور ٹیبلیٹ جہاں فرق ہو) · لائٹ/ڈارک · اردو RTL۔ `src/App.tsx` کے routes سے مرتب:

| گروپ | اسکرینز | پلیٹ فارم |
|---|---|---|
| **1. Workspace (مرکزی)** | ٹاپ بار + ایڈیٹر کینوس · Library پینل (Home/Sources/Graph/Recipes/Search) · Workbench (Research/Tasks/Trust/Study/Agent) · Selection bubble · Slash menu · Command palette · Version history · Annotation | سب |
| **2. ٹولز** | Transcribe · Speak · OCR + Review · Book Translation | سب (ڈیسک ٹاپ پر Q2) |
| **3. اکاؤنٹ** | Login · Signup · Forgot/Reset · Complete profile · Pending approval · Rejected · OAuth consent | ویب+موبائل؛ ڈیسک ٹاپ پر اختیاری |
| **4. ڈیسک ٹاپ خصوصی** | پہلی بار چلانا · "ڈیٹابیس سے جوڑیں" · Device link · "اپنی API لگائیں" · ہم آہنگی کی حالت · اپڈیٹ | صرف ڈیسک ٹاپ |
| **5. شاملہ** | لوکل کنکشن/Bridge · Import ڈائیلاگ · Reader | موبائل پر لوکل نہیں |
| **6. اکاؤنٹ/کاروبار** | Dashboard · Profile · Settings · Pricing · Checkout success · Admin | ویب+موبائل (+ڈیسک ٹاپ Q3) |
| **7. عوامی** | Landing · About · FAQ · Answers · Legal · Guide | ویب+موبائل |
| **8. نظام کی حالتیں** | Loading skeletons · Empty states · Error boundary · Offline · 404 · کوٹا ختم | سب |

## 9. مجوزہ ترجیحی ترتیب (مرحلہ C کے لیے)

1. **بنیاد:** S-01, S-02, A-01 (رنگ اور کنٹراسٹ) + R-01, R-02 (RTL)
2. **حالتیں:** ST-01, ST-02, ST-03
3. **موبائل شیل:** MB-01, MB-02, MB-03, MB-09
4. **ڈیسک ٹاپ کنکشن/API:** DT-01, DT-02, DT-03 (Q1–Q3 کے بعد)
5. **ویب اسکرینز:** WB-01, WB-02, WB-03
6. **motion، پالش، refactor:** M-01…, N-01, S-07
7. **لنٹ گارڈز** تاکہ نتیجہ واپس نہ بگڑے (خام رنگ، آئیکن سائز، spacing، دائرہ 4 ڈائریکٹریز سے پوری `src/` تک)

## 10. تصدیق (ہر مرحلے کے بعد)

`npm run lint` · `npm run typecheck` · `npm test` · `npm run dev` (پورٹ 8080) پر Playwright/Chromium اسکرین شاٹس: 375px، 768px، 1440px × لائٹ/ڈارک × en/ur/ar؛ Electron میں `npm run dev:electron`۔
