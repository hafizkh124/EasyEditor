# SPEC-M5 — Electron شیل (اوپن سورس) + BYOK + مقامی شاملہ + مقامی وائس اسٹوڈیو

**حیثیت:** منظور شدہ · **ورژن:** 5.1.0 · **تاریخ:** 2026-07-29
**برانچ:** `newee` → feature flag اور الگ build target کے پیچھے `main`
**تخمینہ:** 43 ورکنگ دن (9 مراحل) · **پیش شرط:** M4 مکمل ✅
**فیصلے:** §8 میں درج (صارف سے منظور شدہ) · **کوئی کھلا سوال باقی نہیں**
**نفاذی چیک لسٹ:** تفصیلی قدم بہ قدم پلان الگ دستاویز میں

---

## 1. سیاق + رہنما اصول

M1 نے دستاویز کو وجود دیا، M2 نے ورک اسپیس بنایا، M3 نے ایڈیٹر کے اندر AI کھڑا کیا، اور M4 نے AI کو صارف کے **اپنے** علم تک رسائی دی — ذاتی کتب خانہ، Knowledge Graph، اور Recipes۔

مگر آج تک ہر چیز ایک مفروضے پر کھڑی ہے: **صارف کا مواد ہمارے سرور پر رہتا ہے، اور ہر AI کال ہمارے خرچ پر ہمارے edge function سے گزرتی ہے۔** M5 اسی مفروضے کو اختیاری بناتا ہے۔ اس کے تین محرکات ہیں:

