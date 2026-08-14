# SPEC-M2 — 3-Pillar Workspace Shell

**حیثیت:** منظور شدہ · **ورژن:** 2.1.0 · **تاریخ:** 2026-07-28
**برانچ:** `newee` → feature flag کے پیچھے ہفتہ وار `main`
**تخمینہ:** 21–24 ورکنگ دن · **پیش شرط:** M0 + M1 مکمل ✅
**فیصلے:** §10 میں درج (مشاورت مکمل)

> **ریٹائرڈ نوٹ (UX-v1 P3، 2026-08-14):** `VITE_WORKSPACE_SHELL` فلیگ حذف کر
> دیا گیا ہے — کسی بھی shipped build میں یہ کبھی `false` سیٹ نہیں تھا، لہٰذا
> M1 fallback (`/editor`, `/research` کے پرانے صفحات) مردہ کوڈ تھا۔ نیچے اس
> فلیگ کے تمام حوالے تاریخی سیاق کے لیے جوں کے توں چھوڑے گئے ہیں۔ اب
> `/editor` اور `/research` صرف bookmark کی خاطر `/workspace` پر redirect
> کرتے ہیں (`src/components/RedirectToWorkspace.tsx`)۔

---

## 1. سیاق — یہ مرحلہ کیوں؟

M1 نے دستاویز کو وجود دیا (`projects`/`documents`/`document_versions`/`task_runs`، autosave، Library)۔ مگر ایپ اب بھی **الگ الگ صفحات کا مجموعہ** ہے: سائیڈبار میں **10 نیویگیشن آئٹمز** ہیں، اور محقق کو ایک ہی کام کے لیے `/research` اور `/editor` کے درمیان آنا جانا پڑتا ہے — ہر بار سیاق (context) ٹوٹتا ہے۔

Constitution کا §1 (Golden Principle 2 — *Cognitive Continuity*) اور §4 (تین ستون) اسی کا علاج ہیں۔ M2 کا کام یہی ہے: **ایک ایسا ماحول جہاں تحقیق اور تحریر ساتھ ساتھ ہوں، اور کہیں جانے کی ضرورت نہ پڑے۔**

**بنیادی صارف (طے شدہ):** مفتی / محقق۔ ہر ڈیزائن فیصلہ اسی سے پرکھا جائے: *"کیا اس سے سوال → دلیل → مسودہ کا سفر کم رکاوٹ والا ہوا؟"*

### 1.1 جو پہلے سے موجود ہے (دوبارہ نہ بنائیں)

| ضرورت | پہلے سے موجود |
|---|---|
| Resizable panels | [ui/resizable.tsx](../src/components/ui/resizable.tsx) (`react-resizable-panels`) |
| Command palette | [ui/command.tsx](../src/components/ui/command.tsx) (`cmdk`) |
| موبائل drawer | [ui/sheet.tsx](../src/components/ui/sheet.tsx) |
| تحقیق کی پوری سطح | [ChatDisplay](../src/components/research/ChatDisplay.tsx)، [SourcesPanel](../src/components/research/SourcesPanel.tsx)، [useResearchChat](../src/hooks/useResearchChat.ts) |
| دستاویز کی حالت | [useDocument](../src/core/workspace/useDocument.ts)، [documentService](../src/core/workspace/documentService.ts) |
| collapsed حالت محفوظ کرنا | [useSidebarCollapsed](../src/hooks/useSidebarCollapsed.ts) کا نمونہ |

---

## 2. Non-Goals (M2 میں **نہیں**)

- مکمل Bubble Menu اور Slash commands، AI Task Library — **M3** (M2 میں صرف انتخاب کی پٹی، FR-3.3)
- Trust UI (§3 کے source cards / confidence) — **M3**
- **بڑی دستاویز کے لیے پیراگراف بہ پیراگراف chunking** + پیش رفت + منسوخی — **M3** (FR-9.4)
- Knowledge Graph، Entity Cards — بعد میں
- Agents (Level 3)، Proactive AI (Level 4) — بعد میں
- OCR / Transcribe / Speak کو panels میں ضم کرنا — یہ اپنے صفحات پر رہیں گے (بتدریج ضم کا فیصلہ)
- Real-time collaboration، Yjs
- `translation_chunks` کی ساخت میں کوئی تبدیلی

---

## 3. Functional Requirements

### FR-1 · Workspace Shell اور Routes

