## تصدیق: جی ہاں، ٹرانسکرائب اپلوڈ پر پابندیاں لگی ہوئی ہیں

`src/lib/audio/formatSupport.ts` اور `src/lib/audio/transcribeLongForm.ts` میں یہ حدود موجود ہیں:

| پابندی | موجودہ ویلیو | جگہ |
|---|---|---|
| قابلِ قبول فارمیٹس | صرف mp3, wav, m4a, ogg, webm, flac, aac, mp4, mov, m4v, 3gp, opus | `ACCEPTED_MEDIA` |
| زیادہ سے زیادہ فائل سائز | 1 GB (500 MB سے اوپر warning) | `MAX_FILE_SIZE_BYTES` |
| زیادہ سے زیادہ دورانیہ | 120 منٹ (2 گھنٹے) | `MAX_DURATION_SECONDS` |
| ویڈیو ڈیٹیکشن | صرف mp4, mov, m4v, webm, 3gp, mkv, avi | `VIDEO_EXTENSIONS` |

### مسئلہ
- **`.mkv`, `.avi`, `.flv`, `.wmv`, `.wma`, `.amr`, `.aiff`** جیسی کامن فائلز `<input accept>` سے بلاک ہو جاتی ہیں — موبائل/ڈیسکٹاپ فائل پکر میں یہ گرے آؤٹ نظر آتی ہیں۔
- ٹوکن/کوٹا حدود الگ ہیں (یہ برقرار رہیں گی، صرف فارمیٹ کی پابندی ہٹانی ہے)۔

## حل کا پلان (صرف فرنٹ اینڈ)

### 1. `src/lib/audio/formatSupport.ts`
- `ACCEPTED_MEDIA` کو کھول کر صرف `audio/*,video/*` کر دیں تاکہ براؤزر ہر آڈیو/ویڈیو MIME قبول کرے۔ ایکسٹینشن فال بیک کے لیے common lesser-known extensions بھی شامل کریں: `.mkv,.avi,.flv,.wmv,.wma,.amr,.aiff,.aif,.opus,.oga,.mka` — تاکہ جن سسٹمز پر MIME خالی آتا ہے وہاں بھی pass ہوں۔
- `VIDEO_EXTENSIONS` سیٹ میں `.flv`, `.wmv`, `.ts`, `.mts`, `.m2ts`, `.ogv` بھی جوڑ دیں۔

### 2. `src/pages/Transcribe.tsx` — ایرر پیغام بہتری
- جب براؤزر کا `AudioContext.decodeAudioData` کسی فارمیٹ (مثلاً WMA) کو decode نہ کر سکے، صارف کو واضح پیغام دیں: "یہ فارمیٹ آپ کے براؤزر میں سپورٹ نہیں — براہِ کرم MP3/MP4/WAV میں تبدیل کر کے اپلوڈ کریں۔"
- موجودہ `t("stt.format_unsupported")` کی زبانوں میں بہتر لفظیت۔

### 3. `src/locales/{en,ur,ar}.json`
- `stt.format_unsupported` کی سٹرنگ کو مزید معلوماتی بنائیں (کن فارمیٹس کو convert کرنا ہے)۔

### جو **تبدیل نہیں** ہوگا (اور کیوں)
- **1 GB سائز کیپ** — موبائل tab crash سے بچاؤ کے لیے۔
- **2 گھنٹہ دورانیہ کیپ** — edge function کی lifetime اور cost/rate-limit کے لیے۔
- **کلائنٹ‑سائیڈ ڈی کوڈنگ** — یہ براؤزر کے `AudioContext` پر انحصار کرتی ہے، اس لیے WMA/AVI-with-obscure-codecs جیسی فائلیں decode مرحلے پر ناکام ہو سکتی ہیں چاہے accept ہو جائیں۔ اس لیے حل میں (2) کا واضح ایرر شامل ہے۔ اگر آپ چاہیں تو ایک **الگ پلان** میں سرور‑سائیڈ ffmpeg conversion (ایک نئی edge function) شامل کر سکتے ہیں تاکہ ہر فارمیٹ واقعی چلے۔

### نتیجہ
اس پلان کے بعد فائل پکر ہر آڈیو/ویڈیو دکھائے گا، MIME/extension کی وجہ سے کوئی فائل reject نہیں ہوگی، اور اگر براؤزر واقعی decode نہ کر سکے تو صارف کو صاف ہدایت ملے گی۔