1. **رازداری**: ایک عالِم کا غیر مطبوعہ مسودہ، اس کے ذاتی نوٹس، اور اس کی خریدی ہوئی کتابیں — بہت سے صارفین کے لیے ان کا کسی بھی سرور پر جانا ہی ناقابلِ قبول ہے۔ M4 نے RLS سے حفاظت دی؛ M5 اس سے آگے بڑھ کر **مکمل عدم موجودگی** دیتا ہے: ڈیٹا مشین سے نکلتا ہی نہیں۔
2. **لاگت کی حقیقت**: ٹوکن کا موجودہ نظام ([tokenGuard.ts:89](file:///e:/EasyEditor/supabase/functions/_shared/tokenGuard.ts#L89)) ہمیں ہر صارف کی AI لاگت کا ضامن بناتا ہے۔ BYOK اس ضمانت کو ختم کرتا ہے: صارف اپنی Gemini key دیتا ہے اور براہِ راست Google کو ادائیگی کرتا ہے۔
3. **شاملہ**: عربی علمی کام کا سب سے بڑا ذخیرہ پہلے سے لاکھوں صارفین کی مشینوں پر نصب ہے۔ آج ہمارا رابطہ اس سے ایک بیرونی، دستی طور پر چلائے جانے والے localhost سرور کے ذریعے ہے ([server.mjs:38](file:///e:/EasyEditor/tools/shamela-bridge/server.mjs#L38))، جو تیسرے فریق کے `shamela-mcp` پیکج اور `D:\` کے سخت راستوں پر منحصر ہے۔ **ڈیسک ٹاپ ایپ کے اندر یہ کوئی پل نہیں، ایک سیدھی فائل پڑھائی ہے۔**

### 1.1 کوڈ کے جائزے کی چار دریافتیں

یہ چاروں M5 کی ساخت اور اس کے دورانیے کا تعین کرتی ہیں:

1. **اصل کام Electron نہیں، backend adapter ہے — مگر اس کا دائرہ 54 نہیں، 13 فائلیں ہے۔** 54 فائلیں `@/integrations/supabase/client` import کرتی ہیں ([client.ts:11](file:///e:/EasyEditor/src/integrations/supabase/client.ts#L11))، مگر ان کی درجہ بندی سے معلوم ہوا کہ **اکثریت cloud-only سطحوں کی ہے** جو Electron موڈ میں موجود ہی نہیں ہوں گی (auth، Admin، Pricing، Profile، OCR، referrals، notifications)۔ **اصل دائرہ 10 سروس فائلیں + 3 رسنے والے مقامات ہیں** (§3 FR-1.2 میں مکمل فہرست)۔ **اس کے برعکس AI کالز کی سطح چھوٹی ہے** — `functions.invoke` کے صرف 8 مقامات ہیں۔
2. **`_shared/` کا کوڈ Deno کا ہے، اور Electron کا main process Node ہے۔** `refine-text` کے prompts، `citationEngine`، `rankFusion`، اور `embed.ts` — یہ 11,280 سطور کی وہ منطق ہے جو مقامی موڈ میں بھی درکار ہوگی۔ **اس کی نقل بنانا M4 کے خطرہ R14 کا دوبارہ ارتکاب ہوگا** (وہی سبق جس نے `_shared/fileText.ts` کو جنم دیا)۔ M5 کو ایک ایسا حصہ چاہیے جسے دونوں runtimes بغیر ترمیم کے پڑھ سکیں۔
3. **Embedding کا ماڈل ناقابلِ تبدیل ہے۔** `embed.ts` کے صریح تبصرے میں ایک پرانی غلطی درج ہے: مختلف ماڈل سے embed کیا گیا query خاموشی سے **صفر نتائج** دیتا ہے، error نہیں ([embed.ts:17](file:///e:/EasyEditor/supabase/functions/_shared/embed.ts#L17))۔ مقامی SQLite کا corpus بھی لازماً `gemini-embedding-001 @ 768` ہی ہوگا، ورنہ وہی خاموش ناکامی ایک نئی جگہ پیدا ہو جائے گی۔

4. **سروسز پہلے ہی درست شکل میں ہیں — یہ M5 کی سب سے اچھی خبر ہے۔** [documentService.ts:48](file:///e:/EasyEditor/src/core/workspace/documentService.ts#L48) کا اپنا تبصرہ اسے *"Data operations abstraction layer"* کہتا ہے، اور واقعی ہر method ایک صاف async فنکشن ہے جو domain types ([types.ts](file:///e:/EasyEditor/src/core/workspace/types.ts)) لوٹاتا ہے، Supabase کا query builder **نہیں**۔ **یعنی یہ سروسز خود ہی interface ہیں۔** UI کی ~40 فائلیں `documentService` import کرتی ہیں، `supabase` نہیں — **وہ بالکل نہ بدلیں گی**۔ M5.0 کا کام صرف ان 10 سروسز کے bodies کو `cloudBackend` میں منتقل کرنا ہے، اور اسی وجہ سے یہ مرحلہ چھ کے بجائے **چار دن** کا ہے۔

### 1.2 پانچ رہنما اصول (M3 §1.1 سے برقرار)

1. **Cognitive Continuity (سیاق نہ ٹوٹے)**
2. **Workbench on Demand (تیسرا ستون ضرورت پر)**
3. **عالِم اجازت دیتا ہے، ہم نہیں (صارف کا حتمی اختیار)**
4. **دکھاؤ کہ کہاں سے آیا (شفافیت)**
5. **کوئی خاموش خرچ نہیں (پیشگی مالی اطلاع)**

M5 میں ان کا سب سے اہم اطلاق:

- **اصول ۳ کی نئی جہت — صارف کا ڈیٹا کہاں رہے، یہ بھی صارف کا فیصلہ ہے۔** ایپ کبھی خودبخود مقامی ڈیٹا کو cloud پر یا cloud کے ڈیٹا کو مقامی پر منتقل نہ کرے۔
- **اصول ۵ کا نیا معنی — BYOK میں "بیلنس" ہمارا نہیں، صارف کا Google بل ہے۔** ٹوکن کاؤنٹر غائب ہو جانے کا مطلب یہ نہیں کہ خرچ کی اطلاع بھی غائب ہو جائے۔ ہر بڑے رن سے پہلے تخمینہ **لازم رہے گا**، صرف اس کی اکائی بدلے گی (ٹوکن → درخواستیں اور تخمینی Google ٹوکن)۔
- **اصول ۴ کی نئی جہت — صارف ہمیشہ جانے کہ وہ کس موڈ میں ہے۔** UI میں مستقل، غیر مبہم اشارہ کہ یہ دستاویز مقامی ہے یا cloud پر۔

---

## 2. Non-Goals (M5 میں شامل نہیں)

- **مقامی اور cloud کے درمیان Sync**: دو طرفہ ہم آہنگی conflict resolution کا ایک مکمل مسئلہ ہے اور اکیلا ایک milestone ہے۔ M5 میں صرف **برآمد/درآمد** (export/import) ہوگا، کوئی خودکار sync نہیں۔ (خطرہ R9)
- **OCR کا مقامی نفاذ**: **Electron موڈ میں یہ صفحہ موجود ہی نہیں ہوگا** — ٹوٹے ہوئے بٹن نہیں، بلکہ غیر موجود nav آئٹم اور ایک وضاحتی سطر۔
  - ⚠️ **تصحیح:** Transcribe اور Speak پہلے اسی Non-Goal میں تھے، مگر M5.5/M5.6 کے مقامی وائس انجنز (Whisper + Piper) کے فیصلے کے بعد **دونوں Electron موڈ میں موجود ہوں گے** (§FR-6)۔ صرف OCR باقی رہا۔
- **مقامی موڈ میں Recipe authoring**: M4 §9 مفروضہ ۶ کا وعدہ M6 کو منتقل۔
- **BYOK برائے غیر Gemini فراہم کنندگان**: OpenAI / Anthropic / ElevenLabs کی keys M5 میں نہیں۔ صرف Gemini (chat + embeddings)۔ فیصلہ §8 میں۔
- **خودکار اپڈیٹ (auto-update)**: M5 میں GitHub Releases سے دستی ڈاؤن لوڈ۔ `electron-updater`، code signing، اور macOS notarization M6 کے امیدوار ہیں (لاگت اور CI کا الگ مسئلہ)۔
- **macOS / Linux کی مکمل حمایت**: **Windows پہلے** (صارف کا ہدف پلیٹ فارم)۔ باقی دونوں کے لیے build چلے گا مگر M5 کا exit criteria نہیں۔
- **شاملہ کی فائلوں میں کوئی تحریر**: درآمد سختی سے read-only۔ ہم صارف کی نصب شدہ لائبریری کو کبھی نہ چھوئیں۔
- **پوری شاملہ لائبریری کا یک کلک درآمد**: جان بوجھ کر **نہیں** — یہ صارف کے Gemini بل کے لیے تباہ کن ہوگا۔ صرف فی کتاب انتخاب اور پیشگی تخمینہ (خطرہ R7)۔
- **مقامی موڈ میں Admin، Pricing، Billing، Referrals، receipts**: یہ خالص cloud SaaS کی سطحیں ہیں۔
- **مقامی LLM (Ollama / llama.cpp)**: M5 میں نہیں؛ BYOK کا مطلب صارف کی cloud key ہے، مقامی ماڈل نہیں۔
- **صارف کی اپنی Recipe بنانا** (M4 §9 مفروضہ ۶ کا وعدہ): یہ M5 کا امیدوار تھا مگر M5 کا وزن پہلے ہی ساختی ہے — **M6 کو منتقل**۔
- **ذاتی/شاملہ مواد کا مشترکہ `scholarly_documents` میں جانا**: M4 خطرہ R7 کی توسیع — درآمد شدہ شاملہ chunks کبھی اپلوڈ نہ ہوں (خطرہ R11)۔

---

## 3. Functional Requirements

### FR-1 · M5.0 — Backend Adapter (بنیاد، بغیر flag، سب سے پہلے)

> یہ M5 کا سب سے بڑا اور واحد ناگزیر حصہ ہے۔ اس کے بغیر ایک ہی codebase دو جگہ نہیں چل سکتا، اور اس کے بعد باقی سب کچھ نسبتاً سیدھا ہے۔

- **FR-1.1 `src/core/backend/` کا تعارف**:
  ایک interface (`WorkspaceBackend`) اور دو نفاذ: `cloudBackend.ts` (موجودہ Supabase کالز، بعینہٖ) اور `localBackend.ts` (M5.3 میں SQLite)۔ ایک ہی `getBackend()` build mode کی بنیاد پر درست نفاذ لوٹائے۔

- **FR-1.2 دائرہ کار کی سختی — صریح فہرست**:
  Adapter صرف **ورک اسپیس کی سطح** کو ڈھانپے گا: `projects`، `documents`، `document_versions`، `library_items`، `library_chunks`، `annotations`، `task_runs`، `entities`، `entity_relations`، `recipes`۔

  **دائرے میں — یہ 10 سروس فائلیں (ان کے bodies `cloudBackend` میں منتقل ہوں گے):**

  ```
  src/core/workspace/documentService.ts
  src/core/workspace/libraryItemService.ts
  src/core/workspace/annotationService.ts
  src/core/workspace/taskRunService.ts
  src/core/workspace/bookSectionMigration.ts
  src/lib/corpus/libraryChunkService.ts
  src/lib/corpus/ingestOrchestrator.ts
  src/lib/graph/graphService.ts
  src/lib/recipes/recipeService.ts
  src/lib/tasks/customTasks.ts
  ```

  > **نفاذ کے دوران دو تصحیحات (M5.0-C میں دریافت):**
  >
  > 1. **`bookSectionMigration.ts` دائرے سے خارج ہے۔** یہ `book_projects` / `book_chapters` / `book_sections` / `translation_projects` — یعنی صرف hosted ڈیٹابیس میں موجود پرانی ٹیبلوں — کو `projects`/`documents` میں منتقل کرتی ہے۔ ایک نئی مقامی SQLite فائل میں منتقل کرنے کو کچھ ہے ہی نہیں، اس لیے `localBackend` سے اس کا نفاذ مانگنا مردہ کوڈ لکھوانا ہوگا۔ یہ Admin/Pricing/OCR کی طرح cloud-only رہے گی۔
  > 2. **`graphService.extractGraphFromText` اور `runLibraryIngest` بھی خارج ہیں۔** دونوں `functions.invoke` کرتی ہیں — یعنی یہ **AI کالیں ہیں، ڈیٹا کالیں نہیں**۔ یہ M5.2 کے AI adapter میں جائیں گی۔ `graphService` کی باقی تمام (data) کارروائیاں adapter سے گزرتی ہیں۔
  >
  > نتیجتاً `WorkspaceBackend` **8 ڈیٹا سروسز** پر مشتمل ہے، اور تینوں مستثنیات کوڈ میں صراحتاً درج ہیں (ESLint کی `ignores` فہرست + دو inline disable تبصرے جن میں M5.2 کا حوالہ ہے)۔

  **+ 3 رسنے والے مقامات** (سروس کے باہر براہِ راست Supabase):

  | فائل | سطر | مسئلہ | اقدام |
  |---|---|---|---|
  | [BookWorkspace.tsx](file:///e:/EasyEditor/src/pages/BookWorkspace.tsx#L163) | 163, 185 | براہِ راست `book_sections` insert | `bookSectionMigration` سروس میں منتقل |
  | [BookEditorView.tsx](file:///e:/EasyEditor/src/components/book/BookEditorView.tsx#L59) | 59 | `functions.invoke("refine-text")` | AI adapter سے گزرے |
  | [ExtractPanel.tsx](file:///e:/EasyEditor/src/components/extract/ExtractPanel.tsx#L99) | 99 | `extract-translations` | **کچھ نہ کریں** — cloud-only، دائرے سے باہر |

  **دائرے سے باہر (بدستور براہِ راست Supabase، اور Electron موڈ میں غیر موجود):** auth، Admin، Pricing، Profile، Billing، receipts، Referrals، notifications، OCR، اور مشترکہ `scholarly_documents` کی تلاش۔

  یہ حد جان بوجھ کر ہے: adapter کو ہر چیز پر پھیلانا M5 کو دگنا کر دے گا اور ایک زندہ، ادائیگی شدہ پروڈکٹ پر غیر ضروری خطرہ ڈالے گا۔

- **FR-1.2ب شناخت (identity)**:
  سروسز کے اندر `supabase.auth.getUser()` کی کالیں ہیں (مثلاً [annotationService.ts:23](file:///e:/EasyEditor/src/core/workspace/annotationService.ts#L23))۔ مقامی موڈ میں کوئی auth نہیں۔ اس لیے `WorkspaceBackend` میں `getCurrentUserId(): Promise<string>` شامل ہوگا — cloud پر Supabase کا user، مقامی پر `corpus_meta` میں محفوظ ایک مستقل UUID۔

- **FR-1.3 ناقابلِ واپسی ضمانت (ESLint سے نافذ)**:
  M5.0 مکمل ہونے کے بعد **`src/core/backend/` کے باہر کوئی فائل `@/integrations/supabase/client` import نہ کرے** (FR-1.2 کی مستثنیٰ فہرست کے سوا)۔ یہ ایک `no-restricted-imports` قاعدے سے نافذ ہو، تاکہ آنے والا کوئی بھی کام اسے خاموشی سے واپس نہ توڑ سکے۔ **یہ اس FR کا سب سے اہم جزو ہے** — بغیر نفاذ کے یہ refactor چند ہفتوں میں بوسیدہ ہو جائے گا۔

- **FR-1.4 کوئی رویہ تبدیل نہ ہو**:
  M5.0 میں **صرف `cloudBackend` بنے گا** اور ایپ بعینہٖ M4 کی طرح چلے گی۔ M4 کے تمام موجودہ ٹیسٹ **بلا ترمیم** پاس ہوں۔ ایک بھی Electron یا SQLite کی سطر M5.0 کے exit criteria پورے ہونے سے پہلے نہ لکھی جائے (خطرہ R1)۔

- **FR-1.5 `shared/` — دو runtimes کا مشترکہ کوڈ**:
  Repo کی جڑ میں ایک نیا `shared/` جس میں **runtime سے آزاد** منطق ہو: task prompts، chunking، rank fusion، citation formatting، اور embedding کے constants۔
  - **سخت پابندی:** `shared/` میں کوئی `Deno.*`، کوئی `node:*`، کوئی `npm:` specifier، اور کوئی `import.meta.env` نہ ہو۔ صرف خالص TypeScript۔
  - Deno edge functions اسے نسبتی راستے سے import کریں؛ Vite/Node ایک path alias سے۔
  - **ایک ٹیسٹ لازم ہے جو تصدیق کرے کہ دونوں runtimes `shared/` کا ہر ماڈیول لوڈ کر سکتے ہیں** — ورنہ drift خاموشی سے واپس آ جائے گا (خطرہ R2)۔

- **FR-1.6 شاملہ کے فارمیٹ کا Spike**:
  کوئی بھی درآمد کا کوڈ لکھنے سے پہلے، صارف کی اصل نصب شدہ لائبریری پر ایک تحقیقی spike: فائلوں کی ساخت (SQLite بمقابلہ Access/Jet)، جدولوں کے نام، متن کی encoding، اور فی کتاب اوسط حجم۔ **نتیجہ ADR-0007 میں درج ہو، اور M5.4 کا ڈیزائن اسی پر مبنی ہو** — اندازے پر نہیں (خطرہ R6)۔

---

### FR-2 · Electron شیل

- **FR-2.1 ساخت**:
  `electron/main.ts`، `electron/preload.ts`، اور موجودہ Vite renderer۔ Build `electron-vite` + `electron-builder` سے؛ Windows کے لیے NSIS installer اور ایک portable build۔

- **FR-2.2 حفاظتی بنیاد (ناقابلِ مذاکرہ)**:
  - `contextIsolation: true`، `nodeIntegration: false`، `sandbox: true`۔
  - Renderer میں ایک سخت CSP؛ کوئی remote content لوڈ نہ ہو۔
  - Preload صرف ایک **مخصوص، محدود، اور typed** API ظاہر کرے۔ **کوئی عمومی چینل نہ ہو** جیسے "یہ SQL چلا دو" یا "یہ URL fetch کر دو" — ہر IPC چینل ایک مخصوص عمل کا نمائندہ ہو۔
  - `shell.openExternal` صرف ایک allowlist شدہ سکیم/میزبان کے ساتھ۔

- **FR-2.3 فائل سسٹم تک رسائی صرف صارف کے اقدام پر**:
  ہر فائل/فولڈر تک رسائی ایک صریح `dialog.showOpenDialog` سے شروع ہو۔ ایپ خودبخود ڈسک نہ کھنگالے۔

- **FR-2.4 موڈ کی صریح نشاندہی (اصول ۴)**:
  ونڈو کے عنوان اور سائیڈبار میں ایک مستقل، غیر مبہم بیج: **"مقامی"** یا **"کلاؤڈ"**۔ صارف کبھی شک میں نہ رہے کہ اس کا مسودہ کہاں محفوظ ہو رہا ہے۔

- **FR-2.5 غیر موجود سطحیں، ٹوٹے بٹن نہیں**:
  **OCR / Admin / Pricing / Profile / Referrals** مقامی موڈ میں nav سے **مکمل غائب** ہوں، ایک وضاحتی سطر کے ساتھ ("یہ خصوصیات ویب ورژن میں دستیاب ہیں")۔ کوئی غیر فعال بٹن یا ناکام درخواست نہ ہو (خطرہ R12)۔
  **Transcribe اور Speak مقامی موڈ میں موجود ہوں گے** — مقامی وائس انجنز کے ساتھ (§FR-6)، اور وہاں **کوئی ٹوکن نہ کٹے** کیونکہ رینڈرنگ صارف کی اپنی مشین پر ہوتی ہے۔

- **FR-2.6 پہلی بار چلنے کا تجربہ**:
  پہلی launch پر تین قدم: (۱) Gemini API key، (۲) ڈیٹا کا مقام (default `userData`)، (۳) اختیاری شاملہ درآمد۔ **کوئی اکاؤنٹ، کوئی سائن اپ، کوئی نیٹ ورک درخواست** — ایپ key کے بغیر بھی کھلے اور ایڈیٹر چلے (صرف AI خصوصیات معطل ہوں)۔

- **FR-2.7 برآمد و درآمد**:
  "کتب خانہ برآمد کریں" — SQLite فائل + منسلک فائلوں کا فولڈر ایک جگہ۔ درآمد اسی کا الٹ۔ **یہی M5 میں cloud اور مقامی کے درمیان واحد پل ہے** (Non-Goal: sync)۔

---

### FR-3 · BYOK — Gemini، main process سے براہِ راست

- **FR-3.1 Key کا اندراج اور تحفظ**:
  - Key صرف Settings میں درج ہو، Electron کے `safeStorage` سے encrypt ہو کر `userData` میں محفوظ رہے۔
  - **`localStorage` میں ہرگز نہیں** (M4 کے `shamela.mcp_url` والے موجودہ نمونے کے برعکس — [localShamelaService.ts:27](file:///e:/EasyEditor/src/lib/shamela/localShamelaService.ts#L27))۔
  - **Renderer کبھی key نہ دیکھے**: اندراج کے وقت value براہِ راست main کو جائے اور renderer کی state میں محفوظ نہ ہو۔ Renderer کو صرف "key موجود ہے / نہیں" اور آخری چار حروف ملیں۔

- **FR-3.2 تمام AI کالز main process سے**:
  Chat اور embeddings — دونوں `electron/ai/geminiClient.ts` سے Google کو براہِ راست جائیں۔ **کوئی Supabase edge function بیچ میں نہ ہو۔** Renderer صرف IPC سے درخواست بھیجے اور stream وصول کرے۔

- **FR-3.3 Streaming کی برابری**:
  M3 کا SSE پر مبنی streaming ([sse.ts](file:///e:/EasyEditor/src/lib/sse.ts)) مقامی موڈ میں IPC کے stream چینل سے آئے، مگر **کالر کو ایک ہی interface نظر آئے** — task orchestration کے کوڈ میں کوئی `if (isElectron)` نہ ہو۔

- **FR-3.4 منطق کا اشتراک، نقل نہیں**:
  `refine-text` کے actions/prompts، `graph-extract` کا JSON schema، chunking، اور rank fusion — سب `shared/` (FR-1.5) سے آئیں۔ Deno edge function اور Electron main **ایک ہی فائل** پڑھیں۔ اگر مقامی موڈ کے لیے کوئی prompt الگ لکھنا پڑ رہا ہے تو یہ اس بات کی علامت ہے کہ اسے پہلے `shared/` میں جانا چاہیے تھا۔

- **FR-3.5 Embedding کا ماڈل قفل شدہ**:
  مقامی corpus بھی `gemini-embedding-001 @ 768`۔ **مقامی DB میں ایک `corpus_meta` جدول ماڈل کا نام اور dimensions محفوظ رکھے، اور ماڈل نہ ملنے پر تلاش صاف انکار کرے** — خاموشی سے صفر نتائج ہرگز نہ لوٹائے (خطرہ R3، `embed.ts` کی درج شدہ پرانی غلطی کا تدارک)۔

- **FR-3.6 خرچ کی شفافیت، نئی اکائی میں (اصول ۵)**:
  مقامی موڈ میں `tokenGuard` غیر متعلقہ ہے، مگر پیشگی اطلاع نہیں۔ ہر chunked رن، Recipe، اور درآمد سے پہلے وہی pre-flight ڈائلاگ آئے، مگر "ٹوکن بیلنس" کی جگہ: **درخواستوں کی تعداد + تخمینی Google ٹوکن + "یہ آپ کے Gemini اکاؤنٹ پر خرچ ہوگا" کی صریح تنبیہ**۔ تصدیق سے پہلے ایک بھی network درخواست نہ جائے (M3 FR-5.11 کا تسلسل)۔

- **FR-3.7 مقامی استعمال کا شمار**:
  ایک سادہ مقامی کاؤنٹر (درخواستیں اور تخمینی ٹوکن، فی دن اور فی مہینہ)۔ **کوئی telemetry نہیں** — یہ اعداد صارف کی مشین سے نہ نکلیں۔

- **FR-3.8 ناکامی کا واضح رویہ**:
  Google کی طرف سے 401/403 (غلط key)، 429 (rate limit)، اور 402 (quota) کے لیے تین الگ اور صاف پیغامات — عمومی "کچھ غلط ہو گیا" ہرگز نہیں۔ صارف کو معلوم ہو کہ مسئلہ اس کی key کا ہے، اس کے بل کا، یا محض رفتار کا۔

- **FR-3.9 Key کبھی logs میں نہ آئے**:
  Main process کے تمام logs اور کسی بھی crash report سے key کی redaction لازم۔

---

### FR-4 · مقامی ذخیرہ — SQLite + vector

- **FR-4.1 ایک ہی فائل، صارف کی ملکیت**:
  `userData/library.db`۔ ایک فائل جسے صارف خود کاپی، backup، یا حذف کر سکے۔ منسلک اصل فائلیں (PDF/DOCX) اسی کے پہلو میں ایک `files/` فولڈر میں۔

- **FR-4.2 Schema — Postgres کا ہم شکل**:
  M4 کی migrations کے **بعینہٖ وہی کالم نام** (`library_chunks`، `entities`، `entity_relations`، `documents`، `task_runs`، …)، منہائے RLS (ایک صارف، ایک فائل — RLS بے معنی ہے)۔
  **یہ ہم شکلی جان بوجھ کر ہے:** adapter کے دونوں نفاذ بالکل ایک جیسی اشیاء لوٹائیں، تاکہ اوپر کی پوری ایپ کو فرق کا علم ہی نہ ہو۔

- **FR-4.3 Vector تلاش**:
  `sqlite-vec` کا `vec0` virtual table (768 × float32)، `match_library_chunks` کے ہم معنی ([m4_personal_corpus.sql:33](file:///e:/EasyEditor/supabase/migrations/20260728000002_m4_personal_corpus.sql#L33))۔
  **Fallback:** اگر extension لوڈ نہ ہو سکے تو JS میں brute-force cosine — مگر ایک صریح سطر کی حد کے ساتھ، اور اس سے تجاوز پر صاف انتباہ۔ خاموشی سے سست ہونا قابلِ قبول نہیں (خطرہ R5)۔

- **FR-4.4 مقامی ingest**:
  M4 کا `ingestOrchestrator` ([ingestOrchestrator.ts:59](file:///e:/EasyEditor/src/lib/corpus/ingestOrchestrator.ts#L59)) `library-ingest` edge function کو کال کرتا ہے۔ مقامی موڈ میں یہی orchestrator adapter کے ذریعے main process کے ingest handler کو کال کرے — **وہی resumable `{ item_id, offset }` پروٹوکول، وہی منسوخی، وہی جزوی کامیابی**۔ Edge کی 60 سیکنڈ کی حد یہاں نہیں، مگر پروٹوکول بدلنے کی کوئی وجہ بھی نہیں: یہی منسوخی اور resume کو مفت دیتا ہے۔

- **FR-4.5 UI کو جام نہ کرے (M4 NFR-8 کا تسلسل)**:
  Ingest اور embedding main process میں چلیں، renderer صرف پیش رفت وصول کرے۔ 300 صفحات کی کتاب کے دوران ایڈیٹر مکمل جواب دہ رہے۔

- **FR-4.6 حذف کی سالمیت (M4 FR-2.9 کا تسلسل)**:
  Library item حذف ہونے پر اس کے chunks (FK cascade) **اور** `files/` کی اصل فائل — دونوں ختم ہوں۔

- **FR-4.7 مقامی migrations**:
  SQLite کے لیے ایک سادہ ورژن شدہ migration رنر (ایک `schema_version` قدر)۔ ایپ کے ہر اپڈیٹ پر schema خاموشی سے ٹوٹنا سب سے تیز راستہ ہے صارف کا کام کھونے کا۔

---

### FR-5 · مکتبہ شاملہ کا مقامی انسلاک اور درآمد

- **FR-5.1 دریافت**:
  Settings → "شاملہ لائبریری درآمد کریں" → فولڈر منتخب کریں → ایپ اسے scan کرے اور **دریافت شدہ کتابوں کی فہرست** دکھائے: عنوان، مصنف، تخمینی صفحات، اور حجم۔ کوئی خودکار scan نہیں (FR-2.3)۔

- **FR-5.2 فارمیٹ — spike کا نتیجہ (ADR-0007)**:
  ⚠️ **بنیادی مفروضہ صرف آدھا درست نکلا۔** شاملہ 4 کی SQLite فائلیں فہرست اور صفحات کا ڈھانچہ رکھتی ہیں، **مگر کتابوں کا متن ان میں ہے ہی نہیں** — وہ `database/store/page/` میں ایک **Lucene 10.4 انڈیکس** (284 MB) میں ہے، جو Java کا فارمیٹ ہے۔

  | فائل | مندرجات | پڑھنے کا ذریعہ |
  |---|---|---|
  | `database/master.db` | 8,593 کتابیں، 3,188 مصنفین، 41 تصنیفات | ✅ `better-sqlite3` |
  | `database/book/NNN/<id>.db` | `page(id, part=جلد, page=مطبوعہ صفحہ, number, services)` — **کوئی متن نہیں** | ✅ `better-sqlite3` |
  | `database/service/*.db` | حدیث، تفسیر، تراجم، 3.2M عربی جذر | ✅ `better-sqlite3` |
  | `database/store/page/` | **اصل متن** | ❌ Java + Lucene لازم |

  **فیصلہ:** فہرست اور جلد/صفحہ SQLite سے؛ متن ایک چھوٹے **Java helper** سے جو **شاملہ کے اپنے JRE** پر چلے۔ صارف کے کمپیوٹر پر دونوں پہلے سے موجود ہیں:
  - `app/win/64/jre/2/bin/java.exe` → OpenJDK 21 (تصدیق شدہ)
  - `app/lucene/2/*.jar` → Lucene 10.4 + AlKhalil عربی analyzer

  **فیصلہ ۱۱ (صفر بیرونی انحصار) بدستور پورا ہے:** صارف صرف شاملہ اور ایزی ایڈیٹر انسٹال کرے گا۔ JRE اور Lucene شاملہ دیتا ہے؛ ہماری طرف سے صرف ایک چھوٹی `.jar` installer میں جائے گی (موازنہ: `shamela-helper.jar` = 44 KB)۔

  **کتاب کی فائل کا مقام:** `book_id mod 1000` کو تین ہندسوں میں — کتاب `1001` → `book/001/1001.db`، کتاب `13000` → `book/000/13000.db`۔

  **SQLite WAL موڈ میں ہے** — `readonly` سے کھولیں مگر `immutable=1` **ہرگز نہیں**۔

  شاملہ 3 (Access/Jet) M5 میں معاون نہیں — تشخیص اسے پہچان کر صاف پیغام دے (FR-5.9 قدم ۳)۔

- **FR-5.3 Read-only، ہمیشہ**:
  شاملہ کی نصب شدہ فائلیں کبھی نہ کھلیں سوائے پڑھنے کے۔ کوئی lock، کوئی in-place ترمیم، کوئی منتقلی۔

- **FR-5.4 فی کتاب انتخاب اور پیشگی تخمینہ (اصول ۵، خطرہ R7)**:
  **کوئی "سب کچھ درآمد کریں" بٹن نہیں۔** صارف کتابیں منتخب کرے؛ منتخب مجموعے کے لیے ایک ہی ڈائلاگ میں: کل chunks، تخمینی Google ٹوکن، اور تخمینی وقت۔ تصدیق کے بغیر ایک بھی embedding کال نہ جائے۔
  ایک بڑی شاملہ لائبریری لاکھوں صفحات پر مشتمل ہو سکتی ہے — یہ پابندی صارف کے بل اور ہماری ساکھ دونوں کی حفاظت ہے۔

- **FR-5.5 حوالے کا اصل فائدہ**:
  شاملہ کے صفحات کے پاس **حقیقی کتاب/جلد/صفحہ** موجود ہوتا ہے۔ درآمد شدہ chunk کا `meta` یہ محفوظ رکھے تاکہ source card پر **"میرا کتب خانہ — شاملہ" + کتاب + جلد + صفحہ** آئے۔ **یہی M5 کا اصل علمی فائدہ ہے** — PDF سے نکالے گئے متن کے مقابلے میں یہ حوالہ قابلِ اعتماد ہے۔ کوئی جعلی URL ہرگز نہ ہو (M3 Pillar C کا معیار)۔

- **FR-5.6 موجودہ bridge کی سبکدوشی**:
  Electron موڈ میں `tools/shamela-bridge` کا بیرونی سرور اور `localShamelaService.ts` کی `localhost:8000` والی fetch **بالکل استعمال نہ ہو**۔ ویب موڈ میں یہ بدستور جوں کا توں چلتا رہے (کوئی regression نہیں)، مگر M5 کے بعد اسے سبکدوش کرنے کا راستہ صاف ہو جائے گا: نہ `D:\` کے سخت راستے، نہ CORS/PNA کے حیلے، نہ `.bat` سے دستی اجرا۔

- **FR-5.7 دوبارہ درآمد سے بچاؤ**:
  پہلے سے درآمد شدہ کتاب دوبارہ منتخب ہونے پر فہرست میں صاف نشان زد ہو ("پہلے درآمد شدہ")، اور دوبارہ embedding پر خرچ نہ ہو۔

- **FR-5.8 صفر بیرونی انحصار (ناقابلِ مذاکرہ)**:
  صارف صرف **شاملہ** اپنے کمپیوٹر پر انسٹال کرے اور **ایزی ایڈیٹر** اپنے کمپیوٹر پر۔ ایڈیٹر کے اندر **«شاملہ کے ساتھ انسلاک» کا ایک بٹن** دبانے سے دونوں جڑ جائیں۔
  ⛔ کوئی `shamela-mcp`، کوئی `.bat` فائل، کوئی الگ سرور، کوئی پورٹ، کوئی دستی ڈاؤن لوڈ۔

- **FR-5.9 تشخیصی نظام — "کیوں نہیں جڑا اور اب کیا کروں"**:
  ⛔ **صرف "انسلاک ناکام" لکھنا ممنوع ہے۔** انسلاک ایک تشخیصی رن ہے جو چھ مراحل ایک ایک کر کے جانچتا ہے اور UI میں چیک لسٹ کی صورت دکھاتا ہے:

  ```
  ۱. لائبریری فولڈر ملا       ۲. ڈیٹابیس فائلیں موجود      ۳. ورژن پہچانا گیا
  ۴. فائل پڑھی جا سکی         ۵. Java runtime ملا          ۶. schema متوقع ہے
  ۷. کتابیں موجود ہیں
  ```

  ہر ناکامی کا **اپنا پیغام اور اپنا حل** ہو:

  | قدم | ناکامی | حل کا بٹن |
  |---|---|---|
  | ۱ | شاملہ کہیں نہیں ملا | فولڈر خود منتخب کریں · ڈاؤن لوڈ کا لنک |
  | ۲ | فولڈر ملا، فائلیں نہیں | دوسرا فولڈر · مرمت کا طریقہ |
  | ۳ | شاملہ 3 (پرانا) | شاملہ 4 اپ گریڈ کا لنک |
  | ۴ | فائل قفل شدہ | شاملہ بند کر کے دوبارہ کوشش کریں |
  | ۴ | اجازت نہیں | بطور ایڈمن چلائیں · لائبریری کاپی کرنے کی ہدایت |
  | **۵** | **JRE نہ ملا** (`app/win/64/jre/`) | **شاملہ کی مرمت کریں** · اپنا Java راستہ منتخب کریں |
  | **۵** | **Lucene کا ورژن غیر متوقع** | تشخیصی رپورٹ کاپی کریں (جو ملا: 10.4، جو متوقع: …) |
  | ۶ | schema نامعلوم | تشخیصی رپورٹ کاپی کریں (جو ملا + جو متوقع تھا) |
  | ۷ | کتابیں صفر | شاملہ کھول کر کتابیں ڈاؤن لوڈ کریں |

  "دوبارہ جانچیں" کا بٹن ایپ بند کیے بغیر کام کرے۔

  ⚠️ **قدم ۵ ADR-0007 کے بعد شامل ہوا** — متن Lucene میں ہے، اس لیے JRE دونوں راستوں (A اور B) کے لیے لازم ہے، صرف درآمد کے لیے نہیں۔

- **FR-5.10 دو راستے، ایک نہیں**:
  - **راستہ A — براہِ راست پڑھائی:** پوری لائبریری میں لفظی تلاش، **embedding کی لاگت سے پاک، ہمیشہ دستیاب**۔
  - **راستہ B — ذاتی corpus میں درآمد:** صرف منتخب کتابیں؛ اس کے بعد معنوی تلاش، `citations` کا RRF چینل، Knowledge Graph، اور Recipes سب پر لاگو۔

  یہی وجہ ہے کہ «سب درآمد کریں» کا بٹن ممنوع ہے (FR-5.4): لفظی تلاش پہلے ہی پوری لائبریری پر دستیاب ہے، اس لیے 8,500 کتابوں کا embedding نہ ضروری ہے نہ عقل مندی۔

  ⚠️ **ADR-0007 کی تصحیح:** پہلے لکھا تھا کہ راستہ A "صرف SQLite" ہونے کی وجہ سے مفت ہے۔ یہ غلط تھا — تلاش کا مطلب Lucene سے پوچھنا ہے، اس لیے **Java helper دونوں راستوں کی بنیاد ہے**۔ embedding کی لاگت پھر بھی صفر رہتی ہے۔

---

### FR-6 · مقامی وائس اسٹوڈیو (Transcribe + Speak)

> M5 کا چوتھا محرک: آج TTS/STT کلاؤڈ پر ہیں اور ٹوکن لیتے ہیں (`tts_google` 50، `tts_elevenlabs` 500 فی 1K حروف، `stt` 10 فی منٹ)۔ اردو اور عربی دونوں کے لیے مقامی، مفت، آف لائن ماڈلز موجود ہیں۔

- **FR-6.1 انجن رجسٹری**:
  `src/core/voice/` میں `TtsEngine` اور `SttEngine` interfaces، بعینہٖ `getBackend()` کے نمونے پر۔ رجسٹری زبان کے حساب سے ڈیفالٹ حل کرے (`ur-PK → piper`، `ar → piper`)، صارف Settings سے بدل سکے، اور انجن دستیاب نہ ہو تو "ڈاؤن لوڈ کریں" کا صاف راستہ دکھے۔
  ⛔ `orchestration` کے کوڈ میں کوئی `if (isElectron)` نہ ہو۔

- **FR-6.2 STT — Whisper، بغیر Python**:
  [`@kutalia/whisper-node-addon`](https://github.com/Kutalia/whisper-node-addon) (MIT، Electron کے لیے prebuilt)۔ اردو، عربی، اور 99 زبانیں، **timestamps بلٹ اِن**۔
  **واحد seam:** [transcribeLongForm.ts:64](file:///e:/EasyEditor/src/lib/audio/transcribeLongForm.ts#L64) کا `functions.invoke("transcribe")`۔ اس کے اوپر کی chunking/progress/cancel منطق پہلے ہی provider سے آزاد ہے — **صرف یہ ایک کال بدلے، باقی کچھ نہ چھیڑا جائے**۔

- **FR-6.3 سب ٹائٹل ایکسپورٹ — بالکل نئی صلاحیت**:
  `.srt` اور `.vtt`، Whisper کے timestamped segments سے۔ `supportsTimestamps: false` والے انجن پر یہ بٹن **غیر فعال** ہو، خاموشی سے خالی فائل ہرگز نہ بنے۔

- **FR-6.4 TTS — Piper، بغیر Python**:
  ONNX/CPU۔ `ur_PK-male-medium` ([MIT](https://huggingface.co/IhorShevchuk/piper-voice-ur-fasih)) اور `ar_JO-kareem` ([سرکاری piper-voices](https://huggingface.co/rhasspy/piper-voices))۔

- **FR-6.5 تقسیم شدہ ترکیب (Segmented Synthesis) — اردو کے معیار کا اصل حل**:
  Piper کے اردو ماڈل کا اپنا انتباہ ہے: *"Quality may vary on mixed-language input"*۔ اور اردو علمی متن **بھرا ہی عربی اقتباسات سے ہوتا ہے** — ایک اردو VITS ماڈل «إنما الأعمال بالنيات» کا تلفظ بگاڑ دے گا۔

  اس لیے متن بولنے سے پہلے **زبان کے حساب سے ٹکڑوں میں توڑا جائے**، ہر ٹکڑا اپنے انجن کو دیا جائے، پھر آڈیو جوڑی جائے۔ تین اشارے، اسی ترتیب سے:
  1. **«…» گیمٹ** — M4 کا اپنا citation فارمیٹ عربی اقتباس کو `«arabic» — "translation" [reference]` میں لپیٹتا ہے (SPEC-v2 FR-1.4.1)۔ سب سے قابلِ اعتماد، کیونکہ ہمارا اپنا پیدا کردہ ہے۔
  2. **اردو-مخصوص حروف** — `ٹ ڈ ڑ ں ھ ے ہ ژ` (U+0679, 0688, 0691, 06BA, 06BE, 06D2, 06C1, 0698) — ان میں سے کوئی عربی میں نہیں آتا۔
  3. **عربی-مخصوص علامات** — `ة` (U+0629)، تنوین، مکمل تشکیل۔

  **موجودہ کوڈ کا خلا:** [arabicUtils.ts:36](file:///e:/EasyEditor/src/utils/arabicUtils.ts#L36) اور [textUtils.ts:5](file:///e:/EasyEditor/src/utils/textUtils.ts#L5) دونوں میں `isRtlText` ہے (نقل شدہ)، اور **دونوں عربی اور اردو میں فرق نہیں کرتے**۔ `shared/text/scriptRuns.ts` یہ فرق کرے گا اور دونوں نقلیں اسی پر متحد ہوں گی۔

- **FR-6.6 آن لائن انجن کا رضامندی گیٹ**:
  `edge-tts` ([`msedge-tts`](https://www.npmjs.com/package/msedge-tts) — Node پورٹ، Python نہیں) بہترین اردو/عربی آواز دیتا ہے مگر متن **Microsoft کی سروس** کو بھیجتا ہے۔ اس لیے:
  - پہلی بار استعمال پر ایک بار کا ڈائلاگ، **Microsoft کا نام لے کر**؛ رضامندی `corpus_meta.consents` میں محفوظ، Settings سے واپس لی جا سکے۔
  - **ڈیفالٹ انجن Piper (مقامی) رہے**۔
  - انجن مینو اور تیار آڈیو دونوں پر مستقل **"آن لائن"** بیج۔
  - ناکامی پر خودکار Piper پر واپسی + صاف پیغام؛ **خالی آڈیو ہرگز نہیں**۔

- **FR-6.7 ماڈل مینیجر**:
  ڈاؤن لوڈ، پیش رفت، منسوخی، حذف۔ **ڈاؤن لوڈ سے پہلے سائز اور جگہ کی صریح اطلاع** (Piper وائس ~60MB · Whisper `small` 466MB · `large-v3-turbo` ~1.6GB)۔
  ⛔ **کوئی ماڈل installer میں بنڈل نہ ہو** — سب runtime پر صارف کی درخواست سے۔ اس سے installer چھوٹا رہتا ہے اور repo کا لائسنس صاف۔

- **FR-6.8 ڈیسک ٹاپ پر آڈیو مکمل مفت**:
  مقامی رینڈرنگ پر ہمارا خرچ صفر ہے، اس لیے ٹوکن لینا جائز نہیں۔

- **FR-6.9 آڈیو بک ایکسپورٹ**:
  پوری دستاویز → `.mp3`، ابواب کے نشان کے ساتھ، تقسیم شدہ ترکیب کے ذریعے۔

- **FR-6.10 اردو ٹرانسکرپشن کے معیار کی صریح اطلاع**:
  اردو WER صاف آڈیو پر 10–15%، بینچ مارک ڈیٹا سیٹ پر 22–24%۔ نتیجہ UI میں **"مسودہ"** کے طور پر پیش ہو، اور انگریزی-اردو ملے جلے کلام کی معلوم خامی صارف کو پہلے سے بتائی جائے۔

- **FR-6.11 Python انجنز — اختیاری add-on، لازمی نہیں**:
  Orpheus-Urdu، MMS-TTS، Habibi (عربی)، Cohere Transcribe Arabic، اور Chatterbox سب PyTorch مانگتے ہیں۔ انہیں installer میں ڈالنے کا مطلب ہر صارف کے لیے کئی GB۔ اس لیے:
  - **بنیادی ایپ مکمل بغیر Python** (Whisper + Piper، اردو و عربی دونوں)۔
  - Settings میں الگ **"اعلیٰ درجے کی آوازیں"** پینل جو صارف کے کہنے پر Python ماحول اور منتخب ماڈل سیٹ اپ کرے۔
  - sidecar موجود نہ ہو تو رجسٹری **خاموشی سے Piper پر رہے** — کوئی error نہ دکھے۔

- **FR-6.12 وائس کلوننگ: صرف اپنی آواز**:
  لائیو enrollment سے، **تیار آڈیو فائل اپ لوڈ نہیں**۔ Orpheus (ضیاء محی الدین کے انداز پر) سے تیار ہر آڈیو پر صریح لیبل: **"نقل شدہ انداز، اصل آواز نہیں"**۔

---

## 4-الف. Non-Functional Requirements

| # | تقاضا |
|---|---|
| NFR-1 | کوئی نئی فائل 300 سطور سے تجاوز نہ کرے (M3/M4 سے برقرار) |
| NFR-2 | `npm run typecheck` · `test` · `lint` · `build` — چاروں صاف، **اور** `npm run build:electron` کامیاب |
| NFR-3 | **ویب build میں صفر regression**: M5 کے بعد ویب ایپ کا رویہ بعینہٖ M4 جیسا ہو — یہ ایک زندہ، ادائیگی شدہ پروڈکٹ ہے |
| NFR-4 | مکمل RTL: Electron کے مینو، ڈائلاگ، اور پہلی بار چلنے کا تجربہ سب اردو RTL میں درست |
| NFR-5 | **Electron کی حفاظتی بنیاد**: `contextIsolation` آن، `nodeIntegration` بند، `sandbox` آن، سخت CSP، محدود IPC allowlist (FR-2.2) |
| NFR-6 | **BYOK key کی حفاظت**: key کبھی renderer، `localStorage`، logs، یا کسی crash report میں نہ آئے (FR-3.1، FR-3.9) |
| NFR-7 | **Adapter کی حد ESLint سے نافذ** ہو، صرف دستاویزی نہ رہے (FR-1.3) |
| NFR-8 | `shared/` کا ہر ماڈیول Deno اور Node دونوں سے قابلِ لوڈ ہو — ایک ٹیسٹ اس کی تصدیق کرے (FR-1.5) |
| NFR-9 | 300 صفحات کی کتاب کی درآمد کے دوران ایڈیٹر جواب دہ رہے (M4 NFR-8 کا تسلسل) |
| NFR-10 | WCAG 2.1 AA: نئے Settings کے صفحات اور درآمد کا ڈائلاگ کی بورڈ سے مکمل قابلِ رسائی |
| NFR-11 | **کوئی telemetry نہیں**: مقامی موڈ میں Google کے سوا کوئی بیرونی network درخواست نہ جائے — سوائے `edge-tts` کے، اور وہ بھی صرف صریح رضامندی کے بعد (FR-6.6) |
| NFR-12 | **شاملہ کے لیے صفر بیرونی انحصار**: `tools/shamela-bridge/` حذف کر کے بھی ڈیسک ٹاپ کا انسلاک کام کرے (FR-5.8) |
| NFR-13 | **وائس: بغیر Python مکمل**: Python add-on انسٹال کیے بغیر Transcribe اور Speak دونوں اردو اور عربی میں مکمل کام کریں (FR-6.11) |
| NFR-14 | **کوئی ماڈل installer میں نہیں**: بنیادی installer ≤ ~200MB رہے؛ ہر ماڈل runtime پر صارف کی درخواست سے (FR-6.7) |

---

## 4. تکنیکی ڈیزائن

### 4.1 دو موڈ، ایک codebase

```
                       ┌──────────────── React renderer (بلا تبدیلی) ────────────────┐
                       │  pages · components · lib/tasks · lib/corpus · lib/graph    │
                       └───────────────────────────┬────────────────────────────────┘
                                                   │  getBackend()
                            ┌──────────────────────┴──────────────────────┐
                            ▼                                             ▼
                  cloudBackend.ts                                 localBackend.ts
                  (Supabase + edge fns)                           (IPC → Electron main)
                            │                                             │
                            ▼                                             ▼
                  Postgres + pgvector                          SQLite + sqlite-vec
                  Gemini via edge (ہمارا بل)                    Gemini براہِ راست (صارف کا بل)
                            │                                             │
                            └──────────────────┬──────────────────────────┘
                                               ▼
                                        shared/ (خالص TS)
                              prompts · chunking · rank fusion · constants
```

**سب سے اہم نکتہ:** اوپر کی پوری ایپ کو یہ معلوم نہ ہو کہ وہ کس موڈ میں ہے۔ `if (isElectron)` صرف تین جگہ جائز ہے: `getBackend()`، nav کی فہرست (FR-2.5)، اور موڈ کا بیج (FR-2.4)۔

### 4.2 نئی فائلیں (سب ≤300 سطور)

```
electron/
  main.ts                      ونڈو، lifecycle، مینو
  preload.ts                   محدود typed API (contextBridge)
  ipc/registry.ts              چینلز کی صریح allowlist
  ipc/workspaceHandlers.ts     documents/projects/library کے handlers
  ipc/aiHandlers.ts            chat + embed درخواستیں (stream)
  ai/geminiClient.ts           براہِ راست Gemini کالز (main-only)
  ai/keyStore.ts               safeStorage سے key کا محفوظ ذخیرہ
  db/open.ts                   SQLite کا اجرا + sqlite-vec کا اندراج
  db/migrations/               ورژن شدہ schema
  db/vectorSearch.ts           match_library_chunks کا مقامی ہم معنی
  db/ingest.ts                 مقامی resumable ingest handler
  ipc/shamelaHandlers.ts       لفظی تلاش + کتاب پڑھنا
  shamela/discover.ts          لائبریری فولڈر + JRE + Lucene jars کی دریافت
  shamela/diagnose.ts          سات مرحلوں کا تشخیصی رن (FR-5.9)
  shamela/catalogue.ts         master.db + book/NNN/<id>.db — SQLite، read-only
  shamela/textHelper.ts        شاملہ کے JRE کو spawn کر کے Lucene سے متن (ADR-0007)

java/shamela-text/            چھوٹا helper (Lucene سے متن نکالنا)
  src/…                        سورس
  build.md                     jar بنانے کا اختیاری سکرپٹ — عام build کو JDK درکار نہیں
resources/shamela-text.jar    پہلے سے بنی jar، installer میں شامل
  ipc/voiceHandlers.ts         TTS/STT کی درخواستیں
  voice/whisper.ts             whisper.cpp addon
  voice/piper.ts               Piper ONNX
  voice/edgeTts.ts             msedge-tts (آن لائن)
  voice/segmentedSynthesis.ts  زبان کے حساب سے تقسیم + آڈیو جوڑ (FR-6.5)
  voice/modelManager.ts        ماڈل ڈاؤن لوڈ، پیش رفت، منسوخی، حذف
  voice/pythonSidecar.ts       اختیاری Python add-on (M5.6)

shared/
  ai/prompts/                  refine-text کے actions (Deno سے منتقل)
  ai/graphSchema.ts            extract_entities کا JSON schema
  ai/embedConstants.ts         EMBED_MODEL + EMBED_DIMS (واحد ماخذ)
  text/chunk.ts                chunking (docChunker سے مشترکہ حصہ)
  text/scriptRuns.ts           اردو/عربی/لاطینی رن کی تقسیم (FR-6.5)
  search/rankFusion.ts         RRF (Deno سے منتقل)

src/core/backend/
  types.ts                     WorkspaceBackend interface
  cloudBackend.ts              موجودہ Supabase کالز
  localBackend.ts              IPC کے ذریعے main
  index.ts                     getBackend()

src/core/voice/
  types.ts                     TtsEngine + SttEngine interfaces
  registry.ts                  زبان کے حساب سے ڈیفالٹ + دستیابی
  cloudEngines.ts              google-tts / elevenlabs / transcribe
  localEngines.ts              IPC کے ذریعے

src/lib/subtitles/
  toSrt.ts · toVtt.ts          timestamped segments سے سب ٹائٹل

src/components/settings/
  ByokKeyPanel.tsx             Gemini key کا اندراج + حالت
  ShamelaConnectPanel.tsx      «انسلاک» کا بٹن + تشخیصی چیک لسٹ (FR-5.9)
  ShamelaImportDialog.tsx      دریافت، انتخاب، تخمینہ، پیش رفت
  VoiceEnginePanel.tsx         فی زبان انجن کا انتخاب
  ModelManagerPanel.tsx        ماڈلز کا ڈاؤن لوڈ اور حذف
  AdvancedVoicesPanel.tsx      اختیاری Python add-on (M5.6)
  OnlineEngineConsentDialog.tsx  edge-tts کا رضامندی گیٹ (FR-6.6)
  LocalUsagePanel.tsx          مقامی استعمال کا شمار
```

### 4.3 اہم تکنیکی اصول

- **Adapter پہلے، Electron بعد میں**: M5.0 کے exit criteria پورے ہوئے بغیر ایک بھی Electron کی سطر نہ لکھی جائے۔ یہ ترتیب خطرہ R1 کا واحد حقیقی تدارک ہے۔
- **`shared/` میں کوئی runtime API نہیں**: یہ پابندی ہی اس ڈھانچے کو زندہ رکھے گی۔ پہلی بار جب کوئی `Deno.env` وہاں گھسے گا، مقامی build ٹوٹ جائے گی — اسی لیے NFR-8 کا ٹیسٹ لازم ہے۔
- **Embedding کا ماڈل ایک ہی جگہ سے**: `shared/ai/embedConstants.ts` واحد ماخذ؛ `_shared/embed.ts` اور Electron دونوں وہیں سے پڑھیں۔
- **پروٹوکول نہ بدلیں**: مقامی ingest میں edge کی 60 سیکنڈ کی حد نہیں، مگر `{ item_id, offset }` والا resumable پروٹوکول بہرحال برقرار رہے — یہ منسوخی اور جزوی کامیابی مفت دیتا ہے، اور ایک ہی orchestrator دونوں موڈ چلاتا ہے۔
- **`if (isElectron)` صرف تین جگہ جائز**: `getBackend()`، nav کی فہرست (FR-2.5)، اور موڈ کا بیج (FR-2.4)۔ کہیں اور یہ شرط ملے تو وہ ایک bug ہے۔
- **وائس انجن رجسٹری بھی وہی نمونہ**: `getTtsEngine(lang)` / `getSttEngine()` بعینہٖ `getBackend()` کی طرح کام کریں، تاکہ ایک ہی ذہنی نمونہ پورے codebase میں چلے۔
- **دو نئے feature flags اور ایک build target**:
  - `VITE_BYOK` (BYOK کا Settings پینل — ویب پر بھی جانچا جا سکے)
  - `VITE_LOCAL_VOICE` (مقامی وائس انجنز — FR-6)
  - Build target: `npm run build:electron` (`VITE_APP_TARGET=electron`) — یہی `getBackend()` اور nav کی فہرست کا تعین کرے۔

### 4.4 اوپن سورس پیکجنگ

- Repo کی جڑ میں `LICENSE` (آج موجود نہیں)۔ **لائسنس کا انتخاب صارف کا فیصلہ ہے** — §11 میں کھلا سوال۔
- `README.md` کی تجدید: دونوں موڈ کی وضاحت، BYOK کی ہدایات، مقامی build کے اقدامات۔
- `CONTRIBUTING.md` اور issue templates۔
- **اشاعت سے پہلے ایک جائزہ پاس لازم** (خطرہ R8): prompts، domain کی فہرستیں، receipt کی تصدیق کی منطق، اور کوئی بھی بچا ہوا راز۔ `git log -p` کی تاریخ میں گردش شدہ پرانی key کا معاملہ SPEC-v2 §9 میں پہلے سے درج ہے۔
- Release: GitHub Releases پر Windows installer + portable۔ کوئی auto-update نہیں (Non-Goal)۔

---

## 5. مراحل اور تخمینہ

| مرحلہ | کام | Flag / Target | دن |
|---|---|---|---|
| **M5.0** | **بنیاد (FR-1)** — `WorkspaceBackend` interface + `cloudBackend` (10 سروسز + 3 رسنے والے مقامات)، ESLint کا نفاذ، `shared/` کی علیحدگی، شاملہ 4 کا spike | — (بلا flag) | 4 |
| **M5.1** | **Electron شیل (FR-2)** — main/preload/renderer، حفاظتی بنیاد، IPC allowlist، Windows packaging، پہلی بار چلنے کا تجربہ | `build:electron` | 4 |
| **M5.2** | **BYOK (FR-3)** — key کا محفوظ ذخیرہ، main سے Gemini کالز، streaming کی برابری، خرچ کا ڈائلاگ، ناکامی کے پیغامات | `VITE_BYOK` | 5 |
| **M5.3** | **مقامی ذخیرہ (FR-4)** — SQLite schema + migrations، `sqlite-vec`، `localBackend` کا مکمل نفاذ، مقامی ingest، برآمد/درآمد | `build:electron` | 7 |
| **M5.4** | **شاملہ کا انسلاک + درآمد (FR-5)** — دریافت، سات مرحلوں کی تشخیص، **Java helper (ADR-0007)**، براہِ راست پڑھائی، فی کتاب انتخاب، تخمینہ، حوالے کا meta | `build:electron` | 6 |
| **M5.5** | **وائس کور، بغیر Python (FR-6)** — انجن رجسٹری، Whisper STT، Piper اردو+عربی، `scriptRuns` تقسیم شدہ ترکیب، `edge-tts` + رضامندی گیٹ، ماڈل مینیجر، `.srt`/`.vtt`، آڈیو بک | `VITE_LOCAL_VOICE` | 8 |
| **M5.6** | **وائس add-on، اختیاری Python (FR-6.11)** — sidecar سیٹ اپ، Orpheus-Urdu، MMS، Habibi، Cohere Transcribe Arabic، Chatterbox + اپنی آواز کی enrollment | `VITE_LOCAL_VOICE` | 6 |
| **M5.7** | **اوپن سورس پیکجنگ** — AGPL LICENSE، README، CONTRIBUTING، THIRD-PARTY، اشاعت سے پہلے کا جائزہ پاس، release artifacts | — | 3 |
| **M5.8** | **RTL، a11y، دستاویزات** — Electron کے مینو/ڈائلاگ کا RTL، ADR-0006/0007/0008، دستی QA | — | 2 |

**کل وقت: 45 ورکنگ دن** (M5.4 کے Java helper کی وجہ سے 43 سے بڑھا — ADR-0007)

### مراحل کی ترتیب کا منطقی جواز

1. **M5.0 سب سے پہلے اور بغیر flag**: refactor ایک زندہ، ادائیگی شدہ پروڈکٹ پر ہو رہا ہے۔ اسے تنہا، مکمل، اور تصدیق شدہ ہونا چاہیے — Electron کے کسی نئے متغیر کے بغیر۔
2. **Electron شیل اس کے بعد، BYOK سے پہلے**: خالی شیل میں key اور DB ڈالنا آسان ہے؛ الٹی ترتیب میں IPC کا ڈیزائن اندازے پر ہوگا۔
3. **BYOK مقامی DB سے پہلے**: کیونکہ مقامی ingest کو embeddings چاہئیں۔ BYOK کے بغیر M5.3 جانچا ہی نہیں جا سکتا۔
4. **شاملہ اس کے بعد**: یہ مقامی ingest پائپ لائن کا صرف ایک نیا ماخذ ہے۔ M5.3 تیار ہو تو یہ پتلی تہہ ہے۔
5. **وائس کور Python add-on سے پہلے**: تاکہ انجن رجسٹری اور ماڈل مینیجر پہلے ثابت ہو جائیں، اور sidecar صرف ان میں ایک نیا انجن ڈالے۔
6. **Python add-on الگ مرحلہ**: یہ اختیاری ہے (FR-6.11)، اس لیے M5.6 پھسل بھی جائے تو M5.7/M5.8 ship ہو سکتے ہیں۔
7. **اوپن سورس پیکجنگ آخری مگر بامعنی**: اشاعت سے پہلے کا جائزہ پاس تب ہی مفید ہے جب کوڈ اپنی حتمی شکل میں ہو۔

---

## 6. خطرات اور تدارک (Risks & Mitigation)

| # | خطرہ | شدت | تدارک |
|---|---|---|---|
| **R1** | Adapter refactor (10 سروسز + 3 رسنے والے مقامات) ایک زندہ، ادائیگی شدہ پروڈکٹ پر regression لائے | **بلند** | M5.0 میں **صرف `cloudBackend`** بنے؛ M4 کے تمام ٹیسٹ بلا ترمیم پاس ہوں؛ Electron کی ایک سطر بھی اس سے پہلے نہ لکھی جائے (FR-1.4)۔ |
| **R2** | Deno اور Node کے درمیان `_shared/` کی منطق کی نقل بن جائے اور وقت کے ساتھ الگ ہو جائے (M4 R14 کا اعادہ) | **بلند** | `shared/` runtime سے آزاد؛ `Deno.*`/`node:*`/`npm:` کی ممانعت؛ دونوں runtimes سے لوڈ کی تصدیق کرنے والا ٹیسٹ (FR-1.5، NFR-8)۔ |
| **R3** | مقامی corpus مختلف embedding ماڈل پر بن جائے اور تلاش خاموشی سے صفر نتائج دے | **بلند** | `corpus_meta` میں ماڈل + dimensions؛ عدم مطابقت پر تلاش کا صریح انکار، خاموش خالی نتیجہ ہرگز نہیں (FR-3.5)۔ |
| **R4** | BYOK key کا افشا — renderer، `localStorage`، logs، یا crash report سے | **بلند** | `safeStorage`؛ صرف main process؛ renderer کو کبھی مکمل value نہ ملے؛ logs میں redaction؛ کوئی telemetry نہیں (FR-3.1، FR-3.9، NFR-11)۔ |
| **R5** | Native ماڈیول (`better-sqlite3` / `sqlite-vec`) کا build ہر پلیٹ فارم پر ٹوٹے | **بلند** | Windows پہلے؛ prebuilt binaries؛ extension لوڈ نہ ہونے پر صریح حد کے ساتھ brute-force fallback اور صاف انتباہ (FR-4.3)۔ |
| **R6** | صارف کی شاملہ نصبات کا فارمیٹ توقع سے مختلف نکلے اور M5.4 کا ڈیزائن بے کار ہو | **بلند** | M5.0 میں **اصل نصب شدہ لائبریری پر spike**، نتیجہ ADR-0007 میں؛ کوئی درآمدی کوڈ اندازے پر نہ لکھا جائے (FR-1.6)۔ |
| **R7** | پوری شاملہ لائبریری کی درآمد صارف کا Gemini بل تباہ کر دے | **بلند** | کوئی "سب درآمد کریں" بٹن نہیں؛ فی کتاب انتخاب؛ لازمی مجموعی تخمینہ اور تصدیق (FR-5.4، اصول ۵)۔ |
| **R8** | اوپن سورس کرنے سے prompts، domain کی فہرستیں، یا کاروباری منطق بے نقاب ہو | **متوسط** | اشاعت سے پہلے ایک صریح جائزہ پاس (M5.5)؛ راز پہلے ہی repo سے باہر ہیں (SPEC-v2 Phase 0)۔ |
| **R9** | دو گھر (مقامی بمقابلہ cloud) صارف کو الجھا دیں کہ اس کا کام کہاں ہے | **متوسط** | مستقل موڈ بیج (FR-2.4)؛ کوئی خودکار منتقلی نہیں؛ صرف صریح برآمد/درآمد (FR-2.7، Non-Goal: sync)۔ |
| **R10** | مقامی موڈ میں OCR/Admin/Pricing کی غیر موجودگی کو صارف نقص سمجھے | **متوسط** | یہ سطحیں مکمل غائب ہوں (غیر فعال بٹن نہیں) + ایک وضاحتی سطر (FR-2.5)۔ **Transcribe اور Speak اب موجود ہیں** (FR-6)۔ |
| **R11** | درآمد شدہ شاملہ یا ذاتی مواد غلطی سے مشترکہ `scholarly_documents` میں چلا جائے | **بلند** | M4 R7 کی توسیع: مقامی موڈ کا کوئی راستہ کبھی مشترکہ corpus کو نہ لکھے؛ مقامی DB اور cloud کے درمیان کوئی write راستہ سرے سے موجود ہی نہ ہو۔ |
| **R12** | Electron کے bundle کا حجم اور آغاز کا وقت ناقابلِ قبول ہو | **کم** | Renderer پہلے سے bundle-analyzed اور 250 KB کے بجٹ پر ہے (SPEC-v2 Phase 5)؛ native ماڈیول صرف main میں۔ |
| **R13** | Streaming کا رویہ SSE اور IPC کے درمیان مختلف نکلے اور task orchestration ٹوٹے | **متوسط** | دونوں ایک ہی interface کے پیچھے (FR-3.3)؛ orchestration کے کوڈ میں کوئی موڈ کی شرط نہ ہو۔ |
| **R14** | SQLite کا schema ایپ کے اپڈیٹ پر ٹوٹے اور صارف کا مقامی کام ضائع ہو | **بلند** | ورژن شدہ migration رنر پہلے دن سے (FR-4.7)؛ migration سے پہلے DB فائل کی خودکار backup۔ |
| **R15** | شاملہ کا انسلاک صارف کی مشین پر ناکام ہو اور وجہ معلوم نہ ہو | **بلند** | FR-5.9 کا چھ مرحلوں والا تشخیصی نظام؛ ہر ناکامی کا اپنا پیغام **اور اپنا حل**؛ ⛔ صرف "ناکام" لکھنا ممنوع؛ تشخیصی رپورٹ کاپی کرنے کا بٹن۔ |
| **R16** | شاملہ کا schema صارفین کے درمیان مختلف نکلے | **متوسط** | ADR-0007 میں متوقع schema درج ہو؛ عدم مطابقت پر تشخیص **جو ملا اور جو متوقع تھا دونوں** دکھائے تاکہ رپورٹ سے اصل فرق معلوم ہو۔ |
| **R17** | شاملہ کھلا ہونے کی وجہ سے فائل قفل | **متوسط** | ہمیشہ `readonly: true` (مگر `immutable=1` نہیں — DB WAL موڈ میں ہے)؛ `SQLITE_BUSY` پکڑ کر "شاملہ بند کر کے دوبارہ کوشش کریں" کا صریح پیغام (FR-5.9 قدم ۴)۔ |
| **R25** | **شاملہ کا JRE نہ ملے یا Lucene کا ورژن بدل جائے** | **بلند** | ADR-0007: helper شروع ہوتے ہی Lucene کا major ورژن جانچے اور غیر متوقع ہونے پر **صریح انکار** کرے، خالی نتیجہ نہیں؛ تشخیص کا قدم ۵ صارف کو "جو ملا / جو متوقع تھا" دکھائے؛ اپنا Java راستہ منتخب کرنے کا اختیار۔ |
| **R26** | **repo میں Java toolchain کا اضافہ CI اور release کو پیچیدہ کرے** | **متوسط** | helper جان بوجھ کر بہت چھوٹی رہے (چند دسیوں KB، صرف Lucene سے متن نکالنا)؛ jar پہلے سے بنی ہوئی repo میں رکھی جائے تاکہ عام build کو JDK کی ضرورت نہ ہو؛ jar بنانے کا سکرپٹ الگ اور اختیاری ہو۔ |
| **R18** | `piper-phonemize` / `espeak-ng` کی Electron packaging نہ ہو سکے | **بلند** | **M5.5 کا پہلا دن ہی یہ spike ہو** — ناکامی پر Piper کا راستہ فوراً رد ہو، آٹھ دن خرچ کرنے کے بعد نہیں۔ |
| **R19** | Piper کا اردو معیار ناقابلِ قبول نکلے | **بلند** | M5.5 کے پہلے دن اصل متن (عربی اقتباسات سمیت) کے نمونے بنا کر سنے جائیں؛ تقسیم شدہ ترکیب (FR-6.5) ہی بنیادی بچاؤ ہے؛ پھر بھی ناکافی ہو تو Piper اختیاری رہے اور ڈیفالٹ cloud۔ |
| **R20** | تین native modules (`better-sqlite3` + whisper + piper) مل کر packaging توڑ دیں | **بلند** | سب prebuilt binaries والے؛ Windows پہلے؛ M5.3 اور M5.5 میں **الگ الگ** آزمائش تاکہ ناکامی کا سبب واضح رہے؛ `asarUnpack` کی صریح config۔ |
| **R21** | `edge-tts` کا نجی endpoint بغیر اطلاع بند ہو جائے | **متوسط** | ڈیفالٹ کبھی نہ بنے (ڈیفالٹ Piper)؛ ناکامی پر خودکار fallback + صاف پیغام؛ ایک ہی فائل میں محدود رہے تاکہ بدلنا سستا ہو (FR-6.6)۔ |
| **R22** | صارف کو معلوم نہ ہو کہ اس کا متن باہر (Microsoft کو) گیا | **متوسط** | FR-6.6 کا رضامندی گیٹ + انجن مینو اور تیار آڈیو دونوں پر مستقل "آن لائن" بیج۔ |
| **R23** | Python sidecar پورے M5 کو کھا جائے | **متوسط** | یہ **اختیاری add-on** ہے (FR-6.11) — بنیادی ایپ اس کے بغیر مکمل۔ M5.6 پھسلے تو M5.7/M5.8 پھر بھی ship ہوں۔ |
| **R24** | اردو ٹرانسکرپشن کے معیار سے صارف مایوس ہو | **کم** | FR-6.10: نتیجہ "مسودہ" کے طور پر پیش ہو؛ WER کی حقیقت (10–15% صاف آڈیو، 22–24% بینچ مارک) اور code-switching کی خامی پہلے سے بتائی جائے۔ |

---

## 7. Exit Criteria (کامیابی کے معیار)

### M5.0 — بنیاد
- [ ] `src/core/backend/` کے باہر کوئی فائل Supabase کلائنٹ import نہ کرے (FR-1.2 کی مستثنیات کے سوا)، اور **ESLint اس کی خلاف ورزی پر ناکام ہو**۔
- [ ] M4 کے تمام موجودہ ٹیسٹ **بلا ایک لفظ ترمیم** پاس ہوں۔
- [ ] ویب ایپ کا رویہ M5.0 سے پہلے اور بعد میں ناقابلِ تمیز ہو۔
- [ ] `shared/` کا ہر ماڈیول Deno اور Node دونوں سے لوڈ ہو (ٹیسٹ سے ثابت)۔
- [ ] `shared/` میں کوئی `Deno.*` / `node:*` / `npm:` / `import.meta.env` / `window` / `process` نہ ہو (grep سے تصدیق)۔
- [ ] دونوں `isRtlText` کی نقلیں `shared/text/scriptRuns.ts` پر متحد ہوں۔
- [ ] شاملہ 4 کا spike مکمل اور ADR-0007 میں درج — بشمول لائبریری فولڈر کی دریافت اور ورژن کی شناخت کا طریقہ۔

### Electron شیل + BYOK
- [ ] Windows پر installer سے نصب ہو کر ایپ کھلے، **بغیر کسی اکاؤنٹ کے**، اور ایڈیٹر میں لکھا جا سکے۔
- [ ] Gemini key درج کرنے کے بعد ایک `refine-text` رن مکمل ہو اور نتیجہ stream ہو۔
- [ ] **key کسی بھی renderer کی state، `localStorage`، یا log میں موجود نہ ہو** (دستی تصدیق: DevTools + log فائلیں)۔
- [ ] غلط key پر "غلط key"، quota ختم پر "quota"، اور rate limit پر "رفتار" — تینوں الگ پیغامات آئیں۔
- [ ] بڑے رن سے پہلے خرچ کا ڈائلاگ آئے اور تصدیق سے پہلے کوئی network درخواست نہ جائے۔
- [ ] `contextIsolation`، `nodeIntegration: false`، اور `sandbox` کی تصدیق (Electron کا security checklist صاف)۔

### مقامی ذخیرہ
- [ ] 300 صفحات کا PDF مقامی طور پر ingest ہو، پیش رفت نظر آئے، اور ایڈیٹر جواب دہ رہے۔
- [ ] `citations` کا رن مقامی corpus سے حوالہ نکالے اور source card "میرا کتب خانہ" کے بیج کے ساتھ آئے۔
- [ ] Ingest کے بیچ میں Cancel → اب تک کے chunks محفوظ → دوبارہ چلانے پر وہیں سے شروع ہو۔
- [ ] Library item حذف کرنے پر chunks اور اصل فائل دونوں ختم ہوں۔
- [ ] **مقامی موڈ میں ایپ کی کوئی network درخواست Google کے سوا کہیں نہ جائے** (network monitor سے تصدیق)۔
- [ ] برآمد → نئی مشین پر درآمد → کتب خانہ اور دستاویزات جوں کی توں۔
- [ ] `corpus_meta` کا ماڈل بدل کر تلاش چلانے پر **صریح انکار** آئے، خالی نتیجہ نہیں۔

### شاملہ
- [ ] **صفر انحصار کی تصدیق (سب سے اہم):** ایک **صاف مشین** پر صرف شاملہ 4 اور ایزی ایڈیٹر انسٹال ہوں — کوئی `shamela-mcp` نہیں، کوئی `.bat` نہیں — «انسلاک» دبانے سے جڑ جائے۔
- [ ] `tools/shamela-bridge/` کا فولڈر حذف کر کے پورا M5.4 دوبارہ آزمایا جائے → سب کام کرے۔
- [ ] **تشخیصی نظام کے ساتوں منظر ہاتھ سے پیدا کر کے جانچے جائیں** (شاملہ غیر موجود، خالی فولڈر، شاملہ 3، فائل قفل، اجازت نہیں، غلط schema، صفر کتابیں) — **ہر بار وجہ اور حل دونوں نظر آئیں**، کہیں صرف "ناکام" نہ لکھا ہو۔
- [ ] "دوبارہ جانچیں" کا بٹن ایپ بند کیے بغیر کام کرے۔
- [ ] **راستہ A:** پوری لائبریری میں لفظی تلاش چلے، **کوئی ٹوکن نہ کٹے**۔
- [ ] **راستہ B:** تین کتابیں منتخب کر کے درآمد → مجموعی تخمینے کا ایک ہی ڈائلاگ → درآمد مکمل۔
- [ ] درآمد شدہ متن پر `citations` چلانے سے source card پر **کتاب + جلد + صفحہ** آئے، کوئی جعلی URL نہ ہو۔
- [ ] شاملہ کی اصل فائلیں درآمد کے بعد بھی بعینہٖ غیر تبدیل شدہ ہوں (checksum سے تصدیق)۔
- [ ] پہلے سے درآمد شدہ کتاب دوبارہ منتخب کرنے پر نشان زد ہو اور دوبارہ خرچ نہ ہو۔

### وائس (FR-6)
- [ ] **تقسیم شدہ ترکیب کا فیصلہ کن امتحان:** ایک اردو پیراگراف جس میں «إنما الأعمال بالنيات» ہو → عربی حصہ `ar_JO-kareem` میں، اردو حصہ `ur_PK` میں، اور جوڑ ہموار۔
- [ ] 60 منٹ کی **اردو** آڈیو مکمل ٹرانسکرائب ہو، **کوئی ٹوکن نہ کٹے**، اور network بالکل خاموش رہے۔
- [ ] وہی فائل **عربی** میں → درست زبان کی شناخت۔
- [ ] `.srt` اور `.vtt` ایکسپورٹ ہوں اور VLC میں وقت کی مطابقت درست ہو۔
- [ ] پوری دستاویز → آڈیو بک `.mp3`، ابواب کے نشان کے ساتھ۔
- [ ] **`edge-tts` کا گیٹ:** پہلی بار **Microsoft کا نام لیے ہوئے** ڈائلاگ آئے؛ انکار پر Piper پر رہے اور **کوئی network درخواست نہ جائے**؛ رضامندی کے بعد ہی متن باہر جائے (network monitor سے تصدیق)۔
- [ ] **`edge-tts` کی ناکامی:** endpoint بلاک کر کے آزمائیں → خودکار Piper پر واپسی + صاف پیغام، خالی آڈیو نہیں۔
- [ ] **Python add-on انسٹال کیے بغیر:** Speak اور Transcribe مکمل کام کریں، اور "اعلیٰ آوازیں" صاف طور پر غیر دستیاب دکھے۔
- [ ] Orpheus سے تیار ہر آڈیو پر **"نقل شدہ انداز، اصل آواز نہیں"** کا لیبل موجود ہو۔
- [ ] Cohere Transcribe Arabic منتخب ہونے پر **سب ٹائٹل کا بٹن غیر فعال** ہو (اس میں timestamps نہیں)۔
- [ ] ویب ورژن پر TTS/STT بعینہٖ پہلے جیسے — کوئی regression نہیں۔

### عمومی و کوڈ کوالٹی
- [ ] `npm run typecheck && npm run test && npm run lint && npm run build` — چاروں صاف۔
- [ ] `npm run build:electron` کامیاب اور Windows artifact تیار۔
- [ ] **AGPL-3.0** کا `LICENSE`، تجدید شدہ `README.md`، `CONTRIBUTING.md`، اور `THIRD-PARTY.md` موجود؛ اشاعت سے پہلے کا جائزہ پاس مکمل۔
- [ ] ADR-0006 (backend adapter)، ADR-0007 (شاملہ کی مقامی پڑھائی)، اور ADR-0008 (مقامی وائس انجنز) لکھے اور `docs/adr/README.md` میں درج ہوں۔

---

## 8. فیصلوں کا ریکارڈ (Decisions Record)

| تاریخ | فیصلہ | وجہ |
|---|---|---|
| 2026-07-29 | **ایک ہی codebase، دو موڈ** (الگ fork نہیں) | صارف کی منظوری؛ fork کا مطلب ہر فیچر کو دو بار لکھنا اور دو بار توڑنا ہے۔ قیمت یہ ہے کہ adapter لیئر لازم ہو جاتی ہے — یہی M5.0 ہے۔ |
| 2026-07-29 | **BYOK صرف Gemini، اور کالز Electron main سے براہِ راست** | صارف کی منظوری؛ ایپ پہلے ہی Gemini پر مرکوز ہے اور `embed.ts` کا ماڈل قفل شدہ ہے۔ Main سے براہِ راست کال کا مطلب ہے renderer کبھی key نہ دیکھے۔ |
| 2026-07-29 | **مکمل مقامی SQLite + vector** (Supabase کی کوئی ضرورت نہیں) | صارف کی منظوری؛ رازداری M5 کا بنیادی محرک ہے۔ آدھا حل (ڈیٹا cloud پر، AI مقامی) اس محرک کو پورا نہیں کرتا۔ |
| 2026-07-29 | **شاملہ: موجودہ نصب شدہ لائبریری کی ایک بار درآمد** (لائیو لنک نہیں) | صارف کی منظوری؛ درآمد شدہ chunks وہی M4 پائپ لائن، وہی RRF چینل، وہی source cards استعمال کرتے ہیں — لائیو لنک ایک متوازی تلاشی نظام مانگتا۔ |
| 2026-07-29 | **Adapter کا دائرہ صرف ورک اسپیس تک** | Admin/billing/Transcribe کو adapter میں لانا M5 کو دگنا کرتا اور کوئی فائدہ نہ دیتا — یہ سطحیں مقامی موڈ میں موجود ہی نہیں۔ |
| 2026-07-29 | **Adapter کی حد ESLint سے نافذ ہوگی** | صرف دستاویزی حد چند ہفتوں میں بوسیدہ ہو جاتی ہے۔ یہ واحد جزو ہے جو refactor کو زندہ رکھے گا۔ |
| 2026-07-29 | **مقامی اور cloud کے درمیان کوئی sync نہیں** | Conflict resolution اکیلا ایک milestone ہے؛ M5 میں اسے شامل کرنا باقی سب کو خطرے میں ڈالنا ہے۔ برآمد/درآمد 95% ضرورت پوری کرتا ہے۔ |
| 2026-07-29 | **`shared/` runtime سے آزاد رہے گا** | M4 خطرہ R14 کا سبق: نقل شدہ منطق ہمیشہ الگ ہو جاتی ہے۔ Deno اور Node کا مشترکہ ذخیرہ ہی واحد پائیدار حل ہے۔ |
| 2026-07-29 | **کوئی "پوری شاملہ درآمد کریں" بٹن نہیں** | ایک کلک میں صارف کا Gemini بل ہزاروں ڈالر تک جا سکتا ہے۔ اصول ۵ یہاں سب سے زیادہ نازک ہے۔ |
| 2026-07-29 | **Windows پہلے** | صارف کا ہدف پلیٹ فارم؛ macOS پر code signing اور notarization ایک الگ لاگت اور CI کا مسئلہ ہے۔ |
| 2026-07-29 | **auto-update M5 میں نہیں** | `electron-updater` + code signing کا پورا ڈھانچہ M5 کے وزن میں مزید اضافہ ہے؛ GitHub Releases سے دستی ڈاؤن لوڈ پہلے ورژن کے لیے کافی ہے۔ |
| 2026-07-29 | **صارف کی اپنی Recipe (M4 کا وعدہ) M6 کو منتقل** | M5 پہلے ہی ساختی طور پر بھاری ہے؛ Recipe authoring اس سے مکمل غیر متعلق ہے اور اسے M5 میں ٹھونسنے کا کوئی فائدہ نہیں۔ |
| 2026-07-29 | **لائسنس: AGPL-3.0** | صارف کی منظوری؛ ویب ورژن ایک ادائیگی شدہ پروڈکٹ ہے، اس لیے کوئی اسے بند-سورس SaaS بنا کر نہ بیچ سکے۔ |
| 2026-07-29 | **پورا repo اوپن سورس، Admin/billing سمیت** | صارف کی منظوری؛ "ایک ہی codebase" کے فیصلے کا منطقی نتیجہ۔ راز پہلے ہی repo سے باہر ہیں؛ اشاعت سے پہلے ایک جائزہ پاس کافی ہے۔ |
| 2026-07-29 | **ڈیسک ٹاپ پر وہی برانڈ نام** | صارف کی منظوری؛ دو برانڈ سنبھالنے کی ضرورت نہیں، اور دونوں ایک دوسرے کو مشتہر کرتے ہیں۔ |
| 2026-07-29 | **شاملہ 4 (SQLite) ہدف** | صارف کی مشین پر شاملہ 4 نصب ہے؛ spike کا دائرہ نمایاں طور پر تنگ ہو گیا۔ Access/Jet کا راستہ M5 میں نہیں۔ |
| 2026-07-29 | **شاملہ کے لیے صفر بیرونی انحصار — ایک بٹن** | صارف کی صریح شرط (FR-5.8)؛ `shamela-mcp`، `.bat`، اور localhost سرور تینوں ختم۔ ناکامی پر وجہ **اور** حل دونوں دکھانا لازم (FR-5.9)۔ |
| 2026-07-29 | **شاملہ کا متن ایک چھوٹے Java helper سے پڑھا جائے گا، شاملہ کے اپنے JRE پر** ([ADR-0007](./adr/0007-shamela-native-read.md)) | spike میں معلوم ہوا کہ متن SQLite میں نہیں بلکہ Lucene 10.4 انڈیکس میں ہے۔ Lucene کے codec کو TypeScript میں دوبارہ لکھنا ورژن کے ساتھ ٹوٹتا ہے اور غلطی کی صورت میں **بگڑا ہوا عربی** دیتا ہے، error نہیں — حوالہ جات کے آلے کے لیے بدترین ناکامی۔ اپنا JRE بنڈل کرنا 40MB+ کا اضافہ ہے۔ شاملہ اپنا JRE اور Lucene دونوں ساتھ لاتا ہے، اس لیے صارف پر کوئی نیا بوجھ نہیں۔ |
| 2026-07-29 | **مقامی وائس اسٹوڈیو M5 میں شامل** (نیا FR-6) | آج TTS/STT ٹوکن لیتے ہیں؛ اردو اور عربی دونوں کے لیے مقامی مفت ماڈلز موجود ہیں۔ Transcribe اور Speak اب Electron موڈ میں **موجود** ہوں گے۔ |
| 2026-07-29 | **وائس: صرف بغیر-Python انجنز بنیادی ایپ میں** | Whisper (whisper.cpp) اور Piper (ONNX) دونوں اردو + عربی دیتے ہیں بغیر PyTorch/CUDA۔ Python والے انجنز اختیاری add-on (FR-6.11)۔ |
| 2026-07-29 | **کوئی ماڈل installer میں بنڈل نہیں** | installer چھوٹا رہتا ہے، اور CC-BY-NC جیسے لائسنس والے ماڈلز صارف کی درخواست پر ڈاؤن لوڈ ہونے سے repo کا AGPL لائسنس صاف رہتا ہے۔ |
| 2026-07-29 | **ڈیسک ٹاپ پر آڈیو مکمل مفت** | مقامی رینڈرنگ پر ہمارا خرچ صفر ہے، اس لیے ٹوکن لینا جائز نہیں۔ یہی ڈیسک ٹاپ کا سب سے مضبوط سیلنگ پوائنٹ بھی ہے۔ |
| 2026-07-29 | **`edge-tts` شامل، مگر رضامندی گیٹ کے پیچھے** | بہترین اردو/عربی آواز دیتا ہے مگر آف لائن نہیں۔ ڈیفالٹ کبھی نہ بنے؛ Microsoft کا نام لے کر ایک بار کی رضامندی لازم (FR-6.6)۔ |
| 2026-07-29 | **وائس کلوننگ صرف اپنی آواز، لائیو enrollment سے** | صارف کی منظوری؛ کسی عالم کی آواز میں جعلی درس یا فتویٰ بننا اس پروڈکٹ کے لیے سنگین خطرہ ہے۔ |
| 2026-07-29 | **Kokoro، VibeVoice، Qwen3-TTS، VoxCPM2، OmniVoice رد** | تصدیق پر کوئی بھی اردو نہیں بولتا (§12)؛ VibeVoice تو صرف انگریزی/چینی ہے اور Microsoft کا صریح انتباہ موجود ہے۔ |

---

## 9. مفروضات (Assumptions)

1. **صارف کے پاس اپنی Gemini API key ہوگی اور وہ Google کو براہِ راست ادائیگی کرے گا۔** ایپ key حاصل کرنے کا راستہ نہیں بناتی، صرف واضح ہدایات دیتی ہے۔
2. **`sqlite-vec` 768-جہتی float32 vectors کو ذاتی corpus کے پیمانے پر (چند لاکھ chunks تک) قابلِ قبول رفتار سے سنبھالے گا۔** M5.3 میں اس کی پیمائش ہوگی؛ ناکامی پر FR-4.3 کا fallback۔
3. ~~**ہدف شاملہ 4 ہے، جو SQLite پر مبنی ہے۔**~~ **✅ جانچا گیا (ADR-0007) — اور صرف آدھا درست نکلا:** فہرست اور صفحات کا ڈھانچہ SQLite میں ہے، مگر **متن Lucene 10.4 میں**۔ اب مفروضہ یہ ہے کہ **ہر شاملہ 4 نصب کے ساتھ اس کا اپنا JRE اور Lucene jars آتے ہیں** (اس مشین پر تصدیق شدہ: OpenJDK 21، Lucene 10.4.0)۔ اگر کسی صارف کے ہاں یہ نہ ہوں تو تشخیص کا قدم ۵ اسے صاف پکڑے گا۔ شاملہ 3 (Access/Jet) M5 میں معاون نہیں (FR-5.9 قدم ۳)۔
4. **مقامی موڈ کا صارف واحد صارف ہے۔** کوئی multi-user، کوئی RLS، کوئی اشتراک — ایک مشین، ایک فائل۔
5. **ویب کے موجودہ ادائیگی شدہ صارفین Electron پر منتقل نہیں ہوں گے۔** یہ دو مختلف سامعین ہیں؛ اسی لیے sync کی عدم موجودگی قابلِ قبول ہے۔
6. **Electron کا main process تمام بھاری کام (embedding، ingest، SQLite، وائس) سنبھالے گا** اور renderer صرف UI رہے گا۔
7. **درآمد شدہ شاملہ مواد صارف کی اپنی نصب شدہ کاپی سے آتا ہے** اور اس کی مشین سے کبھی باہر نہیں جاتا — نہ ہمارے سرور پر، نہ مشترکہ corpus میں (خطرہ R11)۔
8. **Piper کا اردو ماڈل قابلِ قبول معیار دے گا** — یہ M5.5 کے پہلے دن کا فیصلہ کن spike ہے۔ ناکامی پر تقسیم شدہ ترکیب (FR-6.5) بچاؤ ہے؛ وہ بھی ناکافی ہو تو Piper اختیاری رہے گا اور ڈیفالٹ cloud (خطرہ R19)۔
9. **صارف کے پاس ماڈلز ڈاؤن لوڈ کرنے کے لیے ڈسک کی جگہ اور ایک بار کا انٹرنیٹ ہوگا** — Piper وائس ~60MB، Whisper `large-v3-turbo` ~1.6GB۔ ڈاؤن لوڈ سے پہلے صریح اطلاع لازم (FR-6.7)۔

---

## 10. تصدیق (Verification)

```bash
npm run typecheck && npm run test && npm run lint && npm run build && npm run build:electron
```

دستی جانچ کے مراحل (ہر ایک لازمی):

0. **(M5.0 کے بعد)** ویب ایپ کی مکمل smoke: دستاویز بنائیں، AI رن چلائیں، کتاب اپلوڈ کریں، entity نکالیں، Recipe چلائیں → **سب کچھ M4 جیسا**۔
1. Windows پر installer چلائیں → ایپ کھلے **بغیر اکاؤنٹ کے** → ایک دستاویز لکھیں اور بند کر کے دوبارہ کھولیں۔
2. Gemini key درج کریں → `spelling_check` چلائیں → نتیجہ stream ہو۔ پھر DevTools اور log فائلوں میں key تلاش کریں → **کہیں نہ ملے**۔
3. غلط key ڈالیں → صاف "غلط key" کا پیغام (عمومی error نہیں)۔
4. 300 صفحات کا PDF درآمد کریں → خرچ کا ڈائلاگ → پیش رفت → درمیان میں Cancel → دوبارہ چلائیں → وہیں سے جاری ہو۔
5. اسی کتاب کے موضوع پر `citations` چلائیں → مقامی source card "میرا کتب خانہ" کے بیج کے ساتھ آئے۔
6. **صاف مشین پر** (صرف شاملہ 4 + ایزی ایڈیٹر، کوئی `shamela-mcp` نہیں): «شاملہ کے ساتھ انسلاک» دبائیں → جڑ جائے۔
7. تشخیصی نظام کے ساتوں ناکام منظر ہاتھ سے پیدا کریں → ہر بار **وجہ + حل** دونوں نظر آئیں۔
8. کتابوں کی فہرست → تین منتخب کریں → مجموعی تخمینہ → درآمد → حوالے میں **کتاب + جلد + صفحہ**۔
9. شاملہ کی اصل فائلوں کا checksum درآمد سے پہلے اور بعد میں لیں → **یکساں**۔
10. مقامی موڈ میں پورا سیشن چلائیں اور network monitor دیکھیں → **Google کے سوا کوئی درخواست نہ ہو** (`edge-tts` کی رضامندی نہ دی ہو تو وہ بھی نہیں)۔
11. `corpus_meta` کا ماڈل ہاتھ سے بدل کر تلاش چلائیں → صریح انکار آئے، خالی نتیجہ نہیں۔
12. کتب خانہ برآمد کریں → دوسری مشین پر درآمد → دستاویزات اور کتابیں جوں کی توں۔
13. مقامی موڈ میں nav دیکھیں → **OCR/Admin/Pricing غائب** ہوں (غیر فعال نہیں)، مگر **Transcribe اور Speak موجود** ہوں۔
14. اردو پیراگراف (جس میں عربی اقتباس ہو) پر Speak چلائیں → عربی حصہ عربی وائس میں، اردو حصہ اردو وائس میں، جوڑ ہموار۔
15. 60 منٹ کی اردو آڈیو ٹرانسکرائب کریں → مکمل ہو، **کوئی ٹوکن نہ کٹے** → `.srt` ایکسپورٹ کر کے VLC میں وقت کی مطابقت جانچیں۔
16. `edge-tts` منتخب کریں → Microsoft کے نام والا رضامندی ڈائلاگ آئے → انکار کریں → Piper پر رہے اور **کوئی network درخواست نہ جائے**۔
17. Python add-on **انسٹال کیے بغیر** Speak اور Transcribe دونوں اردو اور عربی میں چلا کر دیکھیں → مکمل کام کریں۔
18. ڈیسک ٹاپ RTL: Electron کے مینو، انسلاک کا پینل، درآمد کا ڈائلاگ، وائس کے پینل، اور Settings — سب اردو میں درست۔

---

## 11. کھلے سوالات

**کوئی باقی نہیں۔** پچھلے تینوں سوالات (لائسنس، Admin/billing کی شمولیت، برانڈنگ) §8 میں فیصلہ شدہ ہیں۔

---

## 12. ضمیمہ — وائس ماڈلز کا تصدیق شدہ حوالہ

> یہ جدول اصل ذرائع (ماڈل کارڈز اور repos) سے تصدیق شدہ ہے۔ **دو تجویزی دستاویزات میں کیے گئے اردو/عربی سپورٹ کے اکثر دعوے غلط نکلے** — نیا ماڈل شامل کرنے سے پہلے اس کے سرکاری ماڈل کارڈ سے زبان کی فہرست خود جانچیں۔

### M5.5 میں — بغیر Python

| ماڈل | لائسنس | اردو | عربی | نوٹ |
|---|---|---|---|---|
| **Whisper large-v3** ([addon](https://github.com/Kutalia/whisper-node-addon)) | MIT | ✅ | ✅ | timestamps بلٹ اِن — سب ٹائٹل کی بنیاد |
| **Piper `ur_PK-male-medium`** | [MIT](https://huggingface.co/IhorShevchuk/piper-voice-ur-fasih) | ✅ | — | ONNX/CPU، medium، کمیونٹی ماڈل |
| **Piper `ar_JO-kareem`** | MIT | — | ✅ | [سرکاری piper-voices](https://huggingface.co/rhasspy/piper-voices) |
| **`edge-tts`** ([msedge-tts](https://www.npmjs.com/package/msedge-tts)) | GPL-3.0 | ✅ | ✅ | **آن لائن** — FR-6.6 کے رضامندی گیٹ کے پیچھے |

### M5.6 میں — اختیاری Python add-on

| ماڈل | لائسنس | اردو | عربی | نوٹ |
|---|---|---|---|---|
| Orpheus-Urdu | HF | ✅ | — | GPU؛ لازمی "نقل شدہ انداز" کا لیبل (FR-6.12) |
| MMS-TTS `urd-script_arabic` | `cc-by-nc-4.0` | ✅ | ✅ | سادہ/روبوٹک؛ بنڈل نہیں، صارف ڈاؤن لوڈ کرے |
| Habibi | CC-BY-4.0 | — | ✅ | [ACM MM 2026](https://arxiv.org/pdf/2601.13802)؛ متحد عربی لہجے |
| [Cohere Transcribe Arabic](https://huggingface.co/blog/CohereLabs/cohere-transcribe-arabic-07-2026-release) | Apache 2.0 | ❌ | ✅ | انسانی جانچ میں Whisper پر 96% ترجیح۔ ⚠️ **timestamps نہیں** — سب ٹائٹل کا بٹن غیر فعال رہے |
| Chatterbox | MIT | ❌ | ✅ | اپنی آواز کی کلوننگ |

### جانچے گئے اور رد کیے گئے

| ماڈل | وجہ |
|---|---|
| Kokoro / Kitten | 9 زبانیں (انگریزی، ہسپانوی، فرانسیسی، ہندی، اطالوی، جاپانی، پرتگالی، چینی) — نہ اردو نہ عربی |
| VibeVoice-1.5B | **صرف انگریزی/چینی**؛ Microsoft کا صریح انتباہ: دیگر زبانیں "unintelligible or offensive" |
| Qwen3-TTS (اوپن سورس) | 10 زبانیں؛ عربی صرف *hosted* Qwen-Audio-3.0-TTS میں ہے جو اوپن سورس نہیں |
| VoxCPM2 | 30 زبانیں، اردو شامل نہیں |
| OmniVoice | 600+ کا دعویٰ مگر اردو غیر تصدیق شدہ؛ نیز PyTorch + GPU لازم، کوئی CPU/ONNX راستہ نہیں |
| Qwen3-ASR | اردو غیر تصدیق شدہ؛ timestamps الگ ForcedAligner ماڈل سے (صرف 11 زبانیں) — Whisper پر کوئی فائدہ نہیں |
| Meta MMS بطور بنیادی انجن | `cc-by-nc-4.0` اور روبوٹک لہجہ؛ add-on کے طور پر رکھا گیا، ڈیفالٹ نہیں |

**اردو TTS کی مجموعی حالت:** `mms-tts-urd`، `orpheus-urdu-tts`، `Guy-Urdu-TTS`، `zohann/urdu-tts`، `ahmedHanzala/urdu-tts` — **سب کمیونٹی فائن ٹیون ہیں؛ کسی بڑی لیب کا معیاری اردو TTS موجود نہیں۔** Piper کا `ur_PK-male-medium` واحد MIT + ONNX + بغیر-Python آپشن ہے۔

### M6 کا اسٹریٹجک امیدوار — اپنی اردو آواز

[`ylacombe/finetune-hf-vits`](https://github.com/ylacombe/finetune-hf-vits) کے مطابق VITS/MMS کو **80–150 نمونوں اور ~20 منٹ** میں فائن ٹیون کیا جا سکتا ہے، اور **VITS → ONNX → Piper** کا راستہ آزمودہ ہے (Piper خود VITS پر ہے)۔

کسی اچھے قاری یا مقرر کی اجازت سے چند سو جملے ریکارڈ کروا کر ایسی اردو آواز بنائی جا سکتی ہے جو ہر دستیاب اوپن سورس ماڈل سے بہتر ہو، مکمل ہماری ملکیت ہو، MIT پر جاری کی جا سکے، اور صارف کے **CPU پر آف لائن** چلے۔

**اضافی فائدہ:** ریکارڈنگ سکرپٹ میں عربی اقتباسات جان بوجھ کر شامل کیے جائیں تو ماڈل وہی کمزوری سیکھ کر ٹھیک کر لے گا جو FR-6.5 کی تقسیم شدہ ترکیب کو حل کرنی پڑ رہی ہے۔

M5 میں شامل نہیں (یہ ڈیٹا اکٹھا کرنے کا کام ہے، کوڈ کا نہیں)، مگر M5.5 کا Piper راستہ اسی کی بنیاد رکھ دیتا ہے — وہی loader، وہی ONNX، صرف وزن بدلیں گے۔