- **FR-1.1** نیا route: `/workspace/:documentId`۔ یہی M2 کا مرکزی داخلی دروازہ ہے۔
- **FR-1.2** `/workspace` (بغیر id) وہی حل کرے جو M1 میں `/editor` کرتا ہے: آخری خالی document دوبارہ استعمال، ورنہ نیا بنا کر redirect (`documentService.findBlankDocument`)۔
- **FR-1.3** پرانے routes **باقی رہیں** اور feature flag `VITE_WORKSPACE_SHELL` کے تحت `/workspace` پر redirect کریں:
  - `/editor/:documentId` → `/workspace/:documentId`
  - `/research` → `/workspace/:documentId?panel=research`
  - flag بند ہو تو پرانا رویہ بالکل بدستور — یہی ہفتہ وار `main` میں merge کی ضمانت ہے۔
- **FR-1.4** Workspace **`AppLayout` استعمال نہ کرے**۔ نیا `WorkspaceLayout` بنے، کیونکہ AppLayout کا سائیڈبار خود Library ستون سے متصادم ہے (ورنہ چار کالم بن جائیں گے)۔
- **FR-1.5** ڈیسک ٹاپ ڈھانچہ — `ResizablePanelGroup direction="horizontal"`:

```
┌──────────────────────────────────────────────────────────────────────┐
│ TopBar: عنوان │ محفوظ شدہ │ ⌘K │ Export │ RTL/LTR │ Workbench ⇥      │
├────────────┬───────────────────────────────────┬─────────────────────┤
│ 1 LIBRARY  │ 2 CANVAS                          │ 3 WORKBENCH         │
│ 240–320px  │ flex, min 480px                   │ 320–480px           │
│ سمٹ سکتا  │                                    │ بند رہتا ہے (default)│
└────────────┴───────────────────────────────────┴─────────────────────┘
```

- **FR-1.6** ہر panel کی چوڑائی اور collapsed حالت `localStorage` میں محفوظ (`workspace.panels`)۔
- **FR-1.7** **RTL:** panels کی ترتیب منطقی ہو (Library = start edge)۔ `dir="rtl"` میں Library بصری طور پر دائیں آئے۔ `ResizableHandle` کی drag سمت بھی درست ہو — یہ الگ سے جانچا جائے (NFR-4)۔

### FR-2 · ستون ۱ — Library

- **FR-2.1** درجہ بندی: `Projects → Documents`۔ [Library.tsx](../src/pages/Library.tsx) کی موجودہ منطق یہاں منتقل ہو (صفحہ بطور fallback باقی رہے)۔
- **FR-2.1.1** `kind='translation'` والا project کھولنے پر [TranslationWorkspace](../src/pages/TranslationWorkspace.tsx) **پورے Canvas** میں کھلے، Workbench کے ٹیب میں نہیں۔
  > وجہ: وہ chunk بہ chunk + translation memory کا اپنا مکمل ورک اسپیس ہے (494 سطور)؛ تیسرے ستون کی 320–480px میں نہیں سماتا۔ Workbench کا Translate ٹیب اس سے مختلف چیز ہے — فوری ترجمہ (FR-4.1.2)۔
- **FR-2.2** ہر document پر کلک → Canvas میں کھلے، **صفحہ دوبارہ لوڈ کیے بغیر** (URL بدلے، shell قائم رہے)۔
- **FR-2.3** ٹیبز: `Documents` | `Sources`۔ `Sources` ٹیب `library_items` دکھائے (M1 میں ٹیبل بن چکا ہے، ابھی خالی — M2 میں صرف پڑھنے کی سطح)۔
- **FR-2.4** "+ نیا" مینو: نیا Project، نئی Document، اور **"Library میں شامل کریں"** جو موجودہ ingest صفحات پر بھیجے (`/ocr`, `/transcribe`, `/speak`) — یہی ان کے ضم ہونے کا عارضی پل ہے۔
- **FR-2.5** تلاش کا خانہ جو `documents.plain_text` پر چلے (M1 کا `plain_text` کالم اسی لیے بنا تھا)۔ دائرہ: **تمام projects**، اور ہر نتیجے کے ساتھ اس کے project کا نام دکھایا جائے — محقق کو اکثر یاد نہیں رہتا کہ کوئی بات کس پروجیکٹ میں لکھی تھی، اور یہی تلاش کا اصل مقصد ہے۔
- **FR-2.6** سمٹی ہوئی حالت میں صرف آئیکن رہ جائیں (موجودہ سائیڈبار کا رویہ)۔

### FR-3 · ستون ۲ — Canvas

