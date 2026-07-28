# SPEC-M3 — AI Task Library، Editor Menus، Trust UI، Chunking

**حیثیت:** تجویز شدہ · **ورژن:** 3.1.0 · **تاریخ:** 2026-07-28
**برانچ:** `newee` → feature flags کے پیچھے ہفتہ وار `main`
**تخمینہ:** 21–26 ورکنگ دن (7 مراحل) · **پیش شرط:** M2 مکمل ✅
**فیصلے:** §8 میں درج (صارف سے منظور شدہ)

---

## 1. سیاق + رہنما اصول

M1 نے دستاویز کی ساخت کو وجود دیا، اور M2 نے تین ستونوں کا ورک اسپیس (`Library | Canvas | Workbench`) تعمیر کیا۔ کوڈ کے حالیہ جائزے نے تصدیق کی ہے کہ **M2 عملاً feature-complete ہے**: تینوں ستون، Workbench کا unmount نہ ہونا (`hidden`)، انتخاب کی پٹی، 12,000 حرف کی حد، اور حجم کے مطابق ٹوکن لاگت — سب مستحکم بنیاد کے ساتھ موجود ہیں۔

مگر M2 نے چار بنیادی صلاحیتیں جان بوجھ کر M3 کے لیے چھوڑی تھیں (SPEC-M2 §2 Non-Goals، FR-9.4، FR-9.6)۔ نیز کوڈ کے تفصیلی جائزے سے **تین اہم دریافتیں** سامنے آئیں جو M3 کے اسپیک کی ساخت کو متعین کرتی ہیں:

1. **`refine-text` پر 30 درخواست/منٹ کی حد ہے** ([index.ts:189](file:///e:/EasyEditor/supabase/functions/refine-text/index.ts#L189))۔ اگر بڑی دستاویز کی chunking بغیر throttle کے 30+ batches پر بھیجی گئی تو HTTP 429 کی وجہ سے رن ناکام ہو جائے گا۔ یہ Pillar D کے ناکام ہونے کا سب سے متوقع راستہ ہے۔
2. **چار ایکشنز سرور پر مکمل موجود ہیں مگر ایڈیٹر میں چھپے ہیں**: `normalize_script`، `formalize`، `humanize`، `shorten` ([index.ts:15-46](file:///e:/EasyEditor/supabase/functions/refine-text/index.ts#L15-L46))۔ AI Task Library انہیں **صفر اضافی سرور لاگت** پر صارف کے لیے ظاہر کر دے گی۔
3. **`refine-text` پہلے ہی ranked sources اور 0–1 confidence نکالتا ہے، مگر جواب بھیجتے وقت پھینک دیتا ہے** — `fetchIslamicContext` صرف `string` لوٹاتا ہے، جبکہ `evaluateKifayatGate` ([citationEngine.ts:636](file:///e:/EasyEditor/supabase/functions/_shared/citationEngine.ts#L636)) مکمل طور پر تیار بیٹھا ہے۔ **Pillar C (Trust UI) بنیادی طور پر ڈیٹا کی منتقلی (plumbing) ہے، کوئی نئی AI منطق نہیں**۔

### 1.1 پانچ رہنما اصول (Golden Principles)

کوڈ میں Constitution کی بیرونی دستاویز کے حوالے متفرق تھے (مثلاً §1.3/§1.6)۔ M3 کے تمام ڈیزائن فیصلے ذیل کے پانچ خود کفیل رہنما اصولوں پر پرکھے جائیں گے:

1. **Cognitive Continuity (سیاق نہ ٹوٹے)** — صارف تحریر، تحقیق، یا AI رن کے دوران کبھی اپنے کام کا سیاق نہ کھوئے (Workbench چھپایا جائے، unmount نہ ہو)۔
2. **Workbench on Demand (تیسرا ستون ضرورت پر)** — دائیں طرف کا ستون بطورِ default بند رہے گا تاکہ لکھنے کے لیے زیادہ سے زیادہ Canvas ملے۔
3. **عالِم اجازت دیتا ہے، ہم نہیں (صارف کا حتمی اختیار)** — تباہ کن یا اہم AI تبدیلیوں سے پہلے اور بعد میں صارف کو پورا کنٹرول اور Undo کا حق حاصل ہے۔
4. **دکھاؤ کہ کہاں سے آیا (شفافیت)** — AI کا ہر دعویٰ، اقتباس، اور اعتماد کا عدد واضح اور قابلِ سراغ ہونا چاہیے (Trust UI کی روح)۔
5. **کوئی خاموش خرچ نہیں (پیشگی مالی اطلاع)** — ایک بھی ٹوکن کٹنے یا بڑا multi-batch رن شروع ہونے سے پہلے صارف کو batches، ٹوکن لاگت، اور موجودہ بیلنس کا علم ہونا لازمی ہے۔

---

## 2. Non-Goals (M3 میں شامل نہیں)

- **Knowledge Graph / Entity Cards**: اشخاص اور کتب کے خودکار کارڈز (M4+)۔
- **Autonomous Agents (Level 3)**: خودکار کثیر قدمی ایجنٹس (M4+)۔
- **Proactive AI (Level 4)**: صارف کے لکھتے وقت خودکار تجاویز۔
- **Block-level track changes**: Chunked AI تبدیلیوں پر پیراگراف بہ پیراگراف inline diff view (M3 میں standard transaction undo یا AI Review کی سطح پر روک)۔
- **Real-time collaboration (Yjs / WebSockets)**: کثیر صارف ایڈیٹنگ۔
- **OCR / Transcribe / Speak کا Workbench میں ضم ہونا**: یہ اپنے الگ صفحات پر برقرار رہیں گے (پل کے طور پر Library کے "+ نیا" مینو سے منسلک)۔
- **Free-form prompt editor**: صارف کو کھلا LLM prompt ایڈیٹر نہیں دیا جائے گا (صرف built-in tasks کی نقل + prompt میں ترمیم)۔
- **`summarize` کا chunked رن**: `summarize` بلاک بہ بلاک chunk نہیں ہو سکتا (مفروضہ §9)۔

---

## 3. Functional Requirements

### FR-1 · M3.0 صفائی اور تکنیکی قرض (بغیر flag، سب سے پہلے)

M3 کے نئے فیچرز شروع کرنے سے پہلے M2 کا تکنیکی قرض اور data-loss کے خطرات فوراً ختم کیے جائیں گے:

- **FR-1.1 FR-9.2 کا حتمی حل**: نیا `src/lib/editor/applyResult.ts` تخلیق کیا جائے گا جو `generateJSON(html, buildEditorExtensions())` کے ذریعے نتیجہ لاگو کرے گا ([bookSectionMigration.ts:22](file:///e:/EasyEditor/src/core/workspace/bookSectionMigration.ts#L22) کا ثابت شدہ نمونہ)۔ `textToHtml` کا ناقص `<p>` بنانے والا راستہ ایڈیٹر سے مکمل خارج کیا جائے گا۔
- **FR-1.2 Sources ٹیب کا حقیقی ڈیٹا**: [LibraryPanel.tsx:223-231](file:///e:/EasyEditor/src/components/workspace/LibraryPanel.tsx#L223-L231) کا hard-coded placeholder ختم کر کے `library_items` ٹیبل سے پڑھا جائے۔
- **FR-1.3 TopBar Breadcrumb**: `WorkspaceTopBar` کے پاس `projectName` prop موجود ہے مگر [WorkspaceLayout.tsx:103](file:///e:/EasyEditor/src/components/workspace/WorkspaceLayout.tsx#L103) اسے کبھی نہیں بھیجتا؛ اسے باقاعدہ جوڑا جائے۔
- **FR-1.4 Translation Project کا Canvas میں کھلنا**: `kind='translation'` والے پروجیکٹ پر کلک سے ایپ `navigate("/translate-workspace")` پر جانے کی بجائے Canvas کے اندر کھل کر [TranslationWorkspace](file:///e:/EasyEditor/src/pages/TranslationWorkspace.tsx) رینڈر کرے ([LibraryPanel.tsx:88-92](file:///e:/EasyEditor/src/components/workspace/LibraryPanel.tsx#L88-L92))۔
- **FR-1.5 Workbench Unmount نہ ہونے کا خودکار ٹیسٹ**: M2 کا اہم ترین اصول (FR-4.3 — CSS `hidden`) کے لیے خودکار Playwright / Vitest integration test لکھا جائے تاکہ آئندہ کوئی تبدیلی اسے نہ توڑ سکے۔
- **FR-1.6 متفرق صفائی**:
  - `/speak` کو Library کے "+ نیا" مینو میں شامل کیا جائے۔
  - `usePanelState` سے غیر مستعمل مردہ توابع (`setLibraryWidth`, `setWorkbenchWidth`) حذف کیے جائیں۔
  - `LibraryPanel.tsx:48-73` اور `CommandPalette.tsx:48-63` کے دو N+1 لوپس کو ایک مشترکہ `useAllDocuments` hook سے بدل دیا جائے۔
  - `Ctrl+K` میں "پروجیکٹ پر جائیں"، "نیا پروجیکٹ"، اور "برآمد کریں (Export)" شامل ہوں۔
  - `Esc` دبانے پر فوکس واپس Canvas ایڈیٹر پر جائے۔

---

### FR-2 · Pillar A — AI Task Library

- **FR-2.1 TaskDefinition کا ڈھانچہ**:
  ```typescript
  export interface TaskDefinition {
    slug: string;
    labelKey: string;
    engine: "refine-text" | "client";
    actionName?: string; // refine-text action parameter
    scope: "selection" | "document" | "either";
    applyMode: "inline" | "block" | "append" | "replace_document";
    chunkable: boolean;
    producesSources: boolean;
    costModel: { baseTokens: number; perKChars?: number };
    surfaces: ("bubble" | "slash" | "library" | "toolbar")[];
    clientFn?: (text: string) => string;
  }
  ```
- **FR-2.2 11 Built-in Tasks کلائنٹ رجسٹر میں**:
  تمام built-in tasks کلائنٹ کے TypeScript رجسٹر (`src/lib/tasks/registry.ts`) میں ہوں گی (ڈیٹابیس میں نہیں):
  1. `add_harakat` (موجودہ - refine-text)
  2. `remove_harakat` (موجودہ - client)
  3. `spelling_check` (موجودہ - refine-text)
  4. `paraphrase` (موجودہ - refine-text)
  5. `summarize` (موجودہ - refine-text)
  6. `citations` (موجودہ - refine-text)
  7. `auto_format` (موجودہ - refine-text)
  8. `normalize_script` (نیا پوشیدہ سرور ایکشن - refine-text)
  9. `formalize` (نیا پوشیدہ سرور ایکشن - refine-text)
  10. `humanize` (نیا پوشیدہ سرور ایکشن - refine-text)
  11. `shorten` (نیا پوشیدہ سرور ایکشن - refine-text)

- **FR-2.3 Surfaces پر مبنی نمائش**:
  M2 کا FR-3.3 اصول اب `surfaces[]` کی بنیاد پر ڈیٹا سے نافذ ہوگا: `auto_format` کے پاس `"bubble"` surface نہیں ہے، اس لیے وہ متن کے انتخاب کی پٹی (Bubble Menu) میں نہیں دکھایا جا سکتا۔

- **FR-2.4 صارف کی کسٹم Tasks (`ai_tasks`)**:
  نیا `ai_tasks` ٹیبل صرف صارف کی بنائی ہوئی کسٹم tasks محفوظ کرے گا۔ UI میں آزاد prompt ایڈیٹر نہیں ہوگا — صارف صرف کسی Built-in task کو "Duplicate" کر کے اس کے prompt اور نام میں ترمیم کر سکے گا (محدود authoring)۔

- **FR-2.5 لازمی سرور تحفظ (Security Gate)**:
  Edge Function (`refine-text`) کبھی بھی HTTP body سے کھلا `system_prompt` قبول نہیں کرے گا۔ اگر درخواست میں کسٹم task کی ID ہو، تو سرور خود `ai_tasks` ٹیبل سے `user_id = auth.uid()` کی جانچ کر کے prompt پڑھے گا۔ `refine-text` چونکہ Service Role Key استعمال کرتا ہے ([index.ts:176](file:///e:/EasyEditor/supabase/functions/refine-text/index.ts#L176))، اس لیے باڈی سے کھلا prompt قبول کرنا ایپ کو کھلے LLM Proxy کے خطرے میں ڈال دے گا۔

- **FR-2.6 Pre-flight استطاعت کی جانچ (Solvency Check)**:
  کسی بھی task کا رن شروع کرنے سے پہلے مقامی ٹوکن بیلنس اور تخمینہ لاگت کا موازنہ کیا جائے گا۔ بیلنس کم ہونے کی صورت میں network درخواست بھیجے بغیر فوراً صارف کو پیغام دیا جائے گا۔

- **FR-2.7 Task Runs کا لاگ**:
  ہر AI رن (سوائے `engine: "client"` کے جیسے `remove_harakat`) `task_runs` ٹیبل میں درج ہوگا۔

---

### FR-3 · Pillar B — Bubble Menu + Slash Commands

- **FR-3.1 TipTap BubbleMenu میں منتقلی**:
  `RichEditor.tsx` کی دستی پوزیشننگ ([RichEditor.tsx:354-378](file:///e:/EasyEditor/src/components/editor/RichEditor.tsx#L354-L378)، [447-464](file:///e:/EasyEditor/src/components/editor/RichEditor.tsx#L447-L464)) کو TipTap کے `@tiptap/react` `BubbleMenu` سے بدلا جائے گا۔
  > **معاہدے کی پاسداری:** `selectionBar({selectedText, isBusy, actions})` کا render-prop معاہدہ حرف بہ حرف برقرار رہے گا، تاکہ `SelectionActionBar.tsx` اور اس کے unit tests (`selectionActionBar.test.tsx`) کو بالکل تبدیل نہ کرنا پڑے۔

- **FR-3.2 Slash Commands (`/`)**:
  - `@tiptap/suggestion` کے ذریعے سلیش مینو تیار کیا جائے۔
  - `allowedPrefixes: [null, " "]` تاکہ URLs یا تاریخوں کے اندر `/` دبانے پر مینو ناگوار نہ کھل جائے۔
  - `Esc` دبانے پر مینو بند ہو اور `/` کا حرف ایڈیٹر کے متن میں قائم رہے۔

- **FR-3.3 RTL اور تلاش کی مطابقت**:
  - پاپ اپ پر `dir` اور floating placement `bottom-end` (RTL میں بصری طور پر دائیں طرف) لاگو ہو۔
  - تلاش انگریزی slugs اور اردو labels دونوں پر چلے، اور `stripHarakat` نارملائزیشن استعمال کرے۔

- **FR-3.4 موبائل (<768px) کا نمونہ**:
  موبائل پر کوئی floating پاپ اپ رینڈر نہیں ہوگا۔ متن منتخب کرنے پر صرف ایک چھوٹی "AI" pill آئے گی، جو دبانے پر نیچے سے `Sheet` (Bottom Drawer) کھولے گی — بعینہٖ وہی نمونہ جو M2 کے موبائل drawers کا ہے۔ (یہ iOS کے native selection menu کے اوپر floating عناصر کے چھپ جانے کا حتمی حل ہے)۔

- **FR-3.5 ایڈیٹر ٹول بار**:
  ایڈیٹر کا ٹول بار جوں کا توں برقرار رہے گا (SPEC-M2 FR-3.3.1)۔

---

### FR-4 · Pillar C — Trust UI

- **FR-4.1 Additive Response Structure**:
  `refine-text` اپنے جواب میں `sources` array، `confidence` (0.0–1.0)، اور `model` string لوٹائے گا۔ پرانے کلائنٹس کی مطابقت قائم رکھنے کے لیے جواب کی ساخت میں صرف اضافے (additive changes) کیے جائیں گے۔

- **FR-4.2 FR-9.6 کا حتمی حل (دونوں کٹوتیاں ختم)**:
  1. `text.slice(0, 4000)` ([refine-text/index.ts:129](file:///e:/EasyEditor/supabase/functions/refine-text/index.ts#L129)) کی جگہ ہوشمند query تعمیر کی جائے: (ابتدائی ~1200 حروف + آخری ~800 حروف + 20 حرف سے لمبی عربی/اردو رَوَیں)۔
  2. `.slice(0, 600)` ([refine-text/index.ts:152](file:///e:/EasyEditor/supabase/functions/refine-text/index.ts#L152)) کی جگہ متحرک بجٹ `CONTEXT_BUDGET ≈ 9000 / results.length` لاگو ہو (حدود 400–1500 حروف فی ماخذ)۔

- **FR-4.3 Confidence کا حساب**:
  نئی ریاضی بنانے کے بجائے `citationEngine.ts:636` کا `evaluateKifayatGate` استعمال کیا جائے۔ Multi-batch / Chunked رن پر تمام batches کے confidence scores کا **`min()`** لیا جائے گا (اوسط نہیں — کیونکہ ایک بھی غلط یا کمزور حوالہ پورے مقالے کی ساکھ خراب کرتا ہے)۔

- **FR-4.4 غیر-Citation Tasks پر Confidence**:
  جن tasks کا `producesSources: false` ہے (مثلاً spell check یا add harakat)، ان پر confidence `NULL` رہے گا اور کوئی بیج یا فیصد نہیں دکھایا جائے گا۔

- **FR-4.5 Trust UI کے تین مقامات**:
  1. **Workbench کا `Trust` ٹیب**: پروجیکٹ یا دستاویز کے تمام AI runs کا مستقل ریکارڈ (Workbench میں اب پانچ ٹیبز ہیں: `research | translate | extract | tasks | trust`)۔
  2. **Canvas کے نیچے عارضی `TaskRunCard`**: جاری یا آخری AI رن کا عارضی کارڈ (جس میں progress، cancel، sources، اور Undo بٹن ہو)۔
  3. **دستاویز کے اندر Inline نہیں**: ایڈیٹر کے متن میں کوئی node view یا schema تبدیلی نہیں کی جائے گی تاکہ `generateJSON` اور TipTap doc schema کی مطابقت نہ ٹوٹے۔

- **FR-4.6 موجودہ UI کی منتقلی**:
  [CitationBadge.tsx](file:///e:/EasyEditor/src/components/research/CitationBadge.tsx) اور [CitationPanel.tsx:44-65](file:///e:/EasyEditor/src/components/research/CitationPanel.tsx#L44-L65) کی `groupByDomain` اور `DOMAIN_LABEL` لاجک دوبارہ استعمال کی جائے گی، کوئی نیا کوڈ ڈپلیکیٹ نہیں ہوگا۔

---

### FR-5 · Pillar D — Chunking (M2 کا FR-9.4)

- **FR-5.1 `docChunker.ts` (خالص Chunker)**:
  TipTap document structure سے `TextBatch[]` تیار کرنے کا خالص فنکشن:
  - `table`، `horizontalRule`، `image`، `codeBlock` بالکلیہ چھوڑ دیے جائیں گے اور `progress.skipped` میں گنے جائیں گے۔
  - `heading` / `blockquote` / `bulletList` / `orderedList` اپنا الگ مستقل batch بنائیں گے (`mode: "inline"`) — ان کا نتیجہ block کی اندرونی حد `[from + 1, to - 1]` میں لاگو ہوگا تاکہ `<h2>` کا ٹیگ `<h2>` ہی رہے۔
  - لگاتار `paragraph` جمع ہو کر `mode: "block"` بیچ بنائیں گے (زیادہ سے زیادہ 8000 حروف)۔
  - ایک بہت بڑا پیراگراف جملوں پر توڑا جائے گا — اردو و عربی کے خاتمہ علامتیں لازمی ہیں: `/(?<=[۔؟!\.\?])\s+/`۔

- **FR-5.2 `positionTracker.ts` (Position Mapping)**:
  ہر batch کے `from/to` range کو ProseMirror `transaction.mapping` سے گزارا جائے گا۔ یہ محض ~20 سطور کا ماڈیول دو بڑے مسائل حل کرتا ہے:
  1. ہمارے اپنے پچھلے batches کے لاگو ہونے سے پیدا ہونے والا character offset shift۔
  2. رن کے دوران **صارف کا دستاویز میں ٹائپ کرنا**۔
  اگر mapping کے بعد `to <= from` ہو جائے تو اس batch کو منسوخ کر کے چھوڑ دیا جائے گا، کوئی فرضی اندازہ نہیں لگایا جائے گا۔

- **FR-5.3 Orchestration (`runChunkedTask.ts`)**:
  [transcribeLongForm.ts](file:///e:/EasyEditor/src/lib/audio/transcribeLongForm.ts) کے ثابت شدہ نمونے پر: `onProgress` events، `checkSignal`، اور `AbortController` کی منتقلی۔

- **FR-5.4 Rate Limit Throttle (لازمی)**:
  `refine-text` کی 30/منٹ کی حد سے بچنے کے لیے ہر batch کے بعد کم از کم **2.4 سیکنڈ کا وقفہ (throttle floor)** دیا جائے گا (زیادہ سے زیادہ 25 درخواستیں/منٹ)۔ HTTP 429 آنے پر ایک منٹ کا Backoff-Retry ہوگا۔ 25 batches کا رن تقریباً 60 سیکنڈ لے گا — یہ پیش رفت کی پٹی اور منسوخی کے ساتھ صارف کے لیے مکمل طور پر مقبول رویہ ہے۔

- **FR-5.5 pre-flight بجٹ اور دورانِ رن حفاظت**:
  اگر کل تخمینہ لاگت > موجودہ ٹوکن بیلنس ہو، تو رن شروع ہی نہیں ہوگا۔ رن کے دوران ہر batch پر مقامی بیلنس گھٹایا جائے گا۔ اگر بیلنس ختم ہو جائے تو رن **شائستگی سے وقفہ (pause/stop) کرے گا** اور اب تک کا لاگو شدہ کام محفوظ رہے گا۔

- **FR-5.6 فوری چسپاندگی (Immediate Apply per Batch)**:
  ہر batch کا نتیجہ فوراً ایڈیٹر پر لاگو ہوگا، اور `useDocument` کا 1.5s autosave اسے بغیر کسی اضافی کوڈ کے خودکار طور پر محفوظ کرے گا۔ رن منسوخ (Cancel) کرنے کی صورت میں اب تک لاگو شدہ batches محفوظ رہیں گے۔

- **FR-5.7 جزوی کامیابی (Partial Success)**:
  ایک batch کی ناکامی پورا رن منسوخ نہیں کرے گی۔ تمام ممکنہ batches کے بعد حتمی حالت `status: "completed"` اور `output.partial = true` رہے گی۔

- **FR-5.8 AI Review کے ساتھ تعارض**:
  اگر ایڈیٹر میں AI Review (Track Changes) آن ہو، تو chunked task کا رن **شروع ہی نہیں ہوگا** اور صارف کو واضح پیغام دکھایا جائے گا۔ (وجہ: `RichEditor.tsx:286` پر `applyAsSuggestion` کثیر السطور متن کے لیے `false` لوٹاتا ہے، جس کی وجہ سے chunked رن خاموشی سے Track Changes کو bypass کر دیتا)۔

- **FR-5.9 Undo کی سہولت**:
  ہر batch الگ transaction کی صورت میں لاگو ہوتا ہے، اس لیے `Ctrl+Z` ایک batch کو واپس لائے گا۔ `TaskRunCard` پر "پورا رن واپس لیں" (Undo Full Run) کا بٹن موجود ہوگا جو پورے رن کے تمام transactions کو ریورس کرے گا۔

- **FR-5.10 `auto_format` حصہ بہ حصہ**:
  `auto_format` کا `applyMode` `replace_document` سے بدل کر chunked پائپ لائن میں آئے — ہر batch کا HTML اسی batch کی حد میں `generateJSON(html, buildEditorExtensions())` سے داخل ہو؛ **پوری دستاویز پر `setContent` کبھی نہ چلے**۔ اس سے آج کی وہ حالت ختم ہوگی جہاں 12,000 حرف سے بڑی کسی بھی دستاویز پر `auto_format` بالکل نہیں چل سکتا ([aiActions.ts:52](file:///e:/EasyEditor/src/lib/editor/aiActions.ts#L52) + [useEditorAiActions.ts:158](file:///e:/EasyEditor/src/components/editor/useEditorAiActions.ts#L158))۔

- **FR-5.11 خرچ کی لازمی تصدیق**:
  **ہر ایسا رن جو ایک سے زیادہ batch کا ہو**، اس پر ڈائلاگ آئے جس میں batches کی تعداد، تخمینہ ٹوکن، اور موجودہ بیلنس دکھایا جائے؛ صریح "جاری رکھیں" کی تصدیق کے بغیر کوئی network درخواست نہ بھیجی جائے۔ سلیش مینو یا کسٹم tasks سے شروع ہونے والا chunked task بھی اس ڈائلاگ کے بغیر نہ چلے۔

---

## 4-الف. Non-Functional Requirements

| # | تقاضا |
|---|---|
| NFR-1 | کوئی نئی فائل 300 سطور سے تجاوز نہ کرے (SPEC-v2 کا سخت اصول) |
| NFR-2 | `npm run typecheck` · `npm run test` · `npm run lint` · `npm run build` — چاروں مکمل صاف |
| NFR-3 | مکمل RTL: ببل مینو، سلیش فہرست، Trust ٹیب، پیش رفت کی پٹی — 360px اور ڈیسک ٹاپ دونوں پر |
| NFR-4 | WCAG 2.1 AA: سلیش مینو کی بورڈ سے مکمل قابلِ استعمال؛ Workbench ٹیبز پر صریح `aria-label` |
| NFR-5 | Chunked رن کے دوران ایڈیٹر جواب دیتا رہے — 60,000 حرفی دستاویز پر typing میں کوئی رکاوٹ نہ ہو |
| NFR-6 | تینوں feature flags بند ہوں ⇒ ایپ بعینہٖ M2 کے رویے پر چلے |
| NFR-7 | Edge function کی تبدیلیاں additive ہوں (پرانے کلائنٹ چلتے رہیں — edge functions پر flag نہیں لگ سکتا) |

---

## 4. تکنیکی ڈیزائن

### 4.1 دیتابیس مائیگریشن (`supabase/migrations/2026XXXX_m3_tasks.sql`)

1. `task_runs` ٹیبل میں توسیع:
   - `updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()` + auto-update trigger۔
   - `progress JSONB NOT NULL DEFAULT '{"total":0, "done":0, "failed":0, "skipped":0}'::jsonb`
   - `error TEXT`
   - `status` CHECK constraint میں `'cancelled'` کا اضافہ؛ default `'pending'`۔
   - Indexes: `(document_id, created_at DESC)` اور partial index `WHERE status = 'pending' OR status = 'running'`۔

2. نیا `ai_tasks` ٹیبل (صرف کسٹم tasks کے لیے):
   ```sql
   CREATE TABLE ai_tasks (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
     slug TEXT NOT NULL,
     label TEXT NOT NULL,
     system_prompt TEXT NOT NULL,
     base_task_slug TEXT, -- کلائنٹ TS رجسٹر کی built-in slug (کوئی FK constraint نہیں)
     scope TEXT NOT NULL DEFAULT 'either' CHECK (scope IN ('selection','document','either')),
     apply_mode TEXT NOT NULL DEFAULT 'inline' CHECK (apply_mode IN ('inline','block','append','replace_document')),
     output_format TEXT NOT NULL DEFAULT 'text' CHECK (output_format IN ('text','html')),
     chunkable BOOLEAN NOT NULL DEFAULT true,
     produces_sources BOOLEAN NOT NULL DEFAULT false,
     archived_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ DEFAULT NOW(),
     updated_at TIMESTAMPTZ DEFAULT NOW(),
     UNIQUE(user_id, slug)
   );
   ALTER TABLE ai_tasks ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "Users access own tasks" ON ai_tasks
     FOR ALL USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);

   -- handle_updated_at() trigger مطابقت کے ساتھ
   CREATE TRIGGER update_task_runs_modtime BEFORE UPDATE ON task_runs FOR EACH ROW EXECUTE PROCEDURE handle_updated_at();
   CREATE TRIGGER update_ai_tasks_modtime BEFORE UPDATE ON ai_tasks FOR EACH ROW EXECUTE PROCEDURE handle_updated_at();
   ```

> **بچہ ٹیبل سے پرہیز**: `task_run_chunks` کا الگ بچہ ٹیبل نہیں بنایا جائے گا کیونکہ batches کی اوسط تعداد چھوٹی (3–8) ہے، اور ایک JSONB column (`progress`) کا `UPDATE` زیادہ سستا اور تیز رفتار ہے۔

### 4.2 نئی فائلیں (سب ≤300 سطور)

```
src/lib/tasks/
  types.ts                    TaskDefinition, ChunkProgress, TaskRunResult
  registry.ts                 11 Built-in Tasks کا TS رجسٹر
  customTasks.ts              ai_tasks CRUD سروس
  cost.ts                     حجم کے مطابق ٹوکن لاگت اور Pre-flight جانچ
  runTask.ts                  Single-batch رن اور refine-text API کال

src/lib/editor/
  applyResult.ts              generateJSON schema-safe apply
  docChunker.ts               TipTap doc -> TextBatch[] چنکر
  positionTracker.ts          transaction.mapping پوزیشن ٹریکر
  runChunkedTask.ts           Chunked orchestration اور throttle
  slashItems.ts               Slash menu کی تلاش اور فلٹرنگ

src/components/editor/
  EditorBubbleMenu.tsx        TipTap BubbleMenu wrapper (render-prop preserved)
  SlashCommand.ts             TipTap Suggestion extension registration
  SlashCommandList.tsx        Slash menu کا UI جزو
  suggestionRenderer.tsx      tiptap/suggestion کا DOM renderer
  MobileTaskSheet.tsx         موبائل bottom sheet
  useChunkedTaskRun.ts        Chunked run کا React state hook

src/components/workspace/
  TaskLibraryPanel.tsx        Workbench کا Tasks ٹیب
  TrustPanel.tsx              Workbench کا Trust ٹیب
  TaskRunCard.tsx             Canvas کے نیچے جاری progress/sources کارڈ
  SourceCardList.tsx          Sources کی نمائش
  ChunkProgressBar.tsx        ترقی کی پٹی اور cancel بٹن
  LibrarySourcesTab.tsx       Library کے Sources ٹیب کا حقیقی نفاذ
  CanvasTranslationView.tsx   Translation project کے لیے Canvas کا مکمل ورک اسپیس

src/core/workspace/
  taskRunService.ts           task_runs DB کیلیے Supabase سروس
  useTaskRuns.ts              task_runs کا React hook
  libraryItemService.ts       library_items ٹیبل سروس
  useAllDocuments.ts          N+1 ختم کرنے کے لیے تمام کتب کا مشترکہ hook
```

### 4.3 اہم تکنیکی اصول

- **Built-in tasks کا رجسٹر کلائنٹ کوڈ میں**: سرور کا `actionPrompts` ([refine-text/index.ts:14-85](file:///e:/EasyEditor/supabase/functions/refine-text/index.ts#L14-L85)) سچائی کا سرچشمہ ہے۔ کلائنٹ پر TS رجسٹر ہونے سے سلیش مینو ہر keystroke پر بغیر کسی network لاگ کے فوری فلٹر ہوتا ہے، اور `remove_harakat` جیسے خالص کلائنٹ فنکشنز بھی رجسٹر میں سما جاتے ہیں۔
- **Workbench Panel میں 5 ٹیبز**: `WorkbenchTab` اب پانچ ٹیبز کا احاطہ کرے گا (`research | translate | extract | tasks | trust`) — اس کے لیے [usePanelState.ts:3](file:///e:/EasyEditor/src/core/workspace/usePanelState.ts#L3) کی `WorkbenchTab` type اور line 33 کی validation دونوں بڑھیں گی، اور [WorkbenchPanel.tsx:37](file:///e:/EasyEditor/src/components/workspace/WorkbenchPanel.tsx#L37) کا `grid-cols-3` 5 ٹیبز کے لیے موزوں کیا جائے گا۔
- **SlashCommand اور Extensions**: `SlashCommand` کو `buildEditorExtensions()` میں **شامل نہیں کیا جائے گا** — کیونکہ وہ فنکشن `generateJSON` کا شکیما ہے جو `applyResult.ts` میں استعمال ہوتا ہے۔ اسے صرف `RichEditor.tsx` میں ایڈیٹر انسٹنس بناتے وقت درج کیا جائے گا۔
- **پیکیجز کا استعمال**: صرف `@tiptap/suggestion` نیا نصب ہوگا (`npm i @tiptap/suggestion`)۔ `@tiptap/extension-bubble-menu` پہلے ہی `@tiptap/react` کی متصل dependency کے طور پر موجود ہے۔ `@floating-ui/dom` پہلے سے نصب ہے۔ `tippy.js` کا استعمال نہیں ہوگا (TipTap v3 اسے متروک کر چکا ہے)۔
- **تین الگ Feature Flags**:
  - `VITE_TASK_LIBRARY` (Task Library & Custom Tasks)
  - `VITE_EDITOR_MENUS` (Bubble Menu & Slash Commands)
  - `VITE_TASK_CHUNKING` (Long Document Chunking & Orchestrator)

---

## 5. مراحل اور تخمینہ

| مرحلہ | کام | Flag | دن |
|---|---|---|---|
| **M3.0** | **M3.0 صفائی (FR-1)** — `applyResult.ts` + tests، Sources ٹیب، TopBar breadcrumb، Canvas translation workspace، keep-mounted test، N+1 ختم کرنا، Ctrl+K توسیع | — (بلا flag) | 3 |
| **M3.1** | **Pillar A بنیاد** — Tasks TS رجسٹر (`registry.ts`) + `runTask` + `taskRunService` + migration + `useEditorAiActions` کی rewiring + استطاعت کی pre-flight جانچ + 4 پوشیدہ ایکشنز کی نمائش | `VITE_TASK_LIBRARY` | 3 |
| **M3.2** | **Pillar B مینو** — `BubbleMenu` wrapper (render-prop محفوظ) + `@tiptap/suggestion` سلیش مینو + موبائل Bottom Sheet + RTL | `VITE_EDITOR_MENUS` | 4 |
| **M3.3** | **Pillar C Trust UI** — `refine-text` میں sources/confidence کا لوٹانا + FR-9.6 کی دونوں کٹوتیاں ختم کرنا + Workbench کا `Trust` ٹیب + `TaskRunCard` | `VITE_TASK_LIBRARY` | 3 |
| **M3.4** | **Pillar D Chunking** — `docChunker` + `positionTracker` + `runChunkedTask` orchestrator + 2.4s throttle floor + بجٹ گیٹ + cancel | `VITE_TASK_CHUNKING` | 5 |
| **M3.5** | **Custom Tasks** — `TaskLibraryPanel` + `ai_tasks` ٹیبل RLS + "Duplicate & Edit Prompt" کی محدود authoring | `VITE_TASK_LIBRARY` | 3 |
| **M3.6** | **موبائل و پولش** — 360px موبائل جانچ + RTL polish + a11y پاس + ADR-0004 مطابقت | — | 2 |

**کل وقت: 23 ورکنگ دن (تخمینہ 21–26 دن)**

### مراحل کی ترتیب کا منطقی جواز

1. **M3.0 سب سے پہلے اور بغیر flag کے**: M2 کی کامیابیوں کو مستحکم کرتا ہے اور data-loss کے رستے بند کرتا ہے۔
2. **Pillar A قبل از Pillar B**: سلیش اور ببل مینو کا کام Pillar A کے رجسٹر پر منحصر ہے۔
3. **Pillar C کا Persistence حصہ A کے ساتھ**: تاکہ Pillar D کے پاس رن کا ریکارڈ اور sources لکھنے کا ڈھانچہ پہلے سے موجود ہو۔
4. **Pillar D سب سے آخر میں**: چونکہ یہ سب سے زیادہ رسک اور کثیر الجہت کام ہے، اس کی تمام پیش شرطیں (A, B, C) مکمل ہونی چاہئیں۔

---

## 6. خطرات اور تدارک (Risks & Mitigation)

| # | خطرہ | شدت | تدارک |
|---|---|---|---|
| **R1** | `refine-text` کی 30/منٹ حد پر Chunked رن 429 کا شکار ہو جائے | **بلند** | `runChunkedTask.ts` میں 2.4s کا سخت throttle floor (max 25 req/min) + HTTP 429 پر 60s backoff retry (FR-5.4)۔ |
| **R2** | Chunking کے لاگو ہونے یا ٹائپنگ سے ایڈیٹر کے position offsets (from/to) بگڑ جائیں | **بلند** | `positionTracker.ts` کے ذریعہ ہر batch کے رینج کو ProseMirror `transaction.mapping` سے گزارنا؛ `to <= from` پر batch منسوخ کرنا (FR-5.2)۔ |
| **R3** | 40 batches کے رن کے بیچ میں صارف کا ٹوکن بیلنس ختم ہو جائے | **بلند** | Pre-flight check سے رن روکنا؛ اگر بیچ میں ختم ہو تو اب تک کا کام محفوظ کر کے شائستگی سے وقفہ (pause) کرنا (FR-5.5)۔ |
| **R4** | Chunked رن پر `citations` کی خاموش 10 گنا لاگت | **بلند** | خرچ کی تصدیق کا لازمی Pre-flight Dialog جو batches اور ٹوکن لاگت کی شفاف اطلاع دے (FR-5.11)۔ |
| **R5** | BubbleMenu میں منتقلی سے M2 کی انتخاب کی پٹی (SelectionActionBar) ٹوٹ جائے | **متوسط** | `selectionBar` کا render-prop معاہدہ 100% قائم رکھنا؛ `selectionActionBar.test.tsx` کی بلا تبدیلی کامیابی۔ |
| **R6** | 320px موبائل پر 5 Workbench ٹیبز جگہ نہ بنا سکیں | **متوسط** | 400px سے کم چوڑائی پر صرف آئیکنز + `aria-label` دکھانا (مفروضہ §9)۔ |
| **R7** | کسٹم Task پر اردو کی تشکیل / HTML خراب ہو جائے | **متوسط** | نتیجہ ہمیشہ `applyResult.ts` (`generateJSON`) کے ذریعے لاگو کرنا، خام HTML کبھی نہیں۔ |
| **R8** | Headings یا lists کے اوپر Chunking چلنے سے formatting کی قسم بدل جائے | **متوسط** | Block elements (`heading`, `blockquote`) کو `mode: "inline"` میں اندرونی رینج `[from+1, to-1]` پر لاگو کرنا (FR-5.1)۔ |
| **R9** | AI Review (Track Changes) آن ہونے پر Chunked رن کی پیش رفت خاموشی سے ضائع ہو جائے | **متوسط** | AI Review آن ہونے پر Chunked task کے رن کو شروع ہونے سے پہلے بلاک کرنا (FR-5.8)۔ |
| **R10** | body کے `system_prompt` کو تسلیم کرنے سے `refine-text` کھلا LLM Proxy بن جائے | **بلند** | Edge function سرور پر `ai_tasks` سے `user_id` کی تصدیق کے ساتھ prompt پڑھے، body سے کھلا prompt ہرگز قبول نہ کرے (FR-2.5)۔ |
| **R11** | TipTap v3 میں `tippy.js` کا غائب ہونا BubbleMenu پوزیشننگ توڑے | **کم** | `@tiptap/react` کا رسمی `BubbleMenu` اور `@floating-ui/dom` استعمال کرنا۔ |
| **R12** | Cancel دبانے کے بعد جاری network request ایڈیٹر کے متن کو خراب کر دے | **متوسط** | `AbortController` + Response ملنے کے بعد `checkSignal` کی جانچ؛ اگر cancel ہو چکا ہو تو `applyResult` کال نہ کرنا۔ |
| **R13** | 60,000 حروف کی بڑی کتاب پر ایڈیٹر کا React state جام ہو جائے | **متوسط** | ہر batch کا نتیجہ ایڈیٹر کی سیکنڈری ProseMirror transaction سے پاس کرنا، React re-render کی فریکوئنسی محدود رکھنا۔ |

---

## 7. Exit Criteria (کامیابی کے معیار)

### Pillar A — Task Library & Custom Tasks
- [ ] ہر AI ایکشن کلائنٹ رجسٹر (`registry.ts`) سے گزرے، کوئی `callRefineText` براہِ راست نہ بلایا جائے۔
- [ ] 4 پوشیدہ ایکشنز (`normalize_script` / `formalize` / `humanize` / `shorten`) کم از کم ایک surface (مثلاً Slash menu) سے فعال اور قابلِ رسائی ہوں۔
- [ ] ہر مکمل AI ایکشن پر `task_runs` میں قطار درج ہو؛ `remove_harakat` (client-only) پر کوئی قطار درج نہ ہو۔
- [ ] کسٹم task کی تخلیق صرف built-in کی نقل + prompt کی تدوین (محدود authoring) تک محدود رہے۔

### Pillar B — Editor Menus & Mobile
- [ ] `selectionActionBar.test.tsx` **بغیر کسی ترمیم کے پاس ہو** (M2 کی regression کی حتمی ضمانت)۔
- [ ] ایڈیٹر ٹول بار کا کوئی بٹن یا ایکشن غائب نہ ہوا ہو۔
- [ ] Canvas کی کم از کم 480px چوڑائی پر ببل مینو مکمل اور درست پوزیشن پر نظر آئے۔
- [ ] 360px موبائل پر floating مینو کے بجائے Bottom Sheet کھلے۔
- [ ] خالی اردو پیراگراف میں `/` دبانے پر سلیش مینو RTL میں کھلے، تیر کے نشانات/Enter/Esc کام کریں، اور `Esc` دبانے پر `/` کا حرف ایڈیٹر میں قائم رہے۔

### Pillar C — Trust UI
- [ ] Spell check یا add harakat کے رن پر confidence بیج **نہ** آئے (NULL confidence)۔
- [ ] کوئی source card ایسا URL نہ دکھائے جو corpus نے نہ دیا ہو۔
- [ ] "اس رن کو واپس لیں" (Undo Full Run) پچھلا اصل متن بحال کرے۔
- [ ] Workbench کا `Trust` ٹیب رن کی تاریخ درست دکھائے۔

### Pillar D — Chunking & Budget
- [ ] **60,000 حروف کی بڑی دستاویز پر "حرکات لگائیں" کامیابی سے چلے**:
  - کوئی بھی انفرادی requests 12,000 حروف سے تجاوز نہ کرے۔
  - تمام عناوین (`<h1>`, `<h2>`)، اقتباسات (`<blockquote>`)، اور فہرستیں اپنی ساخت برقرار رکھیں۔
  - ایڈیٹر میں موجود جداول (`<table>`) بالکل بے چھوئے اور محفوظ رہیں۔
- [ ] **Cancel کا درست رویہ**:
  - 20 batches کے رن کو batch 5 پر منسوخ کرنے سے batches 1–5 لاگو رہیں، `Saved` بیج آئے، اور `task_runs.status = 'cancelled'`, `progress.done = 5` درج ہو؛ Trust ٹیب پر "5 از 20 لاگو، منسوخ" دکھائے۔
- [ ] **429 Rate Limit سے پاک**:
  - 40 batches کا طویل chunked رن بغیر کسی HTTP 429 غلطی کے مکمل ہو۔
- [ ] **بجٹ کا تحفظ (Budget Gate & Confirmation Dialog)**:
  - ایک سے زیادہ batch والے تمام رنز پر تصدیقی ڈائلاگ آئے جو کل batches، تخمینہ لاگت اور بیلنس بتائے۔
  - 8/20 batches کی استطاعت رکھنے والا صارف رن شروع کرے تو Pre-flight dialog اسے صاف انکار کر دے اور کوئی network درخواست نہ جائے۔

### عمومی و کوڈ کوالٹی
- [ ] تینوں feature flags بند کرنے پر ایپ بعینہٖ M2 جیسی بغیر کسی نقص کے چلے۔
- [ ] کوئی بھی نئی فائل 300 سطور سے تجاوز نہ کرے (NFR-1)۔
- [ ] `npm run typecheck && npm run test && npm run lint && npm run build` — چاروں مکمل طور پر صاف۔

---

## 8. فیصلوں کا ریکارڈ (Decisions Record)

| تاریخ | فیصلہ | وجہ |
|---|---|---|
| 2026-07-28 | M3 کا دائرہ: Task Library + Bubble/Slash Menu + Trust UI + Chunking | M2 کی بنیاد مکمل ہے؛ یہ چاروں عناصر اکٹھے مل کر ایڈیٹر کا اصل AI تجربہ بناتے ہیں۔ |
| 2026-07-28 | M2 کے بقایا خلا M3.0 میں بغیر flag شامل ہوں گے | data-loss اور UI کے خلا (breadcrumb، sources tab) کو نئے فیچرز سے پہلے سدھارنا ضروری ہے۔ |
| 2026-07-28 | Chunking کا فن تعمیر: Client-side Orchestration | `transcribeLongForm.ts` کا آڈیو والا نمونہ کلائنٹ سائیڈ پر انتہائی کامیاب ثابت ہو چکا ہے۔ |
| 2026-07-28 | Constitution کے بجائے 5 خود کفیل رہنما اصول | بیرونی دستاویز پر انحصار ختم کر کے کوڈ اور اسپیک کے اندر واضح 5 اصول متعین کیے گئے۔ |
| 2026-07-28 | کسٹم Tasks: "Duplicate built-in + prompt edit" | کھلا prompt ایڈیٹر ایپ کو پیچیدہ اور غیر محفوظ بناتا ہے؛ محدود authoring سیکیورٹی اور سادگی فراہم کرتی ہے۔ |
| 2026-07-28 | AI Review (Track Changes) آن ہو تو Chunked task بلاک ہو | multi-line text پر Track Changes کی inline marks مطابقت توڑتی ہیں؛ صاف پیغام کے ساتھ رن روکنا محفوظ ترین راستہ ہے۔ |
| 2026-07-28 | `auto_format` صرف batch بہ batch لاگو ہو | پوری دستاویز `setContent` سے بدلنے کی بجائے صرف متفقہ batch رینج `generateJSON` سے بدلے گی۔ |
| 2026-07-28 | Built-in Tasks کلائنٹ TS رجسٹر میں ہوں گی | سرور کا `actionPrompts` مرکزی حقیقت ہے؛ سلیش مینو کی synchronous فلٹرنگ اور offline logic کے لیے کلائنٹ رجسٹر لازمی ہے۔ |
| 2026-07-28 | `ai_tasks` میں بچہ ٹیبل `task_run_chunks` نہیں ہوگا | batches کی تعداد 3–8 کے درمیان ہوتی ہے؛ single JSONB `progress` column کا `UPDATE` زیادہ کارآمد ہے۔ |
| 2026-07-28 | Multi-batch رن کا confidence score `min()` ہوگا | ایک بھی غلط حوالہ پورے تحقیقی مقالے کو مشکوک کر دیتا ہے، لہذا اوسط کے بجائے کمزور ترین ماخذ دکھایا جائے گا۔ |

---

## 9. مفروضات (Assumptions)

1. **`summarize` chunkable نہیں ہے**: پیراگراف بہ پیراگراف خلاصہ پوری دستاویز کا جامع خلاصہ نہیں بن سکتا۔ M3 میں `summarize` صرف منتخب متن پر چلے گا۔ (فی حصہ خلاصہ `summarize_sections` M4 میں شامل ہوگا)۔
2. **Reload کے بعد رن کا خودکار Resume ایک stretch goal ہے**: چونکہ ہر batch کا نتیجہ ایڈیٹر میں فوراً autosave ہو جاتا ہے، اس لیے 90% افادیت پہلے ہی حاصل ہے۔
3. **`refine-text` کی 30/منٹ کی حد نہیں بڑھائی جائے گی**: کلائنٹ ~25 درخواستیں/منٹ پر throttle کرے گا۔ اگر سرور کی حد بڑھائی گئی تو chunked رن مزید تیز ہو جائے گا۔
4. **400px سے نیچے Workbench کے ٹیبز**: صرف آئیکنز + `aria-label` کی صورت میں رینڈر ہوں گے۔

---

## 10. تصدیق (Verification)

```bash
npm run typecheck && npm run test && npm run lint && npm run build
```

دستی جانچ کے مراحل (ہر ایک لازمی):

0. **(M3.0 کے فوراً بعد)** عنوان + bold + فہرست + blockquote + جدول والی دستاویز پر کوئی AI ایکشن → پانچوں سلامت رہیں۔
1. Canvas میں متن منتخب کریں → ببل مینو آئے → چھ ایکشنز چلیں → ایڈیٹر ٹول بار کا کوئی بٹن غائب نہ ہو۔
2. خالی اردو پیراگراف میں `/` ٹائپ کریں → سلیش مینو RTL میں کھلے؛ تیر کے نشانات/Enter/Esc درست چلیں؛ `Esc` دبانے پر `/` متن میں قائم رہے۔
3. `https://example.com` ٹائپ کریں → سلیش مینو نہ کھلے۔
4. 60,000 حرفی دستاویز پر "حرکات لگائیں" → تصدیقی ڈائلاگ آئے (Batches/Tokens/Balance) → پیش رفت پٹی چلے → batch 5 پر Cancel دبائیں → 1–5 محفوظ رہیں + `Saved` بیج آئے۔
5. Cancel کے بعد Workbench کا `Trust` ٹیب کھولیں: "5 از 20 لاگو، منسوخ" کا مستقل ریکارڈ نظر آئے۔
6. "حوالہ جات" کا رن چلائیں → Source cards + اعتماد کا بیج نظر آئے؛ اس کے بعد Spell check چلائیں → **کوئی اعتماد کا بیج نہ آئے۔**
7. AI Review (Track Changes) آن کر کے Chunked task چلائیں → صاف پیغام کے ساتھ رن رکے۔
8. تینوں Feature Flags بند کر کے Build بنائیں → ایپ بعینہٖ M2 کی شکل میں بغیر کسی نقص کے چلے۔
