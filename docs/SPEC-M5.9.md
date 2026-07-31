# SPEC-M5.9 — M5 کے باقی ماندہ دروازے (Gates 4–7)

> **حیثیت:** مسودہ · **تاریخ:** 2026-07-31 · **بنیاد:** [SPEC-M5.md](./SPEC-M5.md)، [QA-M5.md](./QA-M5.md) §A
>
> M5.0–M5.8 شپ ہو چکے، مگر کوڈ آڈٹ سے چار کام نامکمل نکلے۔ یہ دستاویز صرف انہی کو مکمل کرنے کا پلان ہے — کوئی نیا فیچر نہیں۔

---

## 1. سیاق — یہ پلان کیوں

`electron/ipc/aiHandlers.ts:53-56` میں خود لکھا ہے:

> *"Gate 3/5 add real local routes for library-ingest (`electron/db/ingest.ts`) and transcribe (whisper) and remove them from this list one at a time."*

`shared/ai/embedConstants.ts` بھی `electron/db/ingest.ts (M5.3)` کا حوالہ دیتی ہے۔ **یہ فائل کبھی لکھی ہی نہیں گئی۔** transcribe کا مقامی راستہ بن گیا (`transcribeChunkLocally`)، مگر ingest کا نہیں — اور Gates 4/5 وہیں رک گئے۔

نتیجہ: ڈیسک ٹاپ موڈ میں `library-ingest` اور `graph-extract` دونوں اس صریح انکار سے ٹکراتے ہیں:

```
ڈیسک ٹاپ موڈ میں "library-ingest" ابھی دستیاب نہیں۔ یہ خصوصیت ویب ورژن میں کام کرتی ہے۔
```

### 1.1 اصل انحصار کی زنجیر

QA-M5 §A میں تین خلا درج ہیں، مگر ان کے نیچے ایک چوتھا اور بنیادی خلا ہے۔ درست ترتیب یہ ہے:

```
G4  مقامی ingest (electron/db/ingest.ts)        ← بنیاد، ابھی موجود نہیں
     ├── M5.3 کا exit criterion «300 صفحات کا PDF مقامی طور پر ingest ہو»
     └── G5  شاملہ کی درآمد (QA-M5 §A1)          ← متن رکھنے کی جگہ اسی سے ملتی ہے
G6  native تلاش کی وائرنگ (QA-M5 §A2)            ← آزاد
G7  موڈ بیج (QA-M5 §A3)                          ← آزاد، معمولی
```

**اس لیے G5 سے پہلے G4 لازم ہے۔** پہلے شاملہ کی درآمد لکھنا اسے ایسی پائپ لائن میں ڈالنا ہے جو موجود ہی نہیں۔

### 1.2 جو پہلے سے تیار ہے (دوبارہ نہ لکھا جائے)

آڈٹ میں یہ سب موجود اور کام کے قابل ملا:

| ٹکڑا | جگہ |
|---|---|
| SQLite schema — `library_chunks` میں **`page_number` اور `part_number` کالم شاملہ کے لیے پہلے سے موجود** | `electron/db/schema.ts:76-93` |
| vector اندراج + sqlite-vec/brute-force fallback | `electron/db/vectorSearch.ts:182` (`upsertChunkVector`) |
| embedding ماڈل کا قفل (R3 کا تدارک) | `electron/db/vectorSearch.ts:32` (`verifyEmbeddingModelLock`) |
| BYOK embedding کال | `electron/ai/geminiClient.ts:185` (`embedTextContent`) |
| `library_items` کا CRUD | `electron/db/workspaceStore/library.ts` |
| resumable ingest کا orchestrator (کلائنٹ سائیڈ) | `src/lib/corpus/ingestOrchestrator.ts` — **اسے بدلنے کی ضرورت نہیں** |
| شاملہ کی native تلاش اور صفحہ پڑھائی | `electron/shamela/shamelaNative.ts:322, 352` |
| شاملہ کی فہرست (master.db) | `electron/shamela/catalogue.ts` |

---

## 2. Non-Goals

- شاملہ کی **پوری** لائبریری کی درآمد کا بٹن — ممنوع رہے گا (SPEC-M5 R7، اصول ۵)۔
- cloud اور مقامی کے درمیان sync — SPEC-M5 کا Non-Goal ہے، رہے گا۔
- `graph-extract` کا مقامی راستہ — الگ کام ہے؛ اس پلان میں صرف **صاف انکار** کا پیغام بہتر ہوگا (§FR-4.4)۔
- شاملہ کی لائیو لنکنگ — SPEC-M5 §8 میں «ایک بار درآمد» طے ہو چکا۔