- **FR-3.1** [RichEditor](../src/components/editor/RichEditor.tsx) بغیر کسی تبدیلی کے یہاں بیٹھے۔ M1 کے سب rawabit (autosave، `contentRevision`، `onDocChange`) جوں کے توں۔
- **FR-3.2** Canvas صرف اُس وقت mount ہو جب document لوڈ ہو چکی ہو (M1 کا `docLoading` gating برقرار — یہی مواد ضائع ہونے سے بچاتا ہے)۔
- **FR-3.3** **متن منتخب کرنے پر ایک چھوٹی ایکشن پٹی** ظاہر ہو۔ اس کے مشتملات:
  - `Workbench میں تحقیق کریں` — منتخب متن Workbench کے سوال کے خانے میں بھرے اور Workbench کھولے
  - **پانچ AI ایکشنز جو واقعی منتخب متن پر چلتے ہیں:** حرکات لگائیں · حرکات ہٹائیں · املا · تفہیم (paraphrase) · خلاصہ · **حوالہ جات**
  - **`auto_format` پٹی میں نہ ہو** — وہ بلا انتخاب پوری دستاویز پر چلتا ہے (`editor.getText()` + `setContent`)، اس لیے انتخاب کی پٹی میں اس کا ہونا صارف کو دھوکا دے گا۔ وہ ٹول بار میں ہی رہے۔
- **FR-3.3.1** **ٹول بار جوں کا توں رہے۔** کوئی ایکشن وہاں سے ہٹایا نہ جائے — موجودہ صارفین کا عادی راستہ نہ ٹوٹے۔ پٹی ایک اضافی، تیز تر راستہ ہے۔
- **FR-3.3.2** ہر handler پہلے سے [RichEditor.tsx](../src/components/editor/RichEditor.tsx) میں موجود ہے (`handleAddHarakat`، `handleSpellCheck`، `handleParaphrase`، `handleSummarize`، `handleCitations`، `handleRemoveHarakat`)۔ **نئی AI منطق نہ لکھی جائے** — صرف انہیں پٹی سے بھی بلایا جائے، اور FR-9 کی درستیاں لاگو ہوں۔
  > یہی feature تین ستونوں کی افادیت ثابت کرتا ہے اور M3 کے مکمل Bubble Menu (slash commands + Task Library کے ساتھ) کی بنیاد بنتا ہے۔
- **FR-3.4** Version History اور Export اب TopBar میں منتقل ہوں (FR-5)۔

### FR-4 · ستون ۳ — Workbench

- **FR-4.1** ٹیبز: `Research` · `Translate` · `Extract` — تینوں M2 میں فعال۔ باقی (Knowledge Graph، OCR) M3+۔
- **FR-4.1.1** ہر ٹیب کا صفحہ اسی طرح دو حصوں میں کٹے جیسے Research (FR-4.2): [Extract.tsx](../src/pages/Extract.tsx) → `ExtractPanel`، [Translate.tsx](../src/pages/Translate.tsx) → `TranslatePanel`۔ پرانے routes اپنے panels کو `AppLayout` میں لپیٹ کر چلتے رہیں۔
- **FR-4.1.2** `Translate` ٹیب = **فوری ترجمہ** ([Translate.tsx](../src/pages/Translate.tsx))، نہ کہ پروجیکٹ والا ورک اسپیس (وہ FR-2.1.1 کے تحت Canvas میں کھلتا ہے)۔
- **FR-4.1.3** Workbench **بطورِ default بند** ہو (Constitution §1.3 — *Workbench on Demand*)، سوائے اس صورت کے کہ صارف `/research` سے redirect ہو کر آیا ہو — تب Research ٹیب کے ساتھ کھلا ہو۔ اس کے بعد صارف کی آخری حالت `localStorage` میں محفوظ رہے (FR-1.6)۔
- **FR-4.2** [Research.tsx](../src/pages/Research.tsx) کو دو حصوں میں کاٹا جائے:
  - `src/components/research/ResearchPanel.tsx` — پوری تحقیقی سطح، **بغیر `AppLayout`، بغیر `useSeo`**
  - `src/pages/Research.tsx` — صرف `<AppLayout><ResearchPanel /></AppLayout>` (پرانا route چلتا رہے)
  کوئی نئی منطق نہ لکھی جائے؛ یہ خالص extraction ہے۔
