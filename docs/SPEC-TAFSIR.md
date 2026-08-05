# SPEC-TAFSIR — Tafsir MCP انضمام (ریموٹ HTTP + مقامی stdio)

**حیثیت:** منظور شدہ · **ورژن:** 1.1.0 · **تاریخ:** 2026-08-05
**تخمینہ:** 11 ورکنگ دن (5 مراحل) · **پیش شرط:** M5 (شاملہ انضمام) مکمل ✅
**فیصلے:** §8 میں درج (صارف سے منظور شدہ) · **کھلے سوالات:** §8.5
**نفاذی چیک لسٹ:** §12

---

## 1. سیاق + رہنما اصول

M5 نے شاملہ (شاملہ ۴) کو ایک مقامی، آف لائن ذریعے کے طور پر EasyEditor ڈیسک ٹاپ سے منسلک کیا — detect → diagnose → براؤز/تلاش → درآمد، سب electron main process میں، رینڈرر کی CSP بند رکھتے ہوئے۔

اب ایک دوسرا ذریعہ درکار ہے: **Tafsir MCP** (https://tafsirmcp.netlify.app/) — «مرکز تفسیر للدراسات القرآنية» کا اوپن سورس MCP سرور (v2.0.0, جولائی 2026)۔ اس کے دو مختلف طریقے ہیں:

1. **ریموٹ HTTP** — `https://mcp.tafsir.net/mcp` (Streamable HTTP)، بغیر انسٹال، لیکن انٹرنیٹ اور سرور کی دستیابی پر منحصر۔
2. **مقامی stdio** — Python پیکج `tafsir-mcp` (`pip` / `uvx`)، آف لائن SQLite ڈیٹابیس (~223 MB، پہلی بار Hugging Face سے)، لیکن صارف کے کمپیوٹر پر Python رن ٹائم درکار۔

شاملہ کے برعکس (جو صرف مقامی ہے کیونکہ وہ خود ایک نصب شدہ ونڈوز ایپ ہے)، Tafsir MCP کا مقامی راستہ **Python پر انحصار کرتا ہے** — جو بہت سے عام صارفین (خاص طور پر ویب/عربی تعلیمی پس منظر) کے پاس نہیں ہوگا۔ اس لیے صرف مقامی دینا کافی نہیں، اور صرف ریموٹ بھی کافی نہیں (سرور کی دستیابی ہمارے کنٹرول میں نہیں)۔ **دونوں دیے جائیں، ریموٹ ڈیفالٹ۔**

### 1.1 پانچ رہنما اصول (M3 §1.1 / M5 §1.2 سے برقرار)

1. **Cognitive Continuity (سیاق نہ ٹوٹے)**
2. **Workbench on Demand (تیسرا ستون ضرورت پر)**
3. **عالِم اجازت دیتا ہے، ہم نہیں (صارف کا حتمی اختیار)**
4. **دکھاؤ کہ کہاں سے آیا (شفافیت)**
5. **کوئی خاموش خرچ نہیں (پیشگی مالی اطلاع)**

M-TAFSIR میں ان کا اطلاق:

- **اصول ۳ — کہاں سے ڈیٹا آئے، یہ صارف کا فیصلہ ہے۔** ایپ خودبخود ریموٹ سے مقامی پر نہ جائے؛ صارف کے انتخاب کے بغیر موڈ تبدیل نہ ہو۔ ڈیفالٹ ریموٹ ہوگا، مگر تبدیلی ہمیشہ صارف کی رضامندی سے۔
- **اصول ۴ — صارف ہمیشہ جانے کہ ڈیٹا کہاں سے آ رہا ہے۔** ہر تفسیر/آیت کے نتیجے پر ذریعہ (مصدر) کا نام، اور `rTL` کارڈ پر «آن لائن / آف لائن» کا واضح بیج۔
- **اصول ۵ — ڈیٹابیس ڈاؤن لوڈ (223 MB) پہلے سے بتایا جائے۔** کوئی خاموش ڈاؤن لوڈ نہیں؛ تخمینہ + جاری پیشرفت + منسوخی۔

### 1.2 شاملہ سے حاصل شدہ ٹیمپلیٹ (جو اس SPEC میں نقل ہو رہا ہے)

| شاملہ کا جز | فائل | اس SPEC کا ہم پلہ |
|---|---|---|
| IPC چینل رجسٹری | `electron/ipc/registry.ts:25` | `TAFSIR_INVOKE` + `TAFSIR_*` (§FR-4) |
| ہینڈلر | `electron/ipc/shamelaHandlers.ts` | `electron/ipc/tafsirHandlers.ts` |
| نیٹیو/کلائنٹ | `electron/shamela/*.ts` | `electron/tafsir/*.ts` (§FR-1) |
| Preload | `electron/preload.ts:113` | `tafsir:` نیم اسپیس |
| UI کارڈ | `src/components/shamela/ShamelaConnectPanel.tsx` | `src/components/tafsir/TafsirConnectPanel.tsx` |
| Settings انٹیگریشن | `src/pages/Settings.tsx:84` | اسی سیکشن میں نیا کارڈ |
| گائیڈ موڈل | `src/components/mcp/ShamelaGuideModal.tsx` | `TafsirGuideModal.tsx` |

---

## 2. Non-Goals (M-TAFSIR میں شامل نہیں)

- **مقامی ڈیٹابیس کی خودکار انسٹال**: صارف `uvx tafsir-mcp` چلا سکتا ہے؛ ایپ انسٹال/ڈاؤن لوڈ میں **مدد** کرے گی مگر Python خود انسٹال نہیں کرے گی (بالکل شاملہ کی طرح — ہم جبراً انسٹال نہیں کرتے)۔
- **پوری تفسیر کی درآمد (import)**: شاملہ کی طرح کتابیں پڑھ کر ورک اسپیس میں داخل کرنے کا نظام Tafsir MCP کا مقصد نہیں — اس کے ٹولز آیت/تفسیر/تلاش لوٹاتے ہیں۔ **صرف آیت/تفسیر کا متن بطور quote داخل ہوگا** (ایڈیٹر میں)، نہ کہ پوری کتابوں کی chunked درآمد۔
- **مقامی موڈ کا Web ورژن**: مقامی stdio صرف ڈیسک ٹاپ؛ ویب پر صرف ریموٹ (edge function proxy کے ذریعے، §FR-6)۔
- **دوسرے MCP سرورز کا عام (generic) کنیکٹر**: صرف Tafsir MCP۔ عام MCP براؤزر مستقبل کے لیے (خطرہ R10)۔
- **قرآن کی مکمل متن تلاش بمقابلہ FTS5 سے باہر**: صرف سرور کے فراہم کردہ ٹولز (§FR-1.2)۔
- **ریکارڈنگ / آڈیو**: قرآن/تفسیر کا صوتی سنن — دائرے سے باہر۔
- **ترجمے**: سرور کے پاس کچھ غیر عربی تراجم ہیں (انگریزی/بنگالی/روسی)، مگر ہم صرف وہی زبان دکھائیں گے جو ٹول لوٹائے — کوئی مقامی ترجمہ انجن نہیں۔

---

## 3. Functional Requirements

### FR-1 · MCP کلائنٹ کور (electron main process)

- **FR-1.1 `electron/tafsir/mcpClient.ts`** — MCP SDK کا `Client` (پہلے سے نصب `@modelcontextprotocol/sdk`، [package.json: نہیں بلکہ node_modules میں موجود]) دو transports کے ساتھ:
  - `StreamableHTTPClientTransport` → `https://mcp.tafsir.net/mcp` (ریموٹ)
  - `StdioClientTransport` → `uvx tafsir-mcp` (یا `python -m tafsir_mcp`) سب پروسیس (مقامی)
- **FR-1.2 سپورٹ شدہ ٹولز کا سفید فہرست (allowlist)** — **فیز 0 کے سپائک سے حاصل شدہ (2026-08-05)، 17 ٹولز درج ذیل**؛ رینڈرر کو صرف یہی کال کرنے دیں:

  | ٹول | پیرامیٹرز (سپائک سے مصدقہ) | لوٹاتا ہے |
  |---|---|---|
  | `fetch_ayah` | surah* int, ayah* int, include? (`tajweed`/`irab`/`gharib`/`qiraat_ayah`/`tadabbur`) | آیت کا متن (text/text_uthmani/text_simple) |
  | `fetch_tafsir` | surah* int, ayah* int, sources? (default `['saadi']`), part? | تفاسیر (مصدر + `attribution` سمیت) |
  | `list_tafsir_sources` | — | 28 مصدر (slug, attribution, language, coverage) |
  | `list_science_sources` | — | علوم قرآن کے مصدر |
  | `list_all_sources` | — | تمام 36 مصدر |
  | `list_sources_for_ayah` | surah* int, ayah* int | آیت کو ڈھانپنے والے مصدر |
  | `fetch_nuzool_reason` | surah* int, ayah* int, sources? (default `['nuzool']`), part? | سببِ نزول |
  | `fetch_surah_info` | surah* int (1–114), include_en_intro? bool | سورہ: نام، نزول، فضائل، اعداد |
  | `analyze_word` | surah* int, ayah* int, word_no* int, aspects? (`meaning`/`irab`/`sarf`/`statistics`/`qeraat`) | لفظی تجزیہ |
  | `find_root_occurrences` | root* str, limit? (default 50, max 500) | جذر کے وقوعات |
  | `get_root_stats` | root* str | جذر کی کل کلمات/سور/آیات |
  | `get_qeraat_variants` | surah* int, ayah* int, word_no? int | قراءات |
  | `search_quran_text` | query* str (FTS5، بلا تشکیل), surah_filter?, limit? | آیت نتائج + snippet + score |
  | `search_in_tafsir` | query* str (LIKE), source? str, surah_filter?, surah?, limit? | تفسیر میں تلاش |
  | `get_quran_overview` | — | قرآن کی مجموعی اعداد |
  | `get_page_fawaed` | page* int (1–604) | مصحف صفحہ کے فوائد |
  | `get_surah_statistics` | surah* int (1–114) | سورہ کے تفصیلی اعداد |

  **اضافی MCP وسائل (4):** `quran://surahs`، `quran://tafsirs`، `quran://sciences`، `quran://schema` (ڈویلپر حوالہ)۔
  **پرامپٹس (5):** `study_ayah`، `compare_tafsirs`، `root_study`، `surah_overview`، `tajweed_lesson`۔

  > **سپائک نتائج (§10.4 / §12.1):** سرور **بے حالت (stateless)** ہے — کوئی `Mcp-Session-Id` نہیں، کوئی OAuth/auth نہیں، ہر POST خودمکتفی۔ پروٹوکول `2025-03-26`۔ جوابی اوقات 165–830ms۔ غلط آیت پر pydantic کی صاف `validation error` آتی ہے (متن گھڑا نہیں جاتا)۔ **صحت چیک کے لیے `tools/call ping` ممنوع** — سرور پر `ping` ٹول رجسٹر نہیں؛ JSON-RPC سطح کے `ping` طریقے (protocol-level) استعمال کریں۔

- **FR-1.3 کنکشن کا lifecycle**: `connect(mode)` / `disconnect()` / `ping()`۔ ایک وقت میں ایک کنکشن؛ دوسرا کھلے رہتے ہوئے نہ کھلے۔
- **FR-1.4 ٹائم آؤٹ + خاموشی**: ریموٹ کال 15 سیکنڈ، stdio 30 سیکنڈ؛ ٹائم آؤٹ پر صاف error رینڈرر کو (خاموش لٹکنا ممنوع — M5 کے R4 سبق)۔
- **FR-1.5 کسی بھی خام خرچ کی روک**: ریموٹ موڈ میں بڑی تلاش (limit بڑھانا) سے پہلے رینڈرر کو نتائج کی گنتی کے ساتھ پیشگی اطلاع؛ کوئی پس منظر کال نہیں۔

### FR-2 · ریموٹ HTTP کنکشن

- **FR-2.1** ڈیفالٹ موڈ «آن لائن» — `StreamableHTTPClientTransport` براہِ راست main process کے Node `fetch` سے (رینڈرر کی CSP کو چھوا تک نہیں جائے گا)۔
- **FR-2.2** کنکشن پر `ping` — سرور دستیاب نہ ہو تو کارڈ پر واضح پیغام + «مقامی موڈ آزمائیں» کا ایک بٹن (§FR-3)۔
- **FR-2.3** کوئی پس منظر پولنگ نہیں؛ صارف کے عمل پر ہی `ping`۔
- **FR-2.4** ہر کال پر `initialize` دوبارہ نہ ہو؛ ایک بار کنیکٹ، `sessionId` برقرار، `disconnect` پر بند۔

### FR-3 · مقامی stdio کنکشن (شاملہ والا نمونہ)

- **FR-3.1 `electron/tafsir/localRuntime.ts`** — تشخیص:
  - Python (`python`/`python3`) اور `uv`/`uvx` کی موجودگی کی جانچ؛ ورژن نمبر۔
  - اگر `uvx` ہو → `uvx tafsir-mcp`؛ اگر نہ ہو → `pip install tafsir-mcp` کی رہنمائی یا `python -m tafsir_mcp`۔
- **FR-3.2 ڈیٹابیس ڈاؤن لوڈ (پہلی بار، ~223 MB)**:
  - تخمینہ ڈائلاگ پہلے (اصول ۵) → ڈاؤن لوڈ پیشرفت (`tafsir:install-progress` چینل) → منسوخی۔
  - ڈاؤن لوڈ مقام: `app.getPath('userData')/tafsir/`، SHA256 تصدیق (سرور شائع کرتا ہے)۔
  - `TAFSIR_DB_PATH` env متغیر پاس ہو تاکہ پہلے سے ڈاؤن لوڈ شدہ DB دوبارہ نہ آئے۔
- **FR-3.3 سب پروسیس کا انتظام**: spawn → `StdioClientTransport` → `disconnect` پر kill؛ ایپ بند ہونے پر اورنگ (zombie process) ممنوع — `app.on('will-quit')` پر صفائی (شاملہ کے importSignal پیٹرن سے مستعار)۔
- **FR-3.4 read-only رویہ**: مقامی DB سرور خود `mode=ro` رکھتا ہے؛ ہم بھی اسے نہ چھوئیں — صرف پڑھنا۔

### FR-4 · IPC + Preload سطح

- **FR-4.1 `electron/ipc/registry.ts`** میں نیا بلاک (بالکل SHAMELA_* کے نقش پر):

  ```ts
  // Tafsir MCP (M-TAFSIR)
  TAFSIR_INVOKE: 'tafsir:invoke',
  TAFSIR_INSTALL_PROGRESS: 'tafsir:install-progress',
  ```

- **FR-4.2 `electron/ipc/tafsirHandlers.ts`** — ایک `ipcMain.handle(TAFSIR_INVOKE)` جس میں `action` dispatch (شاملہ ہینڈلر کے نقش پر)، actions:

  | action | دلیل | جواب |
  |---|---|---|
  | `ping` | mode | `{ ok, mode, latency?, error? }` |
  | `detect` | — | `{ pythonFound, uvFound, dbFound, versions, errors[] }` |
  | `connect` | mode | `{ connected, tools[] }` |
  | `disconnect` | — | `{ disconnected }` |
  | `tools` | — | `tools[]` (متحرک schema) |
  | `call` | tool, args | `{ result }` (سفید فہرست تک محدود، FR-1.2) |
  | `install:status` | — | ڈاؤن لوڈ حالت |
  | `install:start` | — | تخمینہ + شروع |
  | `install:cancel` | — | منسوخی |

- **FR-4.3 `electron/preload.ts`** — `tafsir:` نیم اسپیس (شاملہ جیسا، `contextBridge` کے ذریعے)، مکمل اقسام preload میں درج۔
- **FR-4.4 کبھی بھی رینڈرر سے مفت `call(tool, args)` نہ ہو** — صرف سفید فہرست (§FR-1.2) + حجم کی حد (متن کٹاؤ)۔

### FR-5 · UI

- **FR-5.1 `src/components/mcp/TafsirConnector.tsx`** (LocalShamelaConnector کا ہم پلہ): موڈ انتخاب کے ساتھ:
  - ریڈیو: «آن لائن (ریموٹ)» — ڈیفالٹ · «آف لائن (مقامی)»
  - کنیکٹ بٹن، موڈ بیج، منقطع بٹن
  - ریموٹ فیل → «مقامی موڈ آزمائیں» تجویز (اختیاری، صارف کی مرضی)
- **FR-5.2 `src/components/tafsir/TafsirConnectPanel.tsx`** (ShamelaConnectPanel کا ہم پلہ):
  - detect/diagnose چیک لسٹ (مقامی موڈ) — Python/uv/DB
  - ریاست: `idle | connecting | connected | error`، اردو پیغامات
  - تشخیصی رپورٹ کاپی بٹن (شاملہ کی طرح)
- **FR-5.3 `src/components/tafsir/TafsirSearchDialog.tsx`** — تلاش/آیت کارڈ:
  - موڈ: آیت (سورہ:آیت) · سورہ معلومات · قرآنی متن تلاش · تفسیر تلاش
  - نتائج کی فہرست، ہر نتیجے پر مصدر کا نام (اصول ۴)
  - «ایڈیٹر میں داخل کریں» — فی الحال کھلے ٹِپٹاپ کرسیسر پر متن + انتساب فوٹر (§FR-7)
- **FR-5.4 `src/components/tafsir/TafsirGuideModal.tsx`** — تنصیب/استعمال رہنما (اردو/عربی/انگریزی، MaktabaShamila گائیڈ کے نقش پر)۔
- **FR-5.5 `src/pages/Settings.tsx`** — شاملہ والے کارڈ کے نیچے نیا `TafsirConnector` سیکشن۔
- **FR-5.6 ویب ورژن**: `window.electronAPI?.tafsir` موجود نہ ہو تو رینڈرر `src/lib/tafsir/tafsirService.ts` ویب ایڈاپٹر سے جڑے (§FR-6)۔

### FR-6 · ویب ورژن (ریموٹ کے ذریعے)

- **FR-6.1 رینڈرر سے براہِ راست HTTP ممنوع** — CORS نامعلوم + رازداری (اصول ۳)۔
- **FR-6.2 Supabase Edge Function `tafsir-proxy`**: مین کے `tafsirHandlers` کا خفیف ہم پلہ — سرور پر MCP کلائنٹ، `call` + `tools`۔ ٹوکن گیٹ (tokenGuard) کے پیچھے، سفید فہرست کے ساتھ۔
- **FR-6.3 ویب موڈ میں صرف «آن لائن»** — کوئی مقامی نہیں (§Non-Goals)۔
- **FR-6.4 فیصلہ نقطہ:** Edge function موجودہ `supabase/functions/` میں شامل ہوگی یا ویب پر صرف ڈیسک ٹاپ کی تبلیغ (اختیاری پیغام)؟ — §8.5 میں کھلا سوال، **پہلے ڈیسک ٹاپ مکمل ہوگا**۔

### FR-7 · انتساب + لائسنس کی تعمیل (CC BY 4.0)

- **FR-7.1** ہر داخل شدہ متن کے ساتھ فوٹر: مصدر + سورہ/آیت + ماخذ سلسلہ (مثلاً «تفسیر الطبري — تafsircenter, CC BY 4.0»)۔
- **FR-7.2** «متن بطور نقل (quote) داخل کریں» بمقابلہ «حوالہ کے ساتھ داخل کریں» — صارف کو انتخاب۔
- **FR-7.3** ایپ میں کریڈٹ سکرین پر Tafsir Center کا ذکر + لائسنس لنک۔

---

## 4. Non-Functional Requirements

- **NFR-1 (رازداری):** ریموٹ موڈ میں صرف سوالی/پیداواری کالیں سرور کو جائیں — کوئی دستاویز کا مواد سرور کو نہیں۔ مقامی موڈ میں کوئی نیٹ ورک کال نہیں (اصول ۳)۔
- **NFR-2 (سیکیورٹی):** رینڈرر کبھی مفت MCP کال نہ کرے؛ ہر `call` main process میں سفید فہرست + ارگ ویلیڈیشن سے گزرے (M5 کے allowlist/security پیٹرن)۔
- **NFR-3 (CSP):** رینڈرر کی `connect-src` میں کوئی اضافہ نہیں — تمام MCP ایشوز main process میں (§FR-2.1)۔
- **NFR-4 (کارکردگی):** ریموٹ کال ≤15s، مقامی ≤30s؛ بڑے نتائج کا کٹاؤ (پہلے 50,000 حروف)۔
- **NFR-5 (دستیابی):** ریموٹ فیل پر مکمل تشخیصی پیغام، کوئی خاموش ناکامی نہیں (M5 R4 سبق)۔
- **NFR-6 (قابلِ آزمائش):** مین کور کا تمام منطق منفرد فنکشنز میں تاکہ vitest سے براہِ راست جانچ ہو (شاملہ کے `src/test/shamela*` پیٹرن)۔
- **NFR-7 (رفتارِ جواب):** ڈاؤن لوڈ/کنیکٹ کے دوران UI غیر منجمد — تمام I/O async + پیشرفت۔

---

## 5. معماری

```
Renderer (React)                              Electron Main                        خارجی
─────────────────                             ──────────────                        ──────
TafsirConnector.tsx ── IPC (tafsir:invoke) ─► tafsirHandlers.ts
   │  ریڈیو: آن لائن / آف لائن                     │
   │                                              ├─► mcpClient.ts ── StreamableHTTP ─► https://mcp.tafsir.net/mcp
   │  tafsirService.ts (ویب ایڈاپٹر)              │      └──────── StdioClient ─► uvx tafsir-mcp (سب پروسیس)
   │       │                                      └─► localRuntime.ts ──► Python/uv تشخیص + DB ڈاؤن لوڈ (userData/tafsir)
   └─(web) edge function tafsir-proxy ◄─────── (cloud runtime) ──► mcp.tafsir.net
```

**کلیدی فیصلے:**

1. MCP کلائنٹ **صرف electron main process** میں — CSP/CORS دونوں مسائل ایک جھٹکے میں حل، اور رینڈرر کا اٹیک سطح چھوٹا (NFR-2)۔
2. رینڈرر کو ریموٹ اینڈ پوائنٹ کا پتہ تک نہیں چاہیے — صرف `tafsir:invoke` کا معلوم API۔
3. سفید فہرست کی بنیاد سرور کے `tools/list` سے **متحرک** — مگر رینڈرر کو صرف نام + ارگ schema دکھتا ہے، کوئی ایگزیکیوشن نہیں۔
4. موڈ کی تبدیلی صارف کی مرضی سے (اصول ۳)۔

---

## 6. نفاذ کا نقشہ (فائلز)

**نئی فائلیں:**

```
electron/tafsir/mcpClient.ts          # MCP کلائنٹ کور (دونوں transports + پول)
electron/tafsir/localRuntime.ts       # Python/uv تشخیص + DB ڈاؤن لوڈ/تصدیق + سب پروسیس
electron/ipc/tafsirHandlers.ts        # IPC dispatch (شاملہ ہینڈلر کا نقش)
src/lib/tafsir/tafsirService.ts       # رینڈرر سروس پرت (ڈیسک ٹاپ/ویب)
src/components/tafsir/TafsirConnectPanel.tsx
src/components/tafsir/TafsirSearchDialog.tsx
src/components/tafsir/TafsirGuideModal.tsx
src/components/mcp/TafsirConnector.tsx
src/components/tafsir/insertTafsirQuote.ts  # ایڈیٹر داخل + انتساب (FR-7)
src/test/tafsir.test.ts               # مین کور یونٹ ٹیسٹ
supabase/functions/tafsir-proxy/      # (FR-6 — بعد، §8.5)
docs/QA-TAFSIR.md                     # QA ریکارڈ (متبادل اردو نام)
```

**تبدیلی والی فائلیں:**

```
electron/ipc/registry.ts              # TAFSIR_* چینلز (§FR-4.1)
electron/main.ts                      # registerTafsirHandlers() + will-quit صفائی (§FR-3.3)
electron/preload.ts                   # tafsir: نیم اسپیس (§FR-4.3)
src/pages/Settings.tsx                # نیا سیکشن (§FR-5.5)
docs/SMOKE-TESTS.md                   # تفسیر کا سموک سیکشن
```

---

## 7. خطرات (Risks & Mitigation)

| # | خطرہ | شدت | تخفیف |
|---|---|---|---|
| R1 | **ریموٹ endpoint کا auth/rate-limit/توثیق** — ویب سائٹ پر دستاویزی نہیں | ~~بلند~~ → **حل (سپائک)** | کوئی auth/session نہیں؛ اپنی جانب سے `limit` پابند + شرح محدود (FR-1.5) |
| R2 | **حقیقی ٹول schemas نامعلوم** — صرف نام ویب سائٹ پر | ~~بلند~~ → **حل (سپائک)** | 17 schemas مصدق (§FR-1.2)؛ پھر بھی `tools/list` سے متحرک تصدیق برقرار |
| R3 | **مقامی موڈ میں Python نہ ہو** — بہت سے صارفین | درمیانہ | صرف مقامی نہیں؛ ریموٹ ڈیفالٹ + واضح تشخیص + گائیڈ |
| R4 | **223 MB ڈاؤن لوڈ** — خاموش خرچ/وقت | درمیانہ | تخمینہ ڈائلاگ + پیشرفت + منسوخی (اصول ۵) |
| R5 | **CC BY 4.0 انتساب** — بغیر حوالہ نقل | درمیانہ | FR-7 فوٹر لازمی؛ صارف بھی چھوڑ نہ سکے بغیر انتباہ |
| R6 | **CORS** اگر کبھی رینڈرر سے براہِ راست کال | درمیانہ | کبھی رینڈرر سے نہیں — main/edge function ہمیشہ |
| R7 | **سب پروسیس / ازمبے (zombie) `uvx`** | درمیانہ | `will-quit` پر kill + سرور سے disconnect؛ ٹیسٹ |
| R8 | **سرور کا غیر مستحکم ڈاؤن ٹائم** | درمیانہ | ping + فیل سیف پیغام + مقامی کی تجویز (§FR-2.2) |
| R9 | **ویب ورژن بغیر کنیکٹر** رہ جائے | کم | FR-6؛ ڈیسک ٹاپ مکمل ہونے کے بعد فیصلہ |
| R10 | **دوسرے MCP سرورز کی طلب** | کم | Non-Goal؛ اگر آئے تو اسی کور کو جنرلائز — بعد میں |

---

## 8. فیصلے (Decisions Record)

| # | فیصلہ | آپشنز | منتخب | وجہ |
|---|---|---|---|---|
| D1 | ریموٹ یا مقامی؟ | صرف ریموٹ / صرف مقامی / **دونوں** | **دونوں، ریموٹ ڈیفالٹ** | مقامی Python پر، ریموٹ دستیابی پر — ہر صارف کے لیے کوئی نہ کوئی کام کرے |
| D2 | MCP کلائنٹ کہاں؟ | رینڈرر / **main** / edge | **main (ڈیسک ٹاپ)** | CSP+CORS حل، اٹیک سطح چھوٹا |
| D3 | ٹول وائٹ لسٹ | ہارڈ کوڈڈ / **متحرک** | **متحرک** | schemas نامعلوم، سرور کا حوالہ درست |
| D4 | موڈ سوئچ | خودکار fallback / **صارف کی مرضی** | **صارف کی مرضی** | اصول ۳ — خودکار منتقلی نہیں |
| D5 | درآمد کا ماڈل | chunked درآمد (شاملہ کی طرح) / **quote داخل** | **quote داخل** | سرور کے ٹولز اس کا مقصد نہیں |
| D6 | ویب ورژن | edge proxy / تبلیغ / بعد | **بعد، §8.5** | ڈیسک ٹاپ پہلے |

### 8.5 کھلے سوالات (اسپائک کے بعد — اپڈیٹ شدہ)

1. ~~ریموٹ endpoint کا auth~~ — **حل ہو گیا (سپائک):** کوئی auth/OAuth/API-key نہیں، کوئی session-id نہیں۔ بے حالت، کھلا۔ ⚠️ اس کا مطلب ہے کہ سرور پر کوئی ریٹ لمٹنگ صارف-مخصوص نہیں — لہٰذا ہم اپنی جانب سے `limit` پابند رکھیں (FR-1.5)۔
2. **ویب ورژن** — edge function proxy یا صرف ڈیسک ٹاپ کی تبلیغ؟ (ڈیسک ٹاپ مکمل ہونے کے بعد فیصلہ)
3. ~~rate-limit~~ — سپائک نے کوئی ایچ ٹی ٹی پی ریٹ لمٹ نہیں دکھائی؛ لیکن عوامی endpoint پر درخواستوں کی شرح ہماری اپنی ذمہ داری ہے (FR-1.5 + NFR-4)۔

---

## 9. مفروضے (Assumptions)

1. ~~ریموٹ endpoint Streamable HTTP ہے~~ — **مصدق (سپائک):** `text/event-stream` جوابات، پروٹوکول `2025-03-26`، کوئی session/auth نہیں۔
2. `@modelcontextprotocol/sdk` کا کلائنٹ main process (Node) میں بغیر اضافی انحصار چلتا ہے (node_modules میں موجود ہے) — کلائنٹ کی کالز یہی SDK کریں گے۔
3. مقامی سرور `uvx tafsir-mcp` کے ذریعے بغیر انٹرایکٹو پرامپٹ چلتا ہے — **فیز 3 میں تصدیق ہوگی** (Python مقامی ماحول درکار)۔
4. ڈیٹا پیکج SHA256 کے ساتھ دستیاب ہے — **فیز 3 میں تصدیق** (سپائک ریموٹ تھا، ڈاؤن لوڈ کا سلسلہ نہیں چلایا)۔
5. ویب ورژن میں تفسیر کی تلاش بھی درکار ہے — اسی لیے FR-6۔
6. صارفین کی اکثریت ویب پر ہے؛ اس لیے ریموٹ ڈیفالٹ (ڈیسک ٹاپ اور ویب دونوں)۔

---

## 10. توثیق (Verification)

- **10.1** `npm run typecheck` (app + electron) — بلا خطا۔
- **10.2** `npm run lint` — بلا خطا۔
- **10.3** `npm run test` — نئے `src/test/tafsir.test.ts` سمیت تمام پاس؛ موجودہ ٹیسٹ بلا ترمیم پاس (FR-1.4 کا شاملہ سبق)۔
- **10.4** ✅ **سپائک (فیز 0) مکمل — 2026-08-05:** خام HTTP سے `initialize` + `tools/list` + `resources/list` + `prompts/list` + 8 اصل ٹول کالز مصدق۔ **17 ٹولز**، **4 وسائل**، **5 پرامپٹس** حاصل؛ §FR-1.2 جدول اپڈیٹ؛ ping کا جواب 165–830ms؛ کوئی auth/session نہیں؛ غلط آیت پر صاف pydantic error (متن گھڑنے کی کوئی صورت نہیں)۔
- **10.5** دستی QA (QA-TAFSIR.md): ریموٹ کنیکٹ → آیت → تفسیر → ایڈیٹر داخل → انتساب؛ مقامی detect/install/آف لائن؛ ریموٹ بند کر کے فیل سیف۔
- **10.6** ویب موڈ: `tafsirService` ڈیسک ٹاپ کے بغیر صحیح پیغام (یا FR-6 کے مطابق)۔
- **10.7** `npm run check:shared` — shared کو pure رکھا۔

---

## 11. Exit Criteria

### فیز 0 (سپائک)
- `tools/list` کا حقیقی جواب حاصل؛ 13+ ٹولز کے schemas SPEC میں درج؛ ping کا ثبوت۔
- ریموٹ endpoint کے auth/rate-limit کے بارے میں فیصلہ (§8.5.1)۔

### فیز 1 (کور + IPC + preload)
- `mcpClient.ts` دونوں transports؛ `tafsirHandlers.ts` تمام actions؛ `preload.ts` کا `tafsir:`؛ اقسام مکمل۔
- یونٹ ٹیسٹ: سفید فہرست، ٹائم آؤٹ، منقطع، سب پروسیس صفائی۔

### فیز 2 (ریموٹ UI)
- Settings میں `TafsirConnector`؛ «آن لائن» کنیکٹ؛ آیت/تفسیر/تلاش کا ڈائلاگ؛ ایڈیٹر داخل + انتساب۔
- ریموٹ بند کرنے پر فیل سیف پیغام + مقامی کی تجویز۔

### فیز 3 (مقامی)
- detect/diagnose (Python/uv/DB)؛ DB ڈاؤن لوڈ پیشرفت + منسوخی؛ آف لائن مکمل ورک فلو۔
- `will-quit` صفائی تصدیق شدہ۔

### فیز 4 (ویب + دستاویزات)
- §8.5 کا فیصلہ نافذ؛ QA-TAFSIR.md مکمل؛ SMOKE-TESTS.md اپڈیٹ؛ لائسنس/انتساب کی تعمیل۔

---

## 12. نفاذی چیک لسٹ (قدم بہ قدم)

### 12.1 فیز 0 — سپائک (تصدیق) ✅ مکمل 2026-08-05
- [x] خام HTTP سے `initialize` + `tools/list` + `resources/list` + `prompts/list` — `https://mcp.tafsir.net/mcp`
- [x] **17 ٹولز** کے حقیقی schemas حاصل کر کے §FR-1.2 جدول اپڈیٹ
- [x] ping کا وقت (165–830ms)، auth کی غیر موجودگی، بے حالتی — تصدیق شدہ
- [x] 8 اصل ٹول کالز (آیت، تفسیر، تلاش، سورہ معلومات، غلط آیت، مصدر فہرست، resources/read)
- [x] یہ نتائج SPEC میں درج (§FR-1.2، §8.5، §9، §10.4)
- [ ] **فیز 3 تک ملتوی:** مقامی `uvx tafsir-mcp` + 223MB ڈاؤن لوڈ + SHA256 — ریموٹ موڈ خالص تھا

### 12.2 فیز 1 — کور ✅ مکمل 2026-08-05
- [x] `electron/tafsir/mcpClient.ts` — Client + دونوں transports + ٹائم آؤٹ + disconnect + sync قتل
- [x] `electron/tafsir/localRuntime.ts` — detect + stdio params + cleanup ہُک (ڈاؤن لوڈ فیز 3)
- [x] `electron/tafsir/allowlist.ts` — 17 ٹولز + ارگ سینیٹائز (خالص، ٹیسٹ کیا گیا)
- [x] `electron/tafsir/types.ts` — مشترکہ اقسام
- [x] `electron/ipc/tafsirHandlers.ts` — تمام actions (§FR-4.2)
- [x] `electron/ipc/registry.ts` — چینلز (§FR-4.1)
- [x] `electron/preload.ts` — `tafsir:` نیم اسپیس
- [x] `electron/main.ts` — register + `before-quit` پر sync قتل (§FR-3.3)
- [x] `package.json` — `@modelcontextprotocol/sdk ^1.28.0` براہِ راست انحصار
- [x] `src/test/tafsir.test.ts` — 15 ٹیسٹ (نظام رجسٹری، سفید فہرست، ارگ سینیٹائز، مقامی detection)
- [x] تصدیق: `typecheck:electron` ✓ · `typecheck:app` ✓ · `lint` 0 errors ✓ · تایفیر ٹیسٹ 15/15 ✓ · مکمل سوٹ 464 پاس

### 12.3 فیز 2 — ریموٹ UI ✅ مکمل 2026-08-05
- [x] `TafsirConnectPanel` (آف لائن detect بھی)
- [x] `TafsirConnector` (موڈ ریڈیو + فیل سیف)
- [x] `TafsirSearchDialog` (آیت/تفسیر/تلاش)
- [x] `insertTafsirQuote` + انتساب فوٹر
- [x] `Settings.tsx` سیکشن + گائیڈ موڈل
- [x] `parseTafsir.ts` (خالص پارسرز) + ٹیسٹس (9)

### 12.4 فیز 3 — مقامی ✅ مکمل 2026-08-05
- [x] detect/diagnose چیک لسٹ (فیز 1 کور + UI گاٹنگ)
- [x] ڈاؤن لوڈ پیشرفت + منسوخی + SHA256 — `localRuntime.downloadDatabase` (HF سے `quran.db`، `10e61f…cc27` تصدیق، temp→rename)
- [x] `install:start`/`install:cancel`/`install:status` + `tafsir:install-progress` سٹریم
- [x] مقامی UI: تخمینہ (~214 MB) + پیشرفت بار + منسوخی؛ بغیر DB کے کنیکٹ مسدود (اصول ۵)
- [x] ٹیسٹس: DB میٹا ڈیٹا (URL/SHA256/سائز) — کُل 19 تایفیر ٹیسٹس
- [ ] آف لائن ورک فلو دستی QA (حقیقی ڈیوائس پر ڈاؤن لوڈ + آف لائن کالز)

### 12.5 فیز 4 — ویب + دستاویزات
- [ ] §8.5 فیصلہ + عمل
- [ ] QA-TAFSIR.md + SMOKE-TESTS.md
- [ ] لائسنس/انتساب سکرین

---

## 13. تخمینہ

| فیز | دن |
|---|---|
| 0 — سپائک | 1 |
| 1 — کور/IPC | 3 |
| 2 — ریموٹ UI | 3 |
| 3 — مقامی | 3 |
| 4 — ویب/دستاویز | 2 |
| **کل** | **12** |