---

## 3. Functional Requirements

### FR-1 · G4 — مقامی ingest کا راستہ

**FR-1.1** `electron/db/ingest.ts` بنے، جو cloud کے `library-ingest` **کا بعینہٖ وہی contract** پورا کرے تاکہ `ingestOrchestrator.ts` میں ایک لفظ نہ بدلے:

```ts
ingestLibraryItem(db, { itemId, offset, batchSize }) =>
  { next_offset: number; done: boolean; total_chunks: number; progress: number }
```

**FR-1.2** `aiHandlers.ts` کے `edge-function` انکار سے `library-ingest` نکل کر اس راستے پر جائے۔ باقی نام (`graph-extract`) بدستور صاف انکار کریں۔

**FR-1.3** **chunker کی نقل ممنوع (R2)۔** `supabase/functions/library-ingest/index.ts:16-57` کا `chunkDocumentText` (1200 حروف، 150 overlap، اردو/عربی وقف `. ! ؟ ۔ \n`) جوں کا توں **`shared/text/documentChunks.ts`** میں منتقل ہو، اور **دونوں** runtimes وہیں سے import کریں۔ Deno کاپی حذف ہو۔

**FR-1.4** متن نکالنا (PDF/DOCX) main process میں ہو۔ `_shared/fileText.ts` کا `extractTextFromBuffer` runtime-agnostic ہے — اسے بھی `shared/` میں لانے کی کوشش کی جائے؛ اگر اس کے PDF/DOCX انحصار Deno-مخصوص نکلیں تو مقامی نفاذ الگ رہے مگر **chunker مشترک ہی رہے**۔

**FR-1.5** ہر batch کے بعد `library_items.meta.ingest.next_offset` محفوظ ہو، تاکہ منسوخی یا crash کے بعد رن **وہیں سے** جاری ہو (M5.3 exit criterion)۔

**FR-1.6** ہر chunk پر `upsertChunkVector` سے vector لکھا جائے، اور اس سے پہلے `verifyEmbeddingModelLock` چلے — عدم مطابقت پر **صریح انکار**، خالی نتیجہ ہرگز نہیں (R3)۔

**FR-1.7** embedding batching: ایک وقت میں ≤100 chunks، اور ہر batch کے بعد renderer کو پیش رفت جائے۔ منسوخی پر اب تک کے chunks **محفوظ** رہیں (`failed` نہیں)۔

**FR-1.8** FR-4.6 کا بقایا: item حذف ہونے پر `files/` سے اصل فائل بھی حذف ہو (`library.ts:49` کا "Gate 5" نوٹ)۔

### FR-2 · G5 — شاملہ کی فی کتاب درآمد

**FR-2.1** `ShamelaConnectPanel` کے **«بک براؤزر»** بٹن پر `onClick` لگے جو `ShamelaImportDialog` کھولے۔ **«کتب تلاش کریں»** بٹن FR-3 کی تلاش کھولے۔ (ابھی دونوں مردہ ہیں۔)

**FR-2.2** نیا IPC action `shamela:estimateImport` — منتخب کتابوں کی `pageCount` سے **کل صفحات، متوقع chunks، اور embedding کالوں کی تعداد** لوٹائے۔ کوئی متن ابھی نہ پڑھا جائے (تخمینہ سستا رہے)۔

**FR-2.3** ⚠️ **لازمی مجموعی تخمینے کا ایک ہی ڈائلاگ** (R7 کا واحد تدارک)۔ `SolvencyDialog` **جوں کا توں دوبارہ استعمال نہ ہو** — وہ cloud کے ٹوکن بیلنس پر بنا ہے (`availableTokens`)، جبکہ BYOK میں خرچ صارف کے اپنے Gemini بل پر جاتا ہے۔ نیا `ImportEstimateDialog` بنے جو دکھائے:
- منتخب کتابیں (تعداد + نام)
- کل صفحات اور متوقع chunks
- **متوقع Gemini embedding کالیں** اور تخمینی لاگت کی حد
- صاف جملہ: یہ خرچ **آپ کے اپنے Google کھاتے** سے ہوگا
- تصدیق سے **پہلے کوئی network درخواست نہ جائے**