- **FR-4.3 · لازمی:** Workbench بند کرنے پر **unmount نہ ہو**۔ CSS سے چھپایا جائے (`hidden`)، تاکہ:
  - SSE stream درمیان میں نہ ٹوٹے،
  - چیٹ کی تاریخ اور جاری جواب محفوظ رہیں۔
  > یہ Golden Principle 2 کا براہِ راست تقاضا ہے، اور اس کوڈبیس میں یہ خطرہ ثابت شدہ ہے — [vite.config.ts](../vite.config.ts) میں PWA کے `registerType: "prompt"` کا تبصرہ بتاتا ہے کہ خودکار reload پہلے بھی Research کے جاری جوابات مٹا چکا ہے۔
- **FR-4.4** quota/token چپ (`researchQueriesUsed / Limit`) Workbench کے اندر نظر آتی رہے — آمدنی کا راستہ نظروں سے اوجھل نہ ہو۔
- **FR-4.5** جواب پر `Canvas میں داخل کریں` کا بٹن، جو منتخب جواب (یا اس کا حوالہ) Canvas کے cursor پر داخل کرے۔ [RichEditor](../src/components/editor/RichEditor.tsx) کا موجودہ `handleInsertResource` اسی کا نمونہ ہے۔

### FR-5 · TopBar

- **FR-5.1** بائیں: Project › Document کا breadcrumb، عنوان قابلِ ترمیم (M1 کا `handleTitleChange`)۔
- **FR-5.2** درمیان: autosave کی حالت (`Saving…` / `Saved` / `Save error`) — M1 کے badges منتقل ہوں۔
- **FR-5.3** دائیں: `⌘K` · Export مینو · Version History · RTL/LTR · Workbench ٹوگل · اطلاعات · [AppVersionBadge](../src/components/AppVersionBadge.tsx)۔
- **FR-5.4** 360px پر TopBar میں صرف: عنوان، محفوظ شدہ کی علامت، اور ایک `⋯` مینو۔

### FR-6 · Ctrl+K Spotlight

- **FR-6.1** `Ctrl+K` / `⌘K` سے `cmdk` ڈائیلاگ کھلے۔
- **FR-6.2** M2 کے کمانڈز (سب مقامی، کوئی AI نہیں):
  - دستاویز پر جائیں (عنوان + `plain_text` پر تلاش)
  - Project پر جائیں
  - نئی دستاویز / نیا Project
  - Workbench کھولیں/بند کریں · Research ٹیب
  - RTL/LTR · زبان بدلیں
  - Export (Word / PDF / HTML / TXT)
- **FR-6.3** `Esc` بند کرے؛ فوکس واپس Canvas پر جائے۔
- **FR-6.4** اردو/عربی عنوانات پر تلاش درست چلے (diacritics کے بغیر بھی — [stripHarakat](../src/utils/arabicUtils.ts) موجود ہے)۔

### FR-7 · نیویگیشن کی تلخیص (10 → 3)

موجودہ 10 آئٹمز (+admin) کو تین گروہوں میں سمیٹا جائے۔ **کوئی route حذف نہ ہو** — صرف نمائش بدلے:

| گروہ | مشتملات | route |
|---|---|---|
| **Workspace** | Library + Canvas + Workbench | `/workspace` |
| **Tools** | Transcribe · OCR · Speak · Extract · Translate | اپنے موجودہ صفحات |
| **Admin** | جوں کا توں (شرطی) | `/admin` |

- **FR-7.1** `book-workspace` اور `translate-workspace` Library کے اندر بطور Project کی قسم (`kind`) نظر آئیں، الگ نیویگیشن آئٹم کے طور پر نہیں۔
- **FR-7.2** موبائل کی نچلی پٹی زیادہ سے زیادہ 4 آئٹمز: Workspace · Tools · Library · Profile۔

### FR-8 · موبائل (360px)

- **FR-8.1** Canvas پورا صفحہ گھیرے۔
- **FR-8.2** Library = start edge سے `Sheet`؛ Workbench = end edge سے `Sheet`۔
- **FR-8.3** Workbench موبائل پر بھی بند ہونے کے بعد **حالت نہ کھوئے** (FR-4.3 وہاں بھی لاگو)۔
- **FR-8.4** کی بورڈ کھلنے پر Canvas کا composer نہ چھپے (safe-area + `dvh`)۔

### FR-9 · AI ایکشنز کا دائرہ اور حفاظت

FR-3.3 انہی ایکشنز کو زیادہ نمایاں کر رہا ہے، اس لیے پہلے ان کی موجودہ خرابیاں ٹھیک ہوں۔ چاروں کوڈ میں تصدیق شدہ ہیں:

- **FR-9.1 · data-loss کی درستی (لازمی، سب سے پہلے)**
  [RichEditor.tsx](../src/components/editor/RichEditor.tsx) کا `runTextAction` منتخب متن بھیجتا ہے، مگر `action === "citations"` پر نتیجہ `editor.commands.setContent(textToHtml(result))` سے **پوری دستاویز** بدل دیتا ہے۔ یعنی آج ایک پیراگراف منتخب کر کے "حوالہ جات" دبانے سے **باقی سارا مسودہ مٹ جاتا ہے۔**
  → نتیجہ ہمیشہ اُسی حد میں داخل ہو جو بھیجی گئی تھی (`insertContentAt({ from, to })`)۔ `setContent` صرف تب جب واقعی پوری دستاویز مقصود ہو۔

- **FR-9.2 · فارمیٹنگ محفوظ رہے**
  `textToHtml` صرف `<p>` بلاک بناتا ہے — عنوانات، blockquote، فہرستیں، جدول، bold سب ضائع۔ یہ بعینہٖ وہی نقصان ہے جو M1 میں کتاب کی ہجرت کے وقت ٹھیک کیا گیا۔
  → وہی راستہ اپنایا جائے: [editorExtensions.ts](../src/components/editor/editorExtensions.ts) کے schema کے ساتھ `generateJSON` / `insertContent`، نہ کہ سادہ `<p>` بنانا۔

- **FR-9.3 · حجم کی حد (client + server)**
  [refine-text/index.ts](../supabase/functions/refine-text/index.ts) پوری دستاویز ایک ہی user message میں بھیجتا ہے — نہ cap، نہ chunking، اور فنکشن non-streaming ہے۔ بڑی دستاویز پر edge function کا timeout یا لمبا منجمد ہونا یقینی ہے۔
  → دونوں طرف ایک واضح حد (تجویز: ~12,000 حروف فی درخواست)۔ حد سے اوپر درخواست بھیجی ہی نہ جائے؛ اس کے بجائے صارف کو صاف پیغام: *"دستاویز بڑی ہے — متن منتخب کریں، یا حصہ بہ حصہ چلائیں۔"*
  → **حوالہ جات دونوں طرح چلیں:** منتخب متن پر بھی، پوری دستاویز پر بھی۔ حد سے چھوٹی/درمیانی دستاویز پر "پوری دستاویز" جوں کا توں کام کرے۔

- **FR-9.4 · بڑی دستاویز → M3**
  حد سے اوپر والی صورت کے لیے پیراگراف بہ پیراگراف chunking + پیش رفت کی پٹی + منسوخی + جزوی نتائج کا محفوظ ہونا — یہ فطری طور پر AI Task Library کا Level 2/3 workflow ہے، اس لیے M3 میں اسی کے ساتھ بنے گا۔ **M2 میں صرف حد اور واضح پیغام۔**

- **FR-9.5 · ٹوکن کی لاگت حجم کے مطابق**
  ابھی `calculateCost("refine", 1)` ہمیشہ 5 ٹوکن دیتا ہے — ایک جملہ ہو یا پوری کتاب۔
  → لاگت متن کی لمبائی سے نکالی جائے (تجویز: ہر شروع ہونے والے ~2000 حروف = 5 ٹوکن)۔ چھوٹے انتخاب کی قیمت عملاً وہی رہے، تاکہ موجودہ صارفین پر اثر نہ پڑے۔

- **FR-9.6 · معلوم حد، M3 کے لیے درج**
  [refine-text/index.ts:129](../supabase/functions/refine-text/index.ts:129) پر حوالہ جات کی RAG query `text.slice(0, 4000)` ہے — یعنی لمبی دستاویز پر حوالہ جات صرف پہلے ~4000 حروف کے سیاق سے تلاش ہوتے ہیں۔ M2 میں **نہ چھیڑیں** (حد لگنے کے بعد اثر محدود رہے گا)؛ FR-9.4 کے chunking کے ساتھ M3 میں درست ہو۔

---

## 4. Non-Functional Requirements

| # | تقاضا |
|---|---|
| NFR-1 | Panel کھولنے/بند کرنے پر کوئی network درخواست دوبارہ نہ چلے |
| NFR-2 | Canvas ↔ Workbench سوئچ کرنے پر ایڈیٹر کا cursor اور undo تاریخ برقرار |
| NFR-3 | Workspace کا پہلا paint < 2s (mid-tier موبائل، 4G) |
| NFR-4 | مکمل RTL: panel ترتیب، resize handles، Sheet کی سمت — تینوں 360px اور ڈیسک ٹاپ پر جانچے جائیں |
| NFR-5 | WCAG 2.1 AA: ہر panel قابلِ رسائی بذریعہ کی بورڈ؛ panel ٹوگل پر `aria-expanded` |
| NFR-6 | `npm run typecheck` صفر errors، `npm run lint` صفر errors |
| NFR-7 | نئی فائل 300 سطور سے تجاوز نہ کرے (SPEC-v2 کا قاعدہ) |

