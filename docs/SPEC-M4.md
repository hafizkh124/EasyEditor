# SPEC-M4 — ذاتی کتب خانہ، Knowledge Graph، اور Recipes

**حیثیت:** تجویز شدہ · **ورژن:** 4.0.0 · **تاریخ:** 2026-07-28
**برانچ:** `newee` → feature flags کے پیچھے ہفتہ وار `main`
**تخمینہ:** 22–28 ورکنگ دن (7 مراحل) · **پیش شرط:** M3 مکمل ✅
**فیصلے:** §8 میں درج (صارف سے منظور شدہ)

---

## 1. سیاق + رہنما اصول

M1 نے دستاویز کو وجود دیا، M2 نے تین ستونوں کا ورک اسپیس بنایا، اور M3 نے ایڈیٹر کے اندر AI کا اصل تجربہ کھڑا کیا: Task Library، Bubble/Slash مینو، Trust UI، اور Chunking۔ **M3 کی تصدیق ہو چکی ہے** — `npm run typecheck` صاف اور 25 فائلوں کے 162 ٹیسٹ کامیاب۔

مگر آج کی ایپ میں ایک بنیادی خلا باقی ہے: **AI صرف اُس علم تک محدود ہے جو `scholarly_documents` کے مشترکہ corpus میں ہے۔ صارف کی اپنی کتابیں، اپنے مسودے، اپنے OCR شدہ اوراق — ان میں سے کچھ بھی AI کے سامنے نہیں۔** `library_items` کا ٹیبل M1 میں بن گیا تھا، M3 میں اس کا Sources ٹیب بھی بن گیا ([libraryItemService.ts:8](file:///e:/EasyEditor/src/core/workspace/libraryItemService.ts#L8))، مگر **اس میں کچھ لکھنے کا کوئی راستہ آج تک موجود نہیں** — یعنی وہ ٹیب ساخت کے اعتبار سے مکمل اور مندرجات کے اعتبار سے خالی ہے۔

کوڈ کے جائزے سے تین دریافتیں M4 کی ساخت متعین کرتی ہیں:

1. **Embedding کا پورا ڈھانچہ پہلے سے تیار اور آزمودہ ہے** — `pgvector`، `vector(768)`، `gemini-embedding-001` کا واحد canonical embedder ([_shared/embed.ts:17](file:///e:/EasyEditor/supabase/functions/_shared/embed.ts#L17))، `embedBatch()` کی 100 فی کال بلک سہولت، اور `match_scholarly_documents` کا نمونہ RPC ([scholarly_documents.sql:91](file:///e:/EasyEditor/supabase/migrations/20260406000000_scholarly_documents.sql#L91))۔ **ذاتی کتب خانہ کوئی نیا فن تعمیر نہیں مانگتا — صرف اسی نمونے کی ایک per-user نقل۔**
2. **PDF/DOCX سے متن نکالنے کا کوڈ پہلے سے موجود مگر ایک ہی فنکشن میں دفن ہے** — `research-query/index.ts` کا `fetchFileContent` ([~L84](file:///e:/EasyEditor/supabase/functions/research-query/index.ts#L84))۔ اسے `_shared/` میں نکالے بغیر M4 اسی منطق کی دوسری نقل بنانے پر مجبور ہوگا۔
3. **RRF (Reciprocal Rank Fusion) کثیر چینل تلاش کے لیے پہلے سے موجود ہے** ([rankFusion.ts:20](file:///e:/EasyEditor/supabase/functions/_shared/rankFusion.ts#L20))، اور اس کا صریح ڈیزائن یہ ہے کہ **خالی چینل نتیجے کو بگاڑے بغیر کچھ نہ دے**۔ اس لیے "میری کتابیں" ایک تیسرے چینل کے طور پر بغیر کسی calibration کے شامل ہو سکتی ہیں۔

### 1.1 پانچ رہنما اصول (M3 §1.1 سے برقرار)

M4 کے تمام فیصلے انہی پانچ اصولوں پر پرکھے جائیں گے:

1. **Cognitive Continuity (سیاق نہ ٹوٹے)**
2. **Workbench on Demand (تیسرا ستون ضرورت پر)**
3. **عالِم اجازت دیتا ہے، ہم نہیں (صارف کا حتمی اختیار)**
4. **دکھاؤ کہ کہاں سے آیا (شفافیت)**
5. **کوئی خاموش خرچ نہیں (پیشگی مالی اطلاع)**

M4 میں ان کا سب سے اہم اطلاق: **ذاتی کتب خانے کا کوئی chunk کبھی کسی دوسرے صارف کو نہ ملے (اصول ۴ کی رازداری والی جہت)، اور entity کا کوئی خودکار ضم (merge) صارف کی اجازت کے بغیر نہ ہو (اصول ۳)۔**

---

## 2. Non-Goals (M4 میں شامل نہیں)

- **مکمل خودکار Agents (کھلا ہدف)**: صارف ہدف لکھے اور LLM خود اقدامات طے کرے — **نہیں**۔ M4 میں صرف طے شدہ Recipes (§FR-4)۔ فیصلہ §8 میں درج۔
- **Proactive AI (Level 4)**: لکھتے وقت خودکار تجاویز — M5+۔
- **Graph visualization (نوڈ اور کنارے کا بصری نقشہ)**: M4 میں entity کارڈز اور backlinks کی فہرست ہوگی، کوئی force-directed گراف نہیں۔
- **Entity کا خودکار ضم (auto-merge)**: صرف تجویز، فیصلہ صارف کا۔
- **ایڈیٹر کے اندر Entity کا inline node view یا نیا mark**: M3 FR-4.5.3 کی پابندی برقرار — دستاویز کے schema میں کوئی تبدیلی نہیں (سوائے FR-1.3 کے annotation mark کے، جس کی الگ شرائط ہیں)۔
- **Scanned PDF کا OCR کتب خانے کے اندر**: سکین شدہ PDF پر متن نہ ملنے کی صورت میں صارف کو `/ocr` صفحے کی طرف بھیجا جائے گا (مفروضہ §9.1)۔
- **کتب خانے کا اشتراک (Sharing) یا ٹیم corpus**: تمام ذاتی chunks سختی سے owner-only۔
- **Real-time collaboration، Yjs**: بدستور خارج۔
- **`scholarly_documents` کے مشترکہ corpus میں صارف کا ڈیٹا ڈالنا**: ذاتی مواد ہمیشہ الگ ٹیبل میں رہے گا (خطرہ R7)۔

---

## 3. Functional Requirements

### FR-1 · M4.0 — M3 کے بقایا اور استحکام (بغیر flag، سب سے پہلے)

- **FR-1.1 `summarize_sections` (M3 §9 مفروضہ ۱ کا وعدہ)**:
  `summarize` آج `chunkable: false` ہے ([registry.ts:70](file:///e:/EasyEditor/src/lib/tasks/registry.ts#L70)) — درست فیصلہ، کیونکہ پیراگراف بہ پیراگراف خلاصہ پوری دستاویز کا خلاصہ نہیں بنتا۔ M4 میں **الگ task `summarize_sections`** شامل ہوگی جو `docChunker` کی heading-aware تقسیم استعمال کر کے **ہر باب/عنوان کا اپنا خلاصہ** بنائے گی اور `applyMode: "append"` کے ذریعے ہر حصے کے آخر میں (یا ایک مجتمع "خلاصہ" دستاویز میں) لکھے گی۔ `summarize` بدستور صرف منتخب متن پر چلے گی۔

- **FR-1.2 Reload کے بعد رن کا Resume (M3 §9 مفروضہ ۲)**:
  `task_runs` میں `status` اور `progress` JSONB پہلے سے موجود ہیں ([m3_tasks.sql:5](file:///e:/EasyEditor/supabase/migrations/20260728000001_m3_tasks.sql#L5))۔ M4 میں:
  - رن شروع ہوتے وقت `input.doc_hash` (دستاویز کے `plain_text` کا hash) اور `input.batch_plan` (ہر batch کے حروف کی گنتی) محفوظ ہوں گے۔
  - Workspace کھلنے پر اگر اسی دستاویز کا کوئی `status IN ('pending','running')` رن ملے تو `TaskRunCard` "نامکمل رن" کی صورت میں ظاہر ہو، جس پر دو بٹن ہوں: **"باقی ماندہ پر جاری رکھیں"** اور **"چھوڑ دیں"**۔
  - **جاری رکھنا صرف اُس وقت پیش کیا جائے گا جب `doc_hash` بدلا نہ ہو**۔ اگر دستاویز بدل چکی ہے تو صرف "چھوڑ دیں" یا "نئے سرے سے چلائیں" کے اختیارات ہوں گے — کوئی اندازہ لگا کر ادھوری جگہ پر لکھنے کی کوشش نہیں ہوگی (M3 FR-5.2 کی روح)۔

- **FR-1.3 حاشیہ نوٹس (Annotations)**:
  `annotations` ٹیبل M1 میں بن چکا ہے ([workspace_core.sql:57](file:///e:/EasyEditor/supabase/migrations/20260728000000_workspace_core.sql#L57)) اور آج تک کہیں استعمال نہیں ہوا۔ M4 میں:
  - ایک سادہ `annotation` **mark** (صرف `annotationId` رکھنے والا) `buildEditorExtensions()` میں شامل ہوگا — **لازم ہے کہ یہ اسی مشترکہ فہرست میں ہو، ورنہ `applyResult.ts` کا `generateJSON` اسے نہ پہچان کر گرا دے گا**۔
  - Canvas کے کنارے نوٹس کی فہرست؛ منتخب متن پر "نوٹ لگائیں"۔
  - **Orphan handling:** اگر کسی chunked AI رن نے نشان زدہ متن بدل دیا اور mark ختم ہو گیا، تو نوٹ **حذف نہیں ہوگا** بلکہ "منقطع" (detached) کے طور پر فہرست میں محفوظ رہے گا، اپنے اصل اقتباس کے ساتھ (اصول ۳)۔

- **FR-1.4 NFR-1 کی خلاف ورزیوں کا ازالہ**:
  `RichEditor.tsx` (570 سطور) اور `EditorToolbar.tsx` (366 سطور) دونوں 300 کی حد سے تجاوز کر چکے ہیں۔ انہیں chunked-run کی منطق (`useChunkedTaskRun`)، ٹول بار کے گروپس، اور خالص presentational اجزاء میں تقسیم کیا جائے — کوئی رویہ تبدیل کیے بغیر، اور M3 کے تمام ٹیسٹ بلا ترمیم پاس رہیں۔

- **FR-1.5 M3 کی دستی QA کی تکمیل**:
  SPEC-M3 §10 کے آٹھوں دستی مراحل (60,000 حرفی دستاویز، batch 5 پر cancel، 40 batches بغیر 429، تینوں flags بند) M4 کا کوئی نیا فیچر شروع کرنے سے پہلے مکمل اور دستاویز شدہ ہوں۔

---

### FR-2 · Pillar E — ذاتی کتب خانہ (Personal Corpus RAG)

- **FR-2.1 اپلوڈ**:
  Library کے `Sources` ٹیب سے PDF / DOCX / TXT / MD اپلوڈ۔ فائل نئے `library-files` bucket میں `{user_id}/{item_id}.{ext}` کے راستے پر (نجی bucket، owner-only storage policy — `research-files` کا موجودہ نمونہ)۔ ہر اپلوڈ پر `library_items` میں قطار (`kind`، `title`، `storage_path`)۔

- **FR-2.2 متن نکالنے کی منطق کا اشتراک**:
  `research-query` کے `fetchFileContent` کے اندر دفن PDF/DOCX نکالنے والا کوڈ نئی `supabase/functions/_shared/fileText.ts` میں منتقل ہوگا، اور `research-query` بھی وہیں سے کال کرے گا۔ **کوئی دوسری نقل نہیں بنے گی۔**

- **FR-2.3 نیا `library_chunks` ٹیبل**:
  `scholarly_documents` کا per-user ہم شکل: `content`، `language`، `embedding VECTOR(768)`، `library_item_id`، `chunk_index`، `char_start/char_end`، `meta`۔ RLS **owner-only** (`auth.uid() = user_id`)۔

- **FR-2.4 `match_library_chunks` RPC**:
  `match_scholarly_documents` کا ہم شکل، مگر ایک بنیادی فرق کے ساتھ: یہ **`SECURITY INVOKER`** ہوگا (یعنی `SECURITY DEFINER` **ہرگز نہیں**)، تاکہ RLS خودبخود ہر صارف کو صرف اس کی اپنی سطریں دے۔ اختیاری فلٹر: `filter_item_ids`، `filter_project_id`۔

- **FR-2.5 نیا `library-ingest` edge function (قابلِ استیناف / resumable)**:
  Supabase edge functions کی ~60 سیکنڈ کی حد ایک 400 صفحاتی PDF کو ایک ہی کال میں embed نہیں ہونے دیتی۔ اس لیے **M3/M4 کا وہی آزمودہ نمونہ: کلائنٹ سائیڈ orchestration، سرور سائیڈ stateless batches** (ADR 0001 اور ADR 0004 کا تسلسل، نیا ADR 0005):
  - ہر کال: `{ item_id, offset }` → زیادہ سے زیادہ 100 chunks (ایک `embedBatch` کال) → `{ inserted, next_offset, done }`۔
  - کلائنٹ `chunkOrchestrator` کے نمونے پر پیش رفت، منسوخی، اور جزوی کامیابی سنبھالے گا۔
  - **صارف کی شناخت صرف JWT سے (`auth.uid()`) لی جائے گی — body کے `user_id` کو ہرگز تسلیم نہ کیا جائے** (M3 FR-2.5 / R10 کا وہی اصول: یہ فنکشن Service Role کے ساتھ چلتا ہے)۔
  - حالت `library_items.meta.ingest` میں: `pending → extracting → embedding → ready | failed` + `progress`۔
  - Chunking: ~1200 حروف فی chunk، ~150 حروف overlap، جملوں کی حد پر توڑ (`docChunker` کی اردو/عربی خاتمہ علامتوں والی regex دوبارہ استعمال ہو)۔

- **FR-2.6 خرچ کی شفافیت (اصول ۵)**:
  اپلوڈ کے بعد ingest شروع ہونے سے **پہلے** ڈائلاگ: تخمینی chunks، تخمینی ٹوکن، اور موجودہ بیلنس۔ بیلنس ناکافی ہو تو کوئی network درخواست نہ جائے (M3 کا `SolvencyDialog` دوبارہ استعمال)۔

- **FR-2.7 تلاش اور حوالہ (اصل قدر یہی ہے)**:
  - Workbench کے `Research` ٹیب میں نیا مأخذ سوئچ: **"میری کتابیں"**۔
  - `citations` task میں ذاتی کتب خانہ ایک **تیسرا RRF چینل (`personal`)** بنے گا۔ چونکہ RRF صرف رینک دیکھتا ہے، اس چینل کے خالی ہونے پر نتیجہ بعینہٖ آج جیسا رہے گا (کوئی regression نہیں)۔
  - **Source cards پر واضح امتیاز لازم ہے**: ذاتی مأخذ پر "میرا کتب خانہ" کا بیج + کتاب کا عنوان + مقام، اور کوئی جعلی عوامی URL نہیں (M3 Pillar C کا معیار: "کوئی source card ایسا URL نہ دکھائے جو corpus نے نہ دیا ہو")۔
  - `evaluateKifayatGate` ([citationEngine.ts:636](file:///e:/EasyEditor/supabase/functions/_shared/citationEngine.ts#L636)) بدستور confidence کا واحد ذریعہ رہے گا۔

- **FR-2.8 OCR / Transcribe کا پل مکمل کرنا (M2 FR-2.4 کا وعدہ)**:
  `/ocr` اور `/transcribe` کے مکمل نتائج پر **"کتب خانے میں محفوظ کریں"** کا بٹن، جو `library_items` (`kind: 'ocr' | 'audio'`) بنا کر اسی ingest پائپ لائن میں ڈال دے۔ یہی ان صفحات کے ورک اسپیس میں ضم ہونے کا اگلا قدم ہے۔

- **FR-2.9 حذف کی سالمیت**:
  `library_item` حذف ہونے پر: `library_chunks` (FK `ON DELETE CASCADE`) **اور** storage کی اصل فائل — دونوں حذف ہوں۔ کوئی یتیم object یا یتیم embedding باقی نہ رہے۔

---

### FR-3 · Pillar F — Knowledge Graph / Entity Cards

- **FR-3.1 دو نئے ٹیبل**:
  - `entities`: `kind ∈ ('person','book','term','place')`، `canonical_name`، `name_ar`، `name_ur`، `aliases TEXT[]`، `summary`، `meta`، owner-only RLS۔
  - `entity_mentions`: `entity_id` + (`document_id` یا `library_chunk_id`) + `snippet` + `created_at` — یہی backlinks کی بنیاد ہے۔

- **FR-3.2 استخراج بطورِ Task**:
  نئی task `extract_entities` (`engine: "refine-text"`، `chunkable: true`، `producesSources: false`، `applyMode` کوئی نہیں — یہ **دستاویز میں کچھ نہیں لکھتی**)۔ سرور پر `actionPrompts` میں نیا additive action شامل ہوگا جو سخت JSON لوٹائے۔ **NFR-7 کی پاسداری: پرانے کلائنٹ متاثر نہ ہوں۔**
  - چونکہ یہ دستاویز میں کچھ نہیں لکھتی، اس پر M3 کا AI Review (Track Changes) والا بلاک (FR-5.8) لاگو نہیں ہوگا۔

- **FR-3.3 Entity Resolution — خودکار ضم ممنوع**:
  اردو/عربی ناموں کی یکسانیت (مثلاً «ابن تیمیہ» / «ابن تیمیۃ» / «احمد بن عبد الحلیم») مشین کے لیے سب سے مشکل مسئلہ ہے اور غلط ضم علمی لحاظ سے مہنگی غلطی ہے۔ اس لیے:
  - نارملائزیشن: `stripHarakat` + `arabicUtils` کی موجودہ نارملائزیشن + alias کی مطابقت۔
  - مماثل نام ملنے پر صرف **"ممکنہ ڈپلیکیٹ"** کی تجویز دکھائی جائے گی؛ ضم کا بٹن صارف دبائے گا (اصول ۳)۔
  - ضم ناقابلِ واپسی نہ ہو: ضم شدہ نام `aliases` میں محفوظ رہیں تاکہ الگ کرنا ممکن رہے۔

- **FR-3.4 Entity Cards UI**:
  - Workbench کا **چھٹا ٹیب `entities`** (آئیکن-only)۔ آج پانچ ٹیبز `grid-cols-5` پر ہیں ([WorkbenchPanel.tsx:45](file:///e:/EasyEditor/src/components/workspace/WorkbenchPanel.tsx#L45))؛ چھٹے کے ساتھ 320px پر جگہ تنگ ہو جاتی ہے، اس لیے **360px سے کم چوڑائی پر آخری ٹیبز ایک "مزید" (overflow) مینو میں سمٹ جائیں گے** (خطرہ R8)۔
  - کارڈ کے مندرجات: نام (اردو + عربی)، قسم، مختصر تعارف، **backlinks** ("یہ نام آپ کی 3 دستاویزات اور 2 کتابوں میں آیا")، اور متعلقہ entities۔
  - Backlink پر کلک → متعلقہ دستاویز Canvas میں کھلے اور اُس مقام تک scroll ہو (صفحہ دوبارہ لوڈ کیے بغیر — M2 FR-2.2)۔

- **FR-3.5 ایڈیٹر کے schema میں کوئی تبدیلی نہیں**:
  Entities دستاویز کے متن میں کوئی node view، decoration، یا نیا mark شامل نہیں کریں گی (M3 FR-4.5.3 برقرار)۔ Entity کی نمائش صرف Workbench کے پینل میں ہے۔

- **FR-3.6 ذاتی کتب خانے سے استخراج**:
  `extract_entities` صرف دستاویزات پر نہیں، `library_chunks` پر بھی چل سکے گی — یہی Pillar E اور Pillar F کو ایک دوسرے کے قابلِ استعمال بناتا ہے۔

---

### FR-4 · Pillar G — Recipes (محدود Level 3)

> **فیصلہ (§8):** کھلے ہدف والے خودکار ایجنٹ کے بجائے **طے شدہ، قابلِ پیش گوئی، اور پیشگی قیمت شدہ Recipes**۔ LLM قدم منتخب نہیں کرتا؛ قدم پہلے سے لکھے ہوئے ہیں۔

- **FR-4.1 `RecipeDefinition` کا ڈھانچہ**:
  ```typescript
  export interface RecipeStep {
    taskSlug: string;                              // رجسٹر کی موجودہ task
    input: "document" | "selection" | "previousOutput";
    optional?: boolean;                            // ناکامی پر رن نہ رکے
  }
  export interface RecipeDefinition {
    slug: string;
    labelKey: string;
    defaultLabel: string;
    steps: RecipeStep[];                           // 2–4 قدم
    surfaces: ("slash" | "library" | "toolbar")[]; // "bubble" نہیں — یہ دستاویزی عمل ہے
  }
  ```

- **FR-4.2 تین Built-in Recipes**:
  1. `polish_document` — `normalize_script` → `spelling_check` → `auto_format`
  2. `cite_and_summarize` — `citations` → `summarize_sections`
  3. `prepare_lecture` — `summarize_sections` → `formalize`

- **FR-4.3 کوئی dynamic planning نہیں**: صارف کو کھلا ہدف لکھنے کا خانہ نہیں دیا جائے گا؛ Recipes کلائنٹ کے TS رجسٹر میں ہوں گی (بعینہٖ M3 کے `registry.ts` کا فیصلہ)۔ M4 میں صارف اپنی Recipe نہیں بنا سکے گا (M5 کا امیدوار)۔

- **FR-4.4 ایک ہی pre-flight ڈائلاگ**:
  تمام قدموں کے batches اور ٹوکن کا **مجموعی** تخمینہ ایک ہی ڈائلاگ میں (M3 کا `SolvencyDialog`)۔ تصدیق سے پہلے ایک بھی network درخواست نہ جائے (M3 FR-5.11 کی توسیع)۔

- **FR-4.5 عمل درآمد `chunkOrchestrator` کے اوپر**:
  ہر قدم M3 کے موجودہ orchestrator سے گزرے گا — یعنی 2.4s کا throttle floor ([chunkOrchestrator.ts:27](file:///e:/EasyEditor/src/lib/tasks/chunkOrchestrator.ts#L27))، cancel، اور جزوی کامیابی سب مفت ملیں گے۔ **کوئی متوازی (parallel) قدم نہیں** — 30/منٹ کی حد مشترکہ ہے۔

- **FR-4.6 ناکامی کا رویہ (fail-stop)**:
  کسی قدم کے مکمل ناکام ہونے پر اگلا قدم **شروع نہیں ہوگا** (کیونکہ اگلا قدم پچھلے کے نتیجے پر چلتا ہے)۔ اب تک لاگو شدہ کام محفوظ رہے گا اور کارڈ پر "قدم 2 از 3 پر رکا" دکھایا جائے گا۔ `optional: true` والا قدم اس سے مستثنیٰ ہے۔

- **FR-4.7 `task_runs` میں nested ریکارڈ**:
  والد قطار `task_slug = 'recipe:<slug>'` اور ہر قدم کی اپنی قطار `input.parent_run_id` کے ساتھ۔ Trust ٹیب اسے **ایک قابلِ کھلنے والے گروپ** کی صورت میں دکھائے گا (تین الگ الگ بے ربط قطاروں کی صورت میں نہیں)۔

- **FR-4.8 پورے Recipe کا Undo**:
  `TaskRunCard` پر "پورا Recipe واپس لیں" — تمام قدموں کے تمام transactions الٹے ترتیب سے ریورس ہوں (M3 FR-5.9 کی توسیع)۔

- **FR-4.9 AI Review کے ساتھ تعارض**:
  M3 FR-5.8 کی طرح، AI Review (Track Changes) آن ہونے پر Recipe کا رن **شروع ہی نہ ہو**۔

---

## 4-الف. Non-Functional Requirements

| # | تقاضا |
|---|---|
| NFR-1 | کوئی نئی فائل 300 سطور سے تجاوز نہ کرے — **اور M4.0 میں `RichEditor.tsx` + `EditorToolbar.tsx` کی موجودہ خلاف ورزی بھی ختم ہو** |
| NFR-2 | `npm run typecheck` · `npm run test` · `npm run lint` · `npm run build` — چاروں مکمل صاف |
| NFR-3 | مکمل RTL: Sources ٹیب، ingest کی پیش رفت، Entity کارڈز، Recipe ڈائلاگ — 360px اور ڈیسک ٹاپ دونوں پر |
| NFR-4 | WCAG 2.1 AA: Entity کارڈ اور backlink کی بورڈ سے قابلِ رسائی؛ ہر آئیکن-only ٹیب پر `aria-label` |
| NFR-5 | **رازداری کی سخت ضمانت**: ذاتی chunk کی ہر واپسی RLS سے گزرے؛ کوئی `SECURITY DEFINER` RPC ذاتی مواد نہ لوٹائے؛ کوئی edge function body کے `user_id` پر بھروسا نہ کرے |
| NFR-6 | تینوں نئے feature flags بند ⇒ ایپ بعینہٖ M3 کے رویے پر چلے |
| NFR-7 | Edge functions کی تبدیلیاں additive ہوں (پرانے کلائنٹ چلتے رہیں) |
| NFR-8 | 300 صفحات کی کتاب کا ingest صارف کے ایڈیٹر کو جام نہ کرے (پس منظر میں، پیش رفت کے ساتھ، منسوخ ہو سکنے والا) |

---

## 4. تکنیکی ڈیزائن

### 4.1 دیتابیس مائیگریشن (`supabase/migrations/2026XXXX_m4_corpus_entities.sql`)

```sql
-- 1. ذاتی کتب خانے کے chunks (scholarly_documents کا per-user ہم شکل)
CREATE TABLE public.library_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  library_item_id UUID NOT NULL REFERENCES public.library_items(id) ON DELETE CASCADE,
  chunk_index     INT  NOT NULL,
  content         TEXT NOT NULL,
  language        TEXT NOT NULL DEFAULT 'ur',
  char_start      INT,
  char_end        INT,
  embedding       VECTOR(768),          -- gemini-embedding-001 @ 768 (embed.ts کے مطابق)
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (library_item_id, chunk_index)
);
ALTER TABLE public.library_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own chunks" ON public.library_chunks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_library_chunks_item ON public.library_chunks(library_item_id, chunk_index);

-- IVFFlat انڈیکس صرف سطریں آنے کے بعد بنے (scholarly_documents.sql:64 کی وہی احتیاط):
--   CREATE INDEX library_chunks_embedding_idx ON public.library_chunks
--     USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 2. match RPC — SECURITY INVOKER (RLS لاگو رہے؛ DEFINER ہرگز نہیں)
CREATE OR REPLACE FUNCTION public.match_library_chunks(
  query_embedding VECTOR(768),
  match_threshold FLOAT DEFAULT 0.6,
  match_count     INT   DEFAULT 8,
  filter_item_ids UUID[] DEFAULT NULL
) RETURNS TABLE (
  id UUID, library_item_id UUID, chunk_index INT, content TEXT,
  language TEXT, meta JSONB, similarity FLOAT
) LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT id, library_item_id, chunk_index, content, language, meta,
         1 - (embedding <=> query_embedding) AS similarity
  FROM public.library_chunks
  WHERE embedding IS NOT NULL
    AND (filter_item_ids IS NULL OR library_item_id = ANY(filter_item_ids))
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
GRANT EXECUTE ON FUNCTION public.match_library_chunks(VECTOR(768), FLOAT, INT, UUID[]) TO authenticated;

-- 3. Knowledge Graph
CREATE TABLE public.entities (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('person','book','term','place')),
  canonical_name TEXT NOT NULL,
  name_ar        TEXT,
  name_ur        TEXT,
  aliases        TEXT[] NOT NULL DEFAULT '{}',
  summary        TEXT,
  meta           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, canonical_name)
);
CREATE TABLE public.entity_mentions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_id        UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  document_id      UUID REFERENCES public.documents(id) ON DELETE CASCADE,
  library_chunk_id UUID REFERENCES public.library_chunks(id) ON DELETE CASCADE,
  snippet          TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (document_id IS NOT NULL OR library_chunk_id IS NOT NULL)
);
-- دونوں پر owner-only RLS + handle_updated_at trigger (M3 کا وہی نمونہ)

-- 4. storage bucket: library-files (نجی، owner-only policies)
```

### 4.2 نئی فائلیں (سب ≤300 سطور)

```
supabase/functions/
  _shared/fileText.ts          PDF/DOCX/TXT سے متن (research-query سے نکالا ہوا مشترکہ کوڈ)
  _shared/personalCorpus.ts    match_library_chunks کی کال + RRF چینل کی تیاری
  library-ingest/index.ts      resumable ingest: { item_id, offset } -> { next_offset, done }

src/lib/corpus/
  chunkText.ts                 عام متن کا chunker (~1200 حروف، 150 overlap)
  ingestOrchestrator.ts        کلائنٹ سائیڈ ingest orchestration (chunkOrchestrator کا نمونہ)
  libraryChunkService.ts       library_chunks کی سروس

src/lib/tasks/
  recipes.ts                   RecipeDefinition + تین built-in recipes
  runRecipe.ts                 قدم بہ قدم عمل درآمد (chunkOrchestrator کے اوپر)

src/lib/entities/
  entityService.ts             entities + entity_mentions CRUD
  entityResolve.ts             نارملائزیشن اور "ممکنہ ڈپلیکیٹ" کی تجویز

src/components/workspace/
  SourceUploadDialog.tsx       اپلوڈ + خرچ کی تصدیق
  IngestProgressCard.tsx       ingest کی پیش رفت اور منسوخی
  EntitiesTab.tsx              Workbench کا چھٹا ٹیب
  EntityCard.tsx               ایک entity کا کارڈ + backlinks
  RecipeRunDialog.tsx          Recipe کا مجموعی pre-flight ڈائلاگ
  AnnotationList.tsx           حاشیہ نوٹس کی فہرست (منقطع نوٹس سمیت)

src/components/editor/
  AnnotationMark.ts            سادہ annotation mark (buildEditorExtensions میں شامل)
```

### 4.3 اہم تکنیکی اصول

- **`embed.ts` واحد embedder رہے گا**: `library-ingest` اور query دونوں `gemini-embedding-001 @ 768` استعمال کریں گے۔ ماڈل بدلنے کا مطلب پورے ذاتی corpus کی دوبارہ embedding ہے — کوئی بھی نئی کال براہِ راست Google کو نہ جائے، ہمیشہ `_shared/embed.ts` سے گزرے (اسی فائل کے تبصرے میں درج پرانی غلطی کا اعادہ نہ ہو)۔
- **RRF چینل additive ہے**: `personal` چینل خالی ہونے پر نتیجہ آج جیسا ہی رہے — یہی اس ڈیزائن کا سب سے بڑا فائدہ ہے۔
- **Recipes نئی AI منطق نہیں**: یہ صرف موجودہ tasks کی ترتیب ہے۔ اگر Recipe کے لیے نیا prompt لکھنا پڑ رہا ہے تو وہ دراصل ایک نئی task ہے، Recipe نہیں۔
- **تین نئے Feature Flags**:
  - `VITE_PERSONAL_CORPUS` (اپلوڈ، ingest، "میری کتابیں" چینل)
  - `VITE_KNOWLEDGE_GRAPH` (entities ٹیب، `extract_entities`)
  - `VITE_RECIPES` (Recipes)

---

## 5. مراحل اور تخمینہ

| مرحلہ | کام | Flag | دن |
|---|---|---|---|
| **M4.0** | **بقایا و استحکام (FR-1)** — `summarize_sections`، رن کا resume، حاشیہ نوٹس، `RichEditor`/`EditorToolbar` کی تقسیم، M3 کی دستی QA | — (بلا flag) | 3 |
| **M4.1** | **Corpus کی بنیاد** — `library-files` bucket، `_shared/fileText.ts` کی علیحدگی، `library_chunks` + RPC مائیگریشن، `library-ingest`، کلائنٹ orchestrator، خرچ کا ڈائلاگ | `VITE_PERSONAL_CORPUS` | 5 |
| **M4.2** | **Corpus کی تلاش** — `personal` RRF چینل، Research ٹیب کا "میری کتابیں" سوئچ، `citations` میں شمولیت، Source cards کا بیج، OCR/Transcribe کا پل (FR-2.8) | `VITE_PERSONAL_CORPUS` | 3 |
| **M4.3** | **Entities کا استخراج** — `extract_entities` سرور action + task، `entities`/`entity_mentions` مائیگریشن، `entityResolve` اور ڈپلیکیٹ کی تجویز | `VITE_KNOWLEDGE_GRAPH` | 4 |
| **M4.4** | **Entity Cards UI** — چھٹا Workbench ٹیب، کارڈ، backlinks، overflow مینو | `VITE_KNOWLEDGE_GRAPH` | 3 |
| **M4.5** | **Recipes** — `recipes.ts`، `runRecipe`، مجموعی pre-flight، nested `task_runs`، پورے Recipe کا Undo | `VITE_RECIPES` | 4 |
| **M4.6** | **موبائل، RTL، a11y، دستاویزات** — 360px جانچ، ADR-0005، README کی تازہ کاری | — | 2 |

**کل وقت: 24 ورکنگ دن (تخمینہ 22–28 دن)**

### مراحل کی ترتیب کا منطقی جواز

1. **M4.0 سب سے پہلے اور بغیر flag**: M3 کا بقایا اور NFR-1 کی خلاف ورزی نئے کوڈ کی بنیاد بننے سے پہلے ختم ہو۔
2. **Corpus (E) سب سے پہلے**: Knowledge Graph کی اصل قدر تب ہے جب استخراج کے لیے صارف کی اپنی کتابیں موجود ہوں؛ اور Recipes کی `citations` والی Recipe بھی corpus کے ساتھ زیادہ بامعنی ہے۔
3. **Entities (F) اس کے بعد**: `library_chunks` موجود ہوں تو FR-3.6 (کتابوں سے استخراج) بغیر انتظار کے بن جاتا ہے۔
4. **Recipes (G) آخر میں**: یہ سب سے پتلی تہہ ہے (موجودہ tasks کی ترتیب)، اور اس کا فائدہ تب سب سے زیادہ ہے جب `summarize_sections` (M4.0) اور corpus والی `citations` (M4.2) دونوں تیار ہوں۔

---

## 6. خطرات اور تدارک (Risks & Mitigation)

| # | خطرہ | شدت | تدارک |
|---|---|---|---|
| **R1** | Edge function کی ~60s حد پر بڑی کتاب کا ingest بیچ میں ٹوٹ جائے | **بلند** | Resumable `{ item_id, offset }` پروٹوکول + کلائنٹ orchestration؛ ہر کال زیادہ سے زیادہ 100 chunks (FR-2.5)۔ |
| **R2** | ذاتی chunk کسی دوسرے صارف کو مل جائے (رازداری کی خلاف ورزی) | **بلند** | `match_library_chunks` کا `SECURITY INVOKER` ہونا + owner-only RLS + edge function میں `user_id` صرف JWT سے (NFR-5)۔ |
| **R3** | خراب PDF extraction سے بے معنی chunks اور اس بنا پر جھوٹے حوالے | **بلند** | Ingest سے پہلے نکالے گئے متن کا preview دکھانا؛ حروف کی کم شرح پر انتباہ اور `/ocr` کی طرف رہنمائی؛ ذاتی مأخذ کا source card ہمیشہ "میرا کتب خانہ" کے بیج کے ساتھ (FR-2.7)۔ |
| **R4** | Embedding کی لاگت خاموشی سے صارف کا بیلنس کھا جائے | **بلند** | اپلوڈ کے بعد، ingest سے پہلے لازمی خرچ کا ڈائلاگ؛ بیلنس ناکافی ہو تو کوئی درخواست نہ جائے (FR-2.6، اصول ۵)۔ |
| **R5** | غلط entity merge سے دو مختلف علماء ایک ہو جائیں | **بلند** | خودکار ضم ممنوع؛ صرف تجویز؛ ضم کے بعد بھی `aliases` محفوظ رہیں (FR-3.3)۔ |
| **R6** | `personal` چینل شامل کرنے سے موجودہ حوالہ جات کے نتائج بگڑ جائیں | **متوسط** | RRF صرف رینک دیکھتا ہے اور خالی چینل کچھ نہیں دیتا؛ flag بند ہونے پر چینل بالکل شامل ہی نہ ہو (NFR-6)۔ |
| **R7** | ذاتی مواد غلطی سے مشترکہ `scholarly_documents` میں چلا جائے | **بلند** | ذاتی مواد کے لیے بالکل الگ ٹیبل اور الگ RPC؛ `library-ingest` کبھی `scholarly_documents` میں نہ لکھے (Non-Goal)۔ |
| **R8** | 320px موبائل پر Workbench کے چھ ٹیب نہ سما سکیں | **متوسط** | 360px سے کم پر آخری ٹیبز "مزید" مینو میں (FR-3.4)۔ |
| **R9** | Recipe کے دو یا تین قدم مل کر 30/منٹ کی حد توڑ دیں | **متوسط** | قدم ہمیشہ ترتیب وار (کوئی parallel نہیں)؛ ہر قدم M3 کے 2.4s throttle floor سے گزرے (FR-4.5)۔ |
| **R10** | Recipe کے بیچ میں ناکامی سے دستاویز نصف حالت میں رہ جائے | **متوسط** | Fail-stop + "قدم 2 از 3 پر رکا" کی صریح اطلاع + پورے Recipe کا Undo (FR-4.6، FR-4.8)۔ |
| **R11** | Chunked رن حاشیہ نوٹس کے marks مٹا دے | **متوسط** | نوٹ حذف نہ ہو، "منقطع" کے طور پر اپنے اصل اقتباس کے ساتھ محفوظ رہے (FR-1.3)۔ |
| **R12** | Resume کا فیچر بدلی ہوئی دستاویز پر غلط جگہ لکھ دے | **متوسط** | `doc_hash` نہ ملنے پر resume کی پیشکش ہی نہ ہو (FR-1.2)۔ |
| **R13** | IVFFlat انڈیکس خالی ٹیبل پر بننے سے تلاش سست رہے | **کم** | انڈیکس صرف سطریں آنے کے بعد بنے؛ مائیگریشن میں تبصرے کی صورت میں، `scholarly_documents.sql:64` کی وہی احتیاط۔ |
| **R14** | `research-query` سے extraction کا کوڈ نکالتے وقت موجودہ تحقیقی فائل اپلوڈ ٹوٹ جائے | **متوسط** | `_shared/fileText.ts` بالکل وہی رویہ دے؛ منتقلی سے پہلے اس کے لیے ٹیسٹ لکھے جائیں۔ |

---

## 7. Exit Criteria (کامیابی کے معیار)

### M4.0 — بقایا و استحکام
- [ ] 60,000 حرفی دستاویز پر `summarize_sections` چلے اور **ہر عنوان کا اپنا خلاصہ** بنے۔
- [ ] chunked رن کے دوران صفحہ reload کرنے پر "نامکمل رن" کا کارڈ آئے؛ دستاویز نہ بدلی ہو تو "جاری رکھیں" کام کرے، بدل چکی ہو تو یہ اختیار **ظاہر ہی نہ ہو**۔
- [ ] حاشیہ نوٹ لگا کر اسی متن پر AI رن چلانے سے نوٹ "منقطع" کے طور پر باقی رہے، غائب نہ ہو۔
- [ ] `RichEditor.tsx` اور `EditorToolbar.tsx` سمیت **کوئی فائل 300 سطور سے زیادہ نہ ہو**۔
- [ ] SPEC-M3 §10 کے آٹھوں دستی مراحل مکمل اور دستاویز شدہ۔

### Pillar E — ذاتی کتب خانہ
- [ ] 300 صفحات کا PDF اپلوڈ ہو کر مکمل ingest ہو، پیش رفت نظر آئے، اور ایڈیٹر جواب دیتا رہے۔
- [ ] ingest کے بیچ میں Cancel دبانے سے اب تک کے chunks محفوظ رہیں اور حالت `failed` کے بجائے صاف طور پر نامکمل درج ہو۔
- [ ] `citations` کا رن ذاتی کتاب سے حوالہ نکالے، اور اس کے source card پر **"میرا کتب خانہ" + کتاب کا عنوان** ہو، کوئی جعلی URL نہ ہو۔
- [ ] `VITE_PERSONAL_CORPUS` بند کرنے پر حوالہ جات کے نتائج بعینہٖ M3 جیسے ہوں۔
- [ ] **دو مختلف صارف اکاؤنٹس سے جانچ**: صارف A کا کوئی chunk صارف B کی کسی تلاش میں کبھی ظاہر نہ ہو۔
- [ ] library item حذف کرنے پر اس کے تمام chunks اور storage کی فائل — دونوں ختم ہوں۔

### Pillar F — Knowledge Graph
- [ ] ایک علمی مضمون پر `extract_entities` چلانے سے اشخاص، کتب، اور اصطلاحات الگ الگ اقسام میں درج ہوں۔
- [ ] Entity کارڈ پر backlinks درست ہوں، اور کلک سے متعلقہ دستاویز Canvas میں کھلے۔
- [ ] «ابن تیمیہ» اور «ابن تیمیۃ» **خودکار طور پر ضم نہ ہوں**، بلکہ "ممکنہ ڈپلیکیٹ" کی تجویز آئے۔
- [ ] `extract_entities` دستاویز کے متن میں ایک حرف بھی تبدیل نہ کرے۔
- [ ] `VITE_KNOWLEDGE_GRAPH` بند ہو تو Workbench پر پانچ ہی ٹیب رہیں۔

### Pillar G — Recipes
- [ ] `polish_document` تینوں قدم ترتیب وار چلائے، اور **ایک ہی** pre-flight ڈائلاگ میں مجموعی لاگت دکھائے۔
- [ ] 40+ batches کے مجموعی Recipe رن میں ایک بھی HTTP 429 نہ آئے۔
- [ ] دوسرے قدم کو ناکام کرنے پر تیسرا قدم شروع ہی نہ ہو، اور پہلے قدم کا کام محفوظ رہے۔
- [ ] "پورا Recipe واپس لیں" پورے رن سے پہلے کی حالت بحال کرے۔
- [ ] Trust ٹیب Recipe کو **ایک گروپ** کی صورت میں دکھائے، بکھری قطاروں کی صورت میں نہیں۔

### عمومی و کوڈ کوالٹی
- [ ] تینوں نئے feature flags بند کرنے پر ایپ بعینہٖ M3 جیسی چلے۔
- [ ] `npm run typecheck && npm run test && npm run lint && npm run build` — چاروں صاف۔
- [ ] ADR-0005 (resumable client-orchestrated ingest) لکھا اور `docs/adr/README.md` میں درج ہو۔

---

## 8. فیصلوں کا ریکارڈ (Decisions Record)

| تاریخ | فیصلہ | وجہ |
|---|---|---|
| 2026-07-28 | M4 کا دائرہ: ذاتی کتب خانہ + Knowledge Graph + Recipes + M3 کے بقایا | صارف کی منظوری؛ چاروں مل کر AI کو صارف کے اپنے علم تک رسائی دیتے ہیں۔ |
| 2026-07-28 | Agents کھلے ہدف کے بجائے **طے شدہ Recipes** | صارف کی منظوری؛ M3 کے "محدود authoring" فلسفے کا تسلسل — قابلِ پیش گوئی، پیشگی قیمت شدہ، اور مکمل قابلِ واپسی۔ |
| 2026-07-28 | ذاتی corpus بالکل الگ ٹیبل (`library_chunks`) میں | مشترکہ `scholarly_documents` میں ذاتی مواد ملانا رازداری اور RLS دونوں کے لیے ناقابلِ قبول خطرہ ہے۔ |
| 2026-07-28 | `match_library_chunks` کا `SECURITY INVOKER` ہونا | `SECURITY DEFINER` RLS کو نظرانداز کر دیتا ہے — ذاتی مواد پر یہ ایک ہی غلطی پورے کتب خانے کو بے نقاب کر سکتی ہے۔ |
| 2026-07-28 | Ingest کلائنٹ سے orchestrate ہوگا، سرور stateless رہے گا | ADR 0001 (آڈیو) اور ADR 0004 (متن) دونوں پر یہی نمونہ کامیاب رہا؛ edge کی 60s حد کا سب سے سستا حل۔ |
| 2026-07-28 | Entity کا خودکار ضم ممنوع | عربی/اردو ناموں کی مماثلت دھوکہ دہ ہے؛ غلط ضم علمی ساکھ کو نقصان پہنچاتا ہے (اصول ۳)۔ |
| 2026-07-28 | Graph کی بصری نمائش (نوڈ/کنارے) M4 میں نہیں | اصل قدر backlinks اور کارڈ میں ہے؛ بصری گراف بڑی لاگت اور کم فائدہ۔ |
| 2026-07-28 | `summarize` بدستور غیر chunkable، الگ `summarize_sections` بنے گی | ایک ہی task کا دو مختلف معنوں میں استعمال صارف کے لیے مبہم اور نتیجے کے لحاظ سے غلط ہوتا۔ |
| 2026-07-28 | حاشیہ نوٹ کے لیے mark لازماً `buildEditorExtensions()` میں | ورنہ `applyResult.ts` کا `generateJSON` اسے نہ پہچان کر ہر AI رن پر خاموشی سے گرا دے گا۔ |
| 2026-07-28 | Resume صرف `doc_hash` ملنے پر | بدلی ہوئی دستاویز پر اندازے سے لکھنا M3 FR-5.2 کے "کوئی فرضی اندازہ نہیں" اصول کی خلاف ورزی ہے۔ |

---

## 9. مفروضات (Assumptions)

1. **سکین شدہ (تصویری) PDF کا متن نہیں نکلے گا**: extraction کی شرح بہت کم ہونے پر صارف کو `/ocr` کی طرف بھیجا جائے گا؛ M4 ingest کے اندر OCR نہیں چلائے گا۔
2. **Embedding کی لاگت موجودہ ٹوکن نظام سے ہی کٹے گی**: کوئی نیا metering ٹیبل نہیں؛ `tokenGuard` کا موجودہ ڈھانچہ کافی ہے۔
3. **مشترکہ corpus بدستور قرآن/حدیث کے لیے مستند ذریعہ رہے گا**: ذاتی کتب خانہ اس کا متبادل نہیں، اضافہ ہے۔
4. **صارف کی کتابوں کی زبان اردو/عربی/انگریزی ہوگی**: `gemini-embedding-001` تینوں سنبھالتا ہے، اس لیے فی زبان الگ ماڈل کی ضرورت نہیں۔
5. **`extract_entities` کا JSON کبھی کبھار خراب آئے گا**: ناکام parse پر وہ batch `progress.failed` میں گنی جائے گی، پورا رن نہ رکے (M3 FR-5.7 کا تسلسل)۔
6. **Recipes میں صارف کی اپنی Recipe بنانا M5 کا کام ہے**۔

---

## 10. تصدیق (Verification)

```bash
npm run typecheck && npm run test && npm run lint && npm run build
```

دستی جانچ کے مراحل (ہر ایک لازمی):

0. **(M4.0 کے بعد)** chunked رن کے دوران reload → "نامکمل رن" کا کارڈ → "جاری رکھیں" → باقی ماندہ حصہ مکمل ہو۔
1. 300 صفحات کا PDF اپلوڈ → خرچ کا ڈائلاگ → ingest کی پیش رفت → درمیان میں Cancel → اب تک کے chunks محفوظ۔
2. اسی کتاب کے کسی موضوع پر `citations` چلائیں → ذاتی مأخذ کا source card "میرا کتب خانہ" کے بیج کے ساتھ آئے۔
3. دوسرے اکاؤنٹ سے وہی تلاش → پہلے صارف کا کوئی مواد **ہرگز** نظر نہ آئے۔
4. `extract_entities` چلائیں → اشخاص/کتب/اصطلاحات کے کارڈ بنیں → دستاویز کا متن جوں کا توں رہے۔
5. «ابن تیمیہ» اور «ابن تیمیۃ» دونوں والی دستاویزات پر چلائیں → "ممکنہ ڈپلیکیٹ" کی تجویز آئے، خودکار ضم نہ ہو۔
6. `polish_document` Recipe چلائیں → ایک ہی مجموعی pre-flight ڈائلاگ → تینوں قدم ترتیب وار → "پورا Recipe واپس لیں" اصل حالت بحال کرے۔
7. AI Review آن کر کے Recipe چلائیں → صاف پیغام کے ساتھ رن رکے۔
8. 360px پر: Sources ٹیب، ingest کارڈ، Entity کارڈ، اور Recipe ڈائلاگ — چاروں RTL میں درست۔
9. تینوں نئے Feature Flags بند کر کے build → ایپ بعینہٖ M3 کی شکل میں چلے۔