**FR-2.4** نیا IPC action `shamela:importBooks` — ہر منتخب کتاب کے لیے:
1. `catalogue.ts` سے میٹا (عنوان، مصنف، جلدیں، صفحات) لے،
2. `library_items` میں `kind: 'shamela'` کا item بنائے، `source_ref` میں `{ shamelaBookId, title, author }`،
3. `readShamelaPage` سے صفحہ بہ صفحہ متن لے،
4. FR-1 کی ingest پائپ لائن میں ڈالے — **ہر chunk پر `page_number` اور `part_number` بھرے** (یہی حوالے کی جان ہے)۔

**FR-2.5** پیش رفت فی کتاب اور مجموعی — دونوں نظر آئیں؛ **منسوخی** پر اب تک کی کتابیں محفوظ رہیں۔

**FR-2.6** پہلے سے درآمد شدہ کتاب فہرست میں **نشان زد** ہو اور دوبارہ منتخب کرنے پر خرچ نہ ہو (exit criterion)۔

**FR-2.7** درآمد کے بعد `citations` چلانے پر source card پر **کتاب + جلد + صفحہ** آئے، کوئی جعلی URL نہ ہو۔

**FR-2.8** شاملہ کی اصل فائلیں **کبھی** نہ لکھی جائیں — ہر رسائی `readonly` (R17؛ checksum سے تصدیق)۔

### FR-3 · G6 — native تلاش کی وائرنگ

**FR-3.1** `src/lib/shamela/localShamelaService.ts` ڈیسک ٹاپ پر HTTP کے بجائے `window.electronAPI.shamela.search` استعمال کرے۔ ویب پر اس کا موجودہ رویہ **بعینہٖ برقرار** رہے (ویب صارفین کے لیے کوئی regression نہیں)۔

**FR-3.2** `ShamelaSearchResult` (native) کو موجودہ `ResourceResult` کی شکل میں ڈھالا جائے — وہی `citation_ref { book, scholar, page }`، تاکہ `useResourceSearch.ts` میں کچھ نہ بدلے۔

**FR-3.3** ⚠️ **راستہ A بغیر ٹوکن:** یہ لفظی (Lucene) تلاش ہے — اس میں کوئی embedding یا AI کال نہ ہو۔

**FR-3.4** `tools/shamela-bridge/` حذف ہو، اور `.bat`/`.sh` کے حوالے دستاویزات سے نکلیں۔ **یہی SPEC-M5 کا «صفر انحصار» exit criterion ہے۔**

**FR-3.5** ناکامی پر `shamelaNative` کے صریح پیغامات (JRE نہیں ملا، store index نہیں ملا) صارف تک **جوں کے توں** پہنچیں — خالی نتیجہ نہیں (R15/R25)۔

### FR-4 · G7 — موڈ بیج اور متفرق

**FR-4.1** `AppLayout` میں مستقل بیج: مقامی موڈ میں **«مقامی»**، cloud میں کچھ نہیں (یا **«کلاؤڈ»**) — R9 کا تدارک، تاکہ صارف کو ہمیشہ معلوم ہو اس کا کام کہاں ہے۔

**FR-4.2** `ByokKeyPanel.tsx:119` کا **«کامران» → «کامیاب»**۔

**FR-4.3** تشخیصی رپورٹ کے لیے **«کاپی کریں»** بٹن (FR-5.9 کا تقاضا، ابھی غائب)۔

**FR-4.4** ڈیسک ٹاپ پر `graph-extract` کا انکار بہتر ہو — «ابھی دستیاب نہیں» کے بجائے یہ بتائے کہ Graph ٹیب مقامی موڈ میں کیوں نہیں۔

**FR-4.5** ڈیسک ٹاپ پر Extract/Translate کا چھپنا جان بوجھ کر ہے یا سہو — طے کر کے `AppLayout.tsx:49-63` میں `desktop:` صراحتاً لکھا جائے۔

---

## 4. تکنیکی ڈیزائن

### 4.1 نئی فائلیں (سب ≤300 سطور)

| فائل | ذمہ داری |
|---|---|
| `shared/text/documentChunks.ts` | 1200/150 کا sentence-aware chunker — **واحد نقل**، Deno + Node دونوں کے لیے |
| `electron/db/ingest.ts` | مقامی ingest کا راستہ (FR-1) |
| `electron/db/fileStore.ts` | `userData/files/` میں فائل رکھنا/حذف کرنا (FR-1.8) |
| `electron/shamela/import.ts` | صفحہ بہ صفحہ پڑھ کر ingest میں ڈالنا (FR-2.4) |
| `electron/shamela/estimate.ts` | درآمد کا تخمینہ (FR-2.2) |
| `src/components/shamela/ImportEstimateDialog.tsx` | BYOK کے لیے مجموعی تخمینے کا ڈائلاگ (FR-2.3) |
| `src/components/ModeBadge.tsx` | مقامی/کلاؤڈ بیج (FR-4.1) |