---

## 5. تکنیکی ڈیزائن

### 5.1 نئی/بدلنے والی فائلیں

```
src/core/workspace/
  WorkspaceContext.tsx        (نیا) فعال project/document، panel کی حالت، selection→workbench پل
  usePanelState.ts            (نیا) چوڑائیاں + collapsed، localStorage میں محفوظ

src/components/workspace/
  WorkspaceLayout.tsx         (نیا) TopBar + ResizablePanelGroup
  WorkspaceTopBar.tsx         (نیا)
  LibraryPanel.tsx            (نیا) Library.tsx کی منطق سے
  CanvasPanel.tsx             (نیا) RichEditor + selection ایکشن پٹی
  WorkbenchPanel.tsx          (نیا) ٹیبز + ہمیشہ mounted بچے
  CommandPalette.tsx          (نیا) cmdk

src/components/research/
  ResearchPanel.tsx           (نیا) Research.tsx سے نکالا گیا، بغیر AppLayout

src/pages/
  Workspace.tsx               (نیا) route کا داخلی نقطہ
  Research.tsx                (سکڑ کر) <AppLayout><ResearchPanel/></AppLayout>
  Editor.tsx                  (باقی) flag بند ہو تو پرانا رویہ
  Library.tsx                 (باقی) fallback صفحہ

src/App.tsx                   /workspace اور /workspace/:documentId
src/components/AppLayout.tsx  sectionNav 10 → 3 گروہ (FR-7)
```

### 5.2 حالت (State) کا اصول

- **دستاویز کی حالت** `useDocument` میں ہی رہے — M2 اس کو ہاتھ نہ لگائے۔
- **Panel کی حالت** `usePanelState` میں (خالص UI، کوئی سرور کال نہیں)۔
- **Workbench کی حالت** `ResearchPanel` کے اپنے hooks میں رہے، اور panel ہمیشہ mounted رہے (FR-4.3)۔
- **Canvas ↔ Workbench رابطہ** `WorkspaceContext` کے ذریعے، دو سادہ سگنلز سے:
  - `sendSelectionToWorkbench(text: string)`
  - `insertIntoCanvas(html: string)`
  کوئی گہری coupling نہ ہو — یہی دونوں M3 میں AI Task Library کے لیے بھی کافی ہوں گے۔

### 5.3 Feature Flag

`VITE_WORKSPACE_SHELL` (`.env` سے)۔ بند = پرانی ایپ بالکل بدستور۔ اسی کی بدولت M2 کے دوران ہر ہفتے `main` میں merge محفوظ رہے گا۔

---

## 6. مراحل اور تخمینہ

| مرحلہ | کام | دن |
|---|---|---|
| **M2.0** | **FR-9.1/9.2 — data-loss اور فارمیٹنگ کی درستی** | 1 |
| **M2.1** | `WorkspaceLayout` + `usePanelState` + خالی تین panels + flag + route | 2 |
| **M2.2** | `LibraryPanel` (FR-2) — Library.tsx سے منتقلی + تلاش (تمام projects) | 2 |
| **M2.3** | `CanvasPanel` (FR-3) + TopBar (FR-5) — M1 کے badges/export/versions کی منتقلی | 2–3 |
| **M2.4** | `ResearchPanel` extraction + `WorkbenchPanel` + keep-mounted (FR-4) | 3 |
| **M2.5** | انتخاب کی پٹی + Canvas↔Workbench پل (FR-3.3، FR-4.5) | 2–3 |
| **M2.6** | `ExtractPanel` + `TranslatePanel` ٹیبز (FR-4.1.1) | 3 |
| **M2.7** | FR-9.3/9.5 — حجم کی حد + ٹوکن لاگت | 1 |
| **M2.8** | Ctrl+K (FR-6) + نیویگیشن کی تلخیص (FR-7) | 2 |
| **M2.9** | موبائل + RTL + a11y پاس (FR-8، NFR-4/5) | 2 |

**کل: 21–24 دن**

**M2.0 سب سے پہلے کیوں؟** FR-3.3 انہی ایکشنز کو انتخاب کی پٹی میں لا کر زیادہ استعمال ہونے والا بنا رہا ہے۔ data-loss کا بگ پہلے ٹھیک نہ ہوا تو ہم ایک موجودہ خرابی کو زیادہ آسانی سے قابلِ رسائی بنا دیں گے۔ یہ ایک دن کا کام ہے اور flag سے آزاد ہے، اس لیے فوراً `main` میں جا سکتا ہے۔

---

## 7. Exit Criteria

- [ ] **ایک پیراگراف منتخب کر کے "حوالہ جات" چلانے سے باقی دستاویز محفوظ رہتی ہے** (FR-9.1) — اس کا ایک خودکار ٹیسٹ بھی ہو
- [ ] AI ایکشن کے بعد عنوانات/blockquote/فہرست/جدول/bold سب برقرار (FR-9.2)
- [ ] بہت بڑی دستاویز پر AI ایکشن **درخواست بھیجے بغیر** واضح پیغام دیتا ہے، ایپ منجمد نہیں ہوتی (FR-9.3)
- [ ] بڑے متن پر ٹوکن کی کٹوتی حجم کے مطابق ہوتی ہے؛ چھوٹے انتخاب پر پہلے جیسی (FR-9.5)
- [ ] `/workspace/:documentId` پر تینوں ستون کھلتے ہیں؛ چوڑائیاں اور collapsed حالت refresh کے بعد یاد رہتی ہیں
- [ ] Workbench پہلی بار بند ہے، مگر `/research` سے آنے پر Research ٹیب کے ساتھ کھلا (FR-4.1.3)
- [ ] Library سے دوسری document کھولنے پر صفحہ reload نہیں ہوتا اور Workbench کی چیٹ برقرار رہتی ہے
- [ ] Workbench بند کر کے دوبارہ کھولنے پر **جاری SSE جواب نہیں ٹوٹتا** (FR-4.3)
- [ ] Canvas میں متن منتخب کرنے پر پٹی آتی ہے؛ "تحقیق کریں" وہی متن Workbench میں بھیجتا ہے، اور پانچوں AI ایکشنز منتخب متن پر چلتے ہیں (FR-3.3)
- [ ] ٹول بار کا کوئی ایکشن غائب نہیں ہوا (FR-3.3.1)
- [ ] Workbench کے تینوں ٹیب (Research/Translate/Extract) کام کرتے ہیں؛ `kind='translation'` والا project پورے Canvas میں کھلتا ہے (FR-2.1.1)
- [ ] Workbench کے جواب کو Canvas میں داخل کیا جا سکتا ہے، اور autosave اسے محفوظ کرتا ہے
- [ ] Library کی تلاش تمام projects میں چلتی ہے اور نتیجے کے ساتھ project کا نام دکھاتی ہے (FR-2.5)
- [ ] `Ctrl+K` سے کسی بھی document پر اردو عنوان سے پہنچا جا سکتا ہے
- [ ] سائیڈبار میں 10 کے بجائے 3 گروہ؛ کوئی پرانا route ٹوٹا نہیں
- [ ] `VITE_WORKSPACE_SHELL=false` پر ایپ بالکل M1 جیسی چلتی ہے
- [ ] 360px پر تینوں ستون قابلِ استعمال، اردو RTL میں درست
- [ ] `npm run typecheck` · `npm run test` · `npm run lint` · `npm run build` — چاروں صاف

---

## 8. تصدیق (Verification)

```bash
npm run typecheck && npm run test && npm run lint && npm run build
```

دستی جانچ (ہر ایک لازمی):

0. **(FR-9، M2.0 کے فوراً بعد)** ایک ایسی دستاویز بنائیں جس میں عنوان، bold، ایک فہرست اور ایک blockquote ہو → درمیان کا ایک پیراگراف منتخب کریں → "حوالہ جات" چلائیں → **باقی دستاویز اور اس کی تمام فارمیٹنگ محفوظ رہنی چاہیے**۔ پھر بہت بڑی دستاویز پر وہی ایکشن → صاف پیغام آئے، ایپ منجمد نہ ہو۔
1. `/workspace` کھولیں → خالی document بنے یا دوبارہ استعمال ہو → عنوان لکھیں → refresh → عنوان باقی
2. Workbench کھول کر ایک تحقیقی سوال بھیجیں → **جواب آتے ہوئے** Workbench بند کریں → دوبارہ کھولیں → جواب مکمل ہوتا نظر آئے
3. Canvas میں عربی جملہ منتخب کریں → "تحقیق کریں" → Workbench میں وہی متن
4. جواب پر "Canvas میں داخل کریں" → متن ایڈیٹر میں → 2 سیکنڈ بعد `Saved` بیج → refresh → متن باقی
5. Library سے دوسری document پر جائیں → Workbench کی چیٹ ویسی کی ویسی
6. زبان اردو کریں → تینوں ستون اور resize handles درست سمت میں
7. 360px پر: Library اور Workbench دونوں Sheet کی صورت کھلیں اور بند ہونے پر حالت نہ کھوئیں
8. `VITE_WORKSPACE_SHELL=false` کے ساتھ build → `/editor` اور `/research` پرانے انداز میں