### 4.2 تبدیل ہونے والی فائلیں

| فائل | تبدیلی |
|---|---|
| `supabase/functions/library-ingest/index.ts` | مقامی `chunkDocumentText` حذف → `shared/` سے import |
| `electron/ipc/aiHandlers.ts` | `library-ingest` انکار کی فہرست سے نکلے |
| `electron/ipc/shamelaHandlers.ts` | `estimateImport` اور `importBooks` actions |
| `electron/preload.ts` | انہی دو کا اضافہ (IPC allowlist سمیت) |
| `src/components/shamela/ShamelaImportDialog.tsx` | stub `handleImport` → اصل تخمینہ + درآمد |
| `src/components/shamela/ShamelaConnectPanel.tsx` | دونوں مردہ بٹنوں پر `onClick` + کاپی بٹن |
| `src/lib/shamela/localShamelaService.ts` | ڈیسک ٹاپ پر native IPC |
| `src/components/AppLayout.tsx` | موڈ بیج |
| **حذف:** `tools/shamela-bridge/` | FR-3.4 |

### 4.3 اہم اصول

1. **`ingestOrchestrator.ts` کو ہاتھ نہ لگے۔** مقامی راستہ وہی contract پورا کرے۔ اگر orchestrator بدلنا پڑے تو ڈیزائن غلط ہے۔
2. **chunker کی دوسری نقل ممنوع** — CI کا `shared/` گارڈ پہلے سے موجود ہے؛ یہ اسی اصول کا تسلسل ہے۔
3. **شاملہ ہمیشہ readonly** — کوئی write راستہ موجود ہی نہ ہو۔
4. **مقامی corpus کبھی مشترکہ `scholarly_documents` میں نہ لکھے** (R11)۔

---

## 5. مراحل اور تخمینہ

| مرحلہ | کام | دن |
|---|---|---|
| **M5.9.1** | **G4 — مقامی ingest** (FR-1): chunker کی `shared/` منتقلی، `ingest.ts`، fileStore، aiHandlers کی وائرنگ، ٹیسٹ | 4 |
| **M5.9.2** | **G6 — native تلاش** (FR-3): وائرنگ، mapping، `tools/shamela-bridge/` کی حذف، ٹیسٹ | 2 |
| **M5.9.3** | **G5 — شاملہ درآمد** (FR-2): تخمینہ + ڈائلاگ + درآمد + پیش رفت + حوالہ | 5 |
| **M5.9.4** | **G7 — بیج و متفرق** (FR-4) | 1 |
| **M5.9.5** | QA-M5 کی مکمل تصدیق صاف Windows VM پر | 2 |

**کل: ۱۴ ورکنگ دن**

### ترتیب کا جواز

- **G4 پہلے** — G5 اسی پر کھڑا ہے، اور یہ M5.3 کا exit criterion بھی کھولتا ہے۔
- **G6 دوسرا اور G5 سے پہلے** — یہ آزاد اور چھوٹا ہے، اور «صفر انحصار» کا سب سے اہم exit criterion فوراً پاس کرا دیتا ہے۔ G5 کے بعد رکھنے کا کوئی فائدہ نہیں۔
- **G5 تیسرا** — سب سے بھاری، اور اسے G4 کی ثابت شدہ پائپ لائن چاہیے۔
- **G7 آخر میں** — معمولی، اور کسی چیز کو نہیں روکتا۔

---

## 6. خطرات

| # | خطرہ | شدت | تدارک |
|---|---|---|---|
| **N1** | مقامی ingest cloud سے مختلف chunk حدود بنائے → وہی متن دو corpora میں الگ الگ بٹے | **بلند** | FR-1.3: ایک ہی chunker، `shared/` میں؛ Deno کاپی حذف؛ CI کا گارڈ نگرانی کرے |
| **N2** | شاملہ کی درآمد صارف کا Gemini بل بڑھا دے | **بلند** | FR-2.3 کا لازمی تخمینہ؛ کوئی «سب درآمد کریں» بٹن نہیں؛ تصدیق سے پہلے صفر network |
| **N3** | 40,000 کتب کی فہرست پر UI جم جائے | **متوسط** | فہرست پہلے سے `limit`/`offset` پر ہے؛ درآمد main process میں، renderer صرف پیش رفت دکھائے |
| **N4** | فی صفحہ Java helper spawn کرنے سے درآمد بہت سست ہو (ہر کال ایک نیا JVM) | **بلند** | helper کو **ایک کتاب کے سب صفحات ایک ہی spawn** میں دینے کا command شامل ہو؛ ورنہ 500 صفحات = 500 JVM |
| **N5** | native تلاش پر منتقلی ویب کی شاملہ تلاش توڑ دے | **متوسط** | FR-3.1: ویب کا راستہ بعینہٖ برقرار؛ صرف `isDesktop()` پر شاخ |
| **N6** | ادھوری درآمد کے بعد corpus میں آدھی کتاب رہ جائے اور حوالہ غلط دے | **متوسط** | فی کتاب atomic: کتاب مکمل ہونے پر ہی item `ready` ہو؛ ورنہ صاف طور پر نامکمل نشان زد |

---

## 7. Exit Criteria

### G4 — مقامی ingest
- [ ] 300 صفحات کا PDF ڈیسک ٹاپ پر ingest ہو، پیش رفت نظر آئے، ایڈیٹر جواب دہ رہے۔
- [ ] بیچ میں Cancel → chunks محفوظ → دوبارہ چلانے پر **وہیں سے** شروع۔
- [ ] `corpus_meta` کا ماڈل بدل کر تلاش → **صریح انکار**، خالی نتیجہ نہیں۔
- [ ] item حذف → chunks، vectors، **اور** `files/` کی اصل فائل تینوں ختم۔
- [ ] `shared/text/documentChunks.ts` کی **ایک ہی** نقل — Deno اور Node دونوں وہیں سے لیں (CI گارڈ سبز)۔

### G6 — native تلاش
- [ ] ⚠️ **`tools/shamela-bridge/` حذف کر کے** شاملہ کی تلاش مکمل کام کرے۔
- [ ] پوری لائبریری میں لفظی تلاش چلے، **کوئی ٹوکن نہ کٹے**۔
- [ ] ویب ورژن کی شاملہ تلاش بعینہٖ پہلے جیسی۔

### G5 — شاملہ درآمد
- [ ] «بک براؤزر» بٹن سے ڈائلاگ کھلے (اب مردہ نہ رہے)۔
- [ ] تین کتابیں منتخب → **مجموعی تخمینے کا ایک ہی ڈائلاگ** → تصدیق سے پہلے **صفر network** → درآمد مکمل۔
- [ ] `citations` پر source card میں **کتاب + جلد + صفحہ**۔
- [ ] شاملہ کی فائلوں کا checksum درآمد سے پہلے اور بعد **یکساں**۔
- [ ] پہلے سے درآمد شدہ کتاب نشان زد ہو اور دوبارہ خرچ نہ ہو۔

### G7
- [ ] موڈ بیج ہر اسکرین پر نظر آئے۔
- [ ] «کامیاب» درست ہو؛ تشخیصی رپورٹ کا کاپی بٹن کام کرے۔

### عمومی
- [ ] `npm run typecheck && npm run test && npm run lint && npm run build` — چاروں صاف (CI خود جانچے گا)۔
- [ ] `npm run build:electron` کامیاب۔
- [ ] [QA-M5.md](./QA-M5.md) کا §A خالی ہو جائے — تینوں خلا بند۔

---

## 8. تصدیق

```bash
npm run typecheck && npm run test && npm run lint && npm run build && npm run build:electron
```

پھر [QA-M5.md](./QA-M5.md) مکمل چلائیں — خاص طور پر §5.2 (شاملہ کے سات ناکام منظر) اور §4 (مقامی ذخیرہ)، جو اب پہلی بار واقعی قابلِ جانچ ہوں گے۔

---

## 9. کھلے سوالات

1. **N4 کا فیصلہ:** کیا Java helper میں «پوری کتاب ایک ساتھ» والا command شامل کیا جائے (تیز مگر helper میں تبدیلی)، یا فی صفحہ spawn قبول کیا جائے (سست مگر helper جوں کا توں)؟ **تجویز: پہلا** — 500 صفحات پر 500 JVM ناقابلِ قبول ہے۔
2. **FR-4.5:** ڈیسک ٹاپ پر Extract اور Translate کا چھپنا مطلوب تھا یا سہو؟
3. کیا `graph-extract` کا مقامی راستہ M6 میں جائے گا، یا ڈیسک ٹاپ پر Graph ٹیب مستقل غائب رہے گا؟