---

## 9. خطرات

| خطرہ | شدت | تدارک |
|---|---|---|
| Workbench بند ہونے پر SSE ٹوٹ جائے | بلند | unmount نہیں، CSS سے چھپانا (FR-4.3)؛ Exit criteria میں الگ ٹیسٹ |
| Research.tsx کی extraction میں رویہ بدل جائے | بلند | خالص extraction، کوئی نئی منطق نہیں؛ پرانا `/research` route ساتھ چلتا رہے |
| تین panels موبائل پر ناقابلِ استعمال | متوسط | موبائل پر Canvas-only + دو Sheets (FR-8) |
| RTL میں resize handles الٹی سمت | متوسط | NFR-4 میں الگ جانچ؛ منطقی ترتیب + `dir` |
| `newee` مہینوں الگ رہ جائے | بلند | feature flag، ہر مرحلہ (M2.1…M2.7) الگ merge |
| نیویگیشن بدلنے سے موجودہ صارف الجھیں | متوسط | پرانے routes زندہ؛ پہلی بار Workspace کھولنے پر مختصر رہنمائی |
| **انتخاب کی پٹی موجودہ data-loss بگ کو زیادہ قابلِ رسائی بنا دے** | **بلند** | **M2.0 سب سے پہلے** — FR-9.1/9.2 پٹی بننے سے پہلے ٹھیک ہوں، ٹیسٹ کے ساتھ |
| ٹوکن لاگت بدلنے سے موجودہ صارف کی کٹوتی بڑھ جائے | متوسط | ~2000 حروف تک قیمت وہی 5 ٹوکن رہے؛ صرف بڑے متن پر بڑھے |

---

## 10. فیصلوں کا ریکارڈ

| تاریخ | فیصلہ | وجہ |
|---|---|---|
| 2026-07-28 | Workbench بطورِ default بند، مگر `/research` سے آنے پر کھلا | Constitution §1.3 (*Workbench on Demand*)؛ لکھنے کی جگہ پوری ملے، مگر Research سے آنے والے کو وہی ملے جو وہ ڈھونڈ رہا تھا |
| 2026-07-28 | انتخاب کی پٹی میں 5 AI ایکشنز؛ `auto_format` باہر؛ ٹول بار جوں کا توں | `auto_format` بلا انتخاب پوری دستاویز پر چلتا ہے — انتخاب کی پٹی میں اس کا ہونا گمراہ کن ہوگا۔ ٹول بار برقرار رکھنے سے موجودہ صارفین کا عادی راستہ نہیں ٹوٹتا |
| 2026-07-28 | Extract اور Translate M2 میں ہی Workbench کے ٹیبز | Workbench ایک ٹیب کے ساتھ ادھورا لگتا ہے؛ دونوں extraction کا نمونہ Research جیسا ہی ہے |
| 2026-07-28 | Translate ٹیب = فوری ترجمہ؛ `/translate-workspace` بطور Canvas project | دونوں بالکل مختلف تجربے ہیں — پروجیکٹ + TM والا ورک اسپیس 320–480px میں نہیں سماتا |
| 2026-07-28 | Library کی تلاش تمام projects میں | محقق کو اکثر یاد نہیں رہتا کہ بات کس project میں لکھی تھی |
| 2026-07-28 | FR-9 شامل کیا گیا: data-loss، فارمیٹنگ، حجم کی حد، ٹوکن لاگت | صارف کے اس سوال سے نکلا کہ بڑی دستاویز پر نتائج خراب اور سسٹم سست ہوگا — جانچ پر ایک زندہ data-loss بگ بھی ملا |
| 2026-07-28 | بڑی دستاویز کا chunking M3 میں | یہ Level 2/3 multi-step workflow ہے؛ اس کا فطری گھر AI Task Library ہے |
