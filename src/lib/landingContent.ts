/**
 * Trilingual marketing copy for the landing page.
 *
 * Kept as one typed module (rather than ~100 locale-file keys) so the copy for
 * a section reads side by side in en / ur / ar, and so the FAQ can feed both
 * the visible page and its FAQPage JSON-LD from a single source.
 *
 * Every claim here must be true of the shipped app — see docs/SPEC-*.md. Items
 * not yet shipped (personal voice cloning, the Ultra TTS allowance) are labelled
 * "planned"/"coming soon", never presented as available.
 */

export type Lang = "en" | "ur" | "ar";
export type L10n = Record<Lang, string>;

/** Desktop installers are published as GitHub release assets by .github/workflows/release.yml. */
export const DESKTOP_DOWNLOAD_URL = "https://github.com/hafizkh124/EasyEditor/releases";
export const SOURCE_URL = "https://github.com/hafizkh124/EasyEditor";

export const SEO: { title: L10n; description: L10n } = {
  title: {
    en: "Al-Ulama Easy Editor — AI Research & Writing Workspace for Islamic Scholars",
    ur: "العلماء ایزی ایڈیٹر — علماء و محققین کے لیے AI ریسرچ اور تحریری ورک اسپیس",
    ar: "العلماء إيزي إيديتور — مساحة بحث وكتابة بالذكاء الاصطناعي للعلماء",
  },
  description: {
    en: "Source-grounded Islamic research (Quran, Hadith, tafsir, fiqh), a rich Urdu/Arabic/English editor, an AI agent with scholarly playbooks, transcription, OCR and text-to-speech — on the web and as a privacy-first desktop app.",
    ur: "قرآن، حدیث، تفسیر اور فقہ کے ماخذ پر مبنی تحقیق، اردو/عربی/انگریزی ایڈیٹر، علمی پلے بُکس والا AI ایجنٹ، ٹرانسکرپشن، OCR اور ٹیکسٹ ٹو اسپیچ — ویب پر بھی اور پرائیویسی فرسٹ ڈیسک ٹاپ ایپ کے طور پر بھی۔",
    ar: "بحث إسلامي موثّق المصادر (قرآن وحديث وتفسير وفقه)، ومحرّر غني بالعربية والأردية والإنجليزية، ووكيل ذكاء اصطناعي بخطط عمل علمية، وتفريغ صوتي وOCR وتحويل نص إلى كلام — على الويب وكتطبيق مكتبي يحترم الخصوصية.",
  },
};

export const HERO: {
  badge: L10n;
  title: L10n;
  subtitle: L10n;
  ctaSignup: L10n;
  ctaDesktop: L10n;
  access: L10n;
  trust: L10n[];
  imageAlt: L10n;
} = {
  badge: {
    en: "Research · Write · Verify",
    ur: "تحقیق · تحریر · تصدیق",
    ar: "بحث · كتابة · توثيق",
  },
  title: {
    en: "The AI workspace where Islamic research and writing happen side by side",
    ur: "وہ AI ورک اسپیس جہاں اسلامی تحقیق اور تحریر ساتھ ساتھ چلتی ہیں",
    ar: "مساحة العمل الذكية التي يلتقي فيها البحث الإسلامي بالكتابة",
  },
  subtitle: {
    en: "Ask questions grounded in Quran, Hadith and classical sources, write in a proper Urdu/Arabic editor, and let an AI agent run scholarly workflows — with every answer showing its sources.",
    ur: "قرآن، حدیث اور کلاسیکی کتب کے حوالوں پر مبنی سوال پوچھیں، اردو/عربی کے معیاری ایڈیٹر میں لکھیں، اور AI ایجنٹ سے علمی کام لیں — ہر جواب کے ساتھ اس کے ماخذ۔",
    ar: "اطرح أسئلتك مستندةً إلى القرآن والحديث والمصادر الكلاسيكية، واكتب في محرّر عربي/أردي متقن، واترك وكيل الذكاء الاصطناعي ينفّذ مهام علمية — وكل جواب يعرض مصادره.",
  },
  ctaSignup: { en: "Create account", ur: "اکاؤنٹ بنائیں", ar: "إنشاء حساب" },
  ctaDesktop: { en: "Get the desktop app", ur: "ڈیسک ٹاپ ایپ حاصل کریں", ar: "حمّل تطبيق سطح المكتب" },
  access: {
    en: "Accounts are reviewed and approved by an admin before tools unlock; paid plans start at 1,400 PKR / $5 per month.",
    ur: "ٹولز کھلنے سے پہلے ایڈمن اکاؤنٹ کا جائزہ لے کر منظوری دیتا ہے؛ ادائیگی والے پلان 1,400 روپے / $5 ماہانہ سے شروع۔",
    ar: "تتم مراجعة الحسابات واعتمادها من المشرف قبل تفعيل الأدوات؛ تبدأ الخطط المدفوعة من 1,400 روبية / 5 دولارات شهريًا.",
  },
  trust: [
    { en: "Urdu · Arabic · English", ur: "اردو · عربی · انگریزی", ar: "العربية · الأردية · الإنجليزية" },
    { en: "Answers cite their sources", ur: "جوابات کے ساتھ حوالے", ar: "الإجابات مقرونة بمصادرها" },
    { en: "Open source (AGPL-3.0)", ur: "اوپن سورس (AGPL-3.0)", ar: "مفتوح المصدر (AGPL-3.0)" },
  ],
  imageAlt: {
    en: "Al-Ulama Easy Editor workspace: library, editor and research workbench",
    ur: "العلماء ایزی ایڈیٹر ورک اسپیس: لائبریری، ایڈیٹر اور ریسرچ ورک بینچ",
    ar: "مساحة عمل العلماء إيزي إيديتور: المكتبة والمحرّر ومنصة البحث",
  },
};

export interface FeatureItem {
  icon: "workspace" | "research" | "tasks" | "agent" | "connectors" | "library" | "voice" | "book";
  title: L10n;
  desc: L10n;
}

export const FEATURES_HEADING: { title: L10n; subtitle: L10n } = {
  title: {
    en: "One workspace for the whole scholarly workflow",
    ur: "پورے علمی کام کے لیے ایک ہی ورک اسپیس",
    ar: "مساحة واحدة لسير العمل العلمي كاملًا",
  },
  subtitle: {
    en: "From finding a source to publishing a finished document — without switching apps.",
    ur: "ماخذ تلاش کرنے سے لے کر مکمل دستاویز تیار کرنے تک — بغیر ایپ بدلے۔",
    ar: "من العثور على المصدر إلى إخراج المستند النهائي — دون التنقّل بين التطبيقات.",
  },
};

export const FEATURES: FeatureItem[] = [
  {
    icon: "workspace",
    title: { en: "Three-pillar workspace", ur: "تین ستونوں والا ورک اسپیس", ar: "مساحة عمل بثلاثة أعمدة" },
    desc: {
      en: "Library on the left, editor in the centre, research workbench on the right — so you never lose context. The editor has tables, track changes, margin notes, version history and DOCX / PDF export.",
      ur: "بائیں لائبریری، درمیان میں ایڈیٹر، دائیں ریسرچ ورک بینچ — سیاق نہیں ٹوٹتا۔ ایڈیٹر میں جدول، ٹریک چینجز، حاشیہ نوٹس، ورژن ہسٹری اور DOCX / PDF ایکسپورٹ۔",
      ar: "المكتبة يسارًا والمحرّر في الوسط ومنصة البحث يمينًا — فلا تفقد سياق عملك. يضم المحرّر الجداول وتتبّع التغييرات والملاحظات الهامشية وسجلّ الإصدارات وتصدير DOCX وPDF.",
    },
  },
  {
    icon: "research",
    title: { en: "Research you can verify", ur: "قابلِ تصدیق تحقیق", ar: "بحث قابل للتحقق" },
    desc: {
      en: "Islamic, custom-source and general research modes. Each AI run records its sources and a confidence score in a Trust tab, so you can check before you rely on it.",
      ur: "اسلامی، اپنے ماخذ اور عمومی تحقیق کے موڈز۔ ہر AI رن اپنے ماخذ اور اعتماد اسکور Trust ٹیب میں محفوظ کرتا ہے تاکہ استعمال سے پہلے جانچ سکیں۔",
      ar: "أوضاع بحث إسلامي وبمصادر مخصّصة وعام. يسجّل كل تشغيل للذكاء الاصطناعي مصادره ودرجة الثقة في تبويب «الثقة» لتتحقق قبل الاعتماد عليه.",
    },
  },
  {
    icon: "tasks",
    title: { en: "AI tasks, recipes & long documents", ur: "AI ٹاسکس، ریسپیز اور طویل دستاویزات", ar: "مهام ووصفات ومستندات طويلة" },
    desc: {
      en: "12 built-in tasks — harakat, spelling, paraphrase, summarise, citations, auto-format and more — plus fixed multi-step recipes. Long documents are processed in chunks with progress, cancel and undo.",
      ur: "حرکات، املا، پیرا فریز، خلاصہ، حوالہ جات، آٹو فارمیٹ وغیرہ سمیت 12 بلٹ اِن ٹاسکس اور مقررہ مراحل والی ریسپیز۔ طویل دستاویزات حصوں میں پراسیس ہوتی ہیں، پیش رفت، منسوخی اور اَن ڈو کے ساتھ۔",
      ar: "12 مهمة جاهزة — التشكيل والتدقيق الإملائي وإعادة الصياغة والتلخيص والاستشهادات والتنسيق التلقائي وغيرها — إضافةً إلى وصفات متعددة الخطوات. تُعالَج المستندات الطويلة على دفعات مع تقدّم وإلغاء وتراجع.",
    },
  },
  {
    icon: "agent",
    title: { en: "AI agent with scholarly playbooks", ur: "علمی پلے بُکس والا AI ایجنٹ", ar: "وكيل ذكي بخطط عمل علمية" },
    desc: {
      en: "An agent that uses tools on your behalf and follows 25 playbooks — fatwa drafting, hadith takhrij, zakat and faraid workflows, thesis formatting, Urdu typesetting — asking for your approval before it changes anything.",
      ur: "ایسا ایجنٹ جو آپ کی طرف سے ٹولز استعمال کرتا ہے اور 25 پلے بُکس پر چلتا ہے — فتویٰ مسودہ، تخریجِ حدیث، زکوٰۃ و فرائض، تھیسس فارمیٹنگ، اردو ٹائپ سیٹنگ — اور کوئی تبدیلی کرنے سے پہلے آپ سے منظوری لیتا ہے۔",
      ar: "وكيل يستخدم الأدوات نيابةً عنك ويتبع 25 خطة عمل — صياغة الفتوى وتخريج الحديث وحساب الزكاة والفرائض وتنسيق الرسائل العلمية والتنضيد الأردي — ويطلب موافقتك قبل أي تعديل.",
    },
  },
  {
    icon: "connectors",
    title: { en: "Connectors to classical sources", ur: "کلاسیکی ماخذ سے کنکشنز", ar: "موصّلات إلى المصادر الكلاسيكية" },
    desc: {
      en: "Connect Maktaba Shamela, Turath, tafsir, hadith and narrator (rijal) sources, lexicons, Ganjoor poetry and Urdu prosody, plus zakat and faraid calculators.",
      ur: "مکتبہ شاملہ، تراث، تفاسیر، حدیث و رجال کے ماخذ، لغات، گنجور شاعری اور اردو عروض کے ساتھ ساتھ زکوٰۃ و فرائض کیلکولیٹرز سے جڑیں۔",
      ar: "اتصل بالمكتبة الشاملة وتراث وكتب التفسير ومصادر الحديث والرجال والمعاجم وشعر «گنجور» وعروض الأردية، إضافةً إلى حاسبتي الزكاة والفرائض.",
    },
  },
  {
    icon: "library",
    title: { en: "Personal library & knowledge graph", ur: "ذاتی لائبریری اور نالج گراف", ar: "مكتبة شخصية ورسم معرفي" },
    desc: {
      en: "Upload PDF, DOCX, TXT or MD into your own private library and search it by meaning. Extract people, books, places and terms into linked entity cards — merges are always your decision.",
      ur: "PDF، DOCX، TXT یا MD اپنی نجی لائبریری میں اپلوڈ کریں اور مفہوم کے لحاظ سے تلاش کریں۔ شخصیات، کتب، مقامات اور اصطلاحات کو باہم جڑے کارڈز میں نکالیں — انضمام کا فیصلہ ہمیشہ آپ کا۔",
      ar: "ارفع ملفات PDF وDOCX وTXT وMD إلى مكتبتك الخاصة وابحث فيها بالمعنى. استخرج الأعلام والكتب والأماكن والمصطلحات في بطاقات مترابطة — ودمج الكيانات قرارك دائمًا.",
    },
  },
  {
    icon: "voice",
    title: { en: "Transcribe, OCR & speak", ur: "ٹرانسکرپشن، OCR اور آواز", ar: "تفريغ صوتي وOCR ونطق" },
    desc: {
      en: "Transcribe up to 60 minutes of Urdu, Arabic or English audio with SRT / VTT export; extract text from scans and photos; and turn text into speech with six voice personas. Personal voice cloning (your own voice only) is planned, not yet available.",
      ur: "اردو، عربی یا انگریزی آڈیو کی 60 منٹ تک ٹرانسکرپشن (SRT / VTT ایکسپورٹ)، اسکین اور تصاویر سے متن نکالنا، اور چھ آوازوں میں ٹیکسٹ ٹو اسپیچ۔ ذاتی آواز کی کلوننگ (صرف اپنی آواز) منصوبے میں ہے، ابھی دستیاب نہیں۔",
      ar: "فرّغ حتى 60 دقيقة من الصوت بالأردية أو العربية أو الإنجليزية مع تصدير SRT / VTT، واستخرج النص من الصور والمسح الضوئي، وحوّل النص إلى كلام بست شخصيات صوتية. استنساخ الصوت الشخصي (صوتك أنت فقط) مخطّط له ولم يتوفر بعد.",
    },
  },
  {
    icon: "book",
    title: { en: "Book translation & Shamela reader", ur: "کتاب کا ترجمہ اور شاملہ ریڈر", ar: "ترجمة الكتب وقارئ الشاملة" },
    desc: {
      en: "Read a PDF or Shamela book beside its AI translation, with translation memory, and translate a whole book chunk by chunk.",
      ur: "PDF یا شاملہ کی کتاب کو اس کے AI ترجمے کے ساتھ ساتھ پڑھیں، ٹرانسلیشن میموری کے ساتھ، اور پوری کتاب کا حصہ بہ حصہ ترجمہ کریں۔",
      ar: "اقرأ كتابًا بصيغة PDF أو من الشاملة بجوار ترجمته الآلية، مع ذاكرة ترجمة، وترجم الكتاب كاملًا دفعةً دفعة.",
    },
  },
];

export const DESKTOP: { title: L10n; subtitle: L10n; points: L10n[]; cta: L10n; note: L10n } = {
  title: {
    en: "Prefer everything on your own machine? Use the desktop app",
    ur: "سب کچھ اپنے کمپیوٹر پر چاہیے؟ ڈیسک ٹاپ ایپ استعمال کریں",
    ar: "تفضّل أن يبقى كل شيء على جهازك؟ استخدم تطبيق سطح المكتب",
  },
  subtitle: {
    en: "A privacy-first version for Windows, macOS and Linux, with no cloud dependency required.",
    ur: "ونڈوز، macOS اور لینکس کے لیے پرائیویسی فرسٹ ورژن، جس کے لیے کلاؤڈ ضروری نہیں۔",
    ar: "نسخة تضع الخصوصية أولًا لأنظمة ويندوز وmacOS ولينكس، دون حاجة إلى السحابة.",
  },
  points: [
    {
      en: "Local-first storage and offline semantic search (SQLite + sqlite-vec)",
      ur: "مقامی اسٹوریج اور آف لائن سیمینٹک سرچ (SQLite + sqlite-vec)",
      ar: "تخزين محلي وبحث دلالي دون اتصال (SQLite + sqlite-vec)",
    },
    {
      en: "Bring your own Gemini key — encrypted in your OS keychain, never exposed to the interface",
      ur: "اپنی Gemini کلید استعمال کریں — آپ کے OS کی کی چین میں خفیہ، انٹرفیس تک کبھی نہیں پہنچتی",
      ar: "استخدم مفتاح Gemini الخاص بك — مشفّر في سلسلة مفاتيح النظام ولا يصل إلى الواجهة أبدًا",
    },
    {
      en: "Native Maktaba Shamela 4 integration: reads your local install and imports chosen books with page and volume kept for citations",
      ur: "مکتبہ شاملہ 4 سے براہِ راست انضمام: آپ کی مقامی انسٹالیشن پڑھتی ہے اور منتخب کتب صفحہ و جلد کے ساتھ درآمد کرتی ہے تاکہ حوالے درست رہیں",
      ar: "تكامل مباشر مع المكتبة الشاملة 4: يقرأ تثبيتك المحلي ويستورد الكتب المختارة مع رقم الصفحة والجزء للاستشهاد الدقيق",
    },
    {
      en: "Offline voice studio — Whisper speech-to-text and Piper text-to-speech for Urdu and Arabic",
      ur: "آف لائن وائس اسٹوڈیو — Whisper اسپیچ ٹو ٹیکسٹ اور اردو و عربی کے لیے Piper ٹیکسٹ ٹو اسپیچ",
      ar: "استوديو صوتي دون اتصال — Whisper للتفريغ وPiper للنطق بالأردية والعربية",
    },
    {
      en: "Agent automation of Word, Excel, PowerPoint, LibreOffice and InPage documents",
      ur: "ایجنٹ کے ذریعے Word، Excel، PowerPoint، LibreOffice اور InPage دستاویزات کی آٹومیشن",
      ar: "أتمتة مستندات Word وExcel وPowerPoint وLibreOffice وInPage عبر الوكيل",
    },
  ],
  cta: { en: "Download desktop app", ur: "ڈیسک ٹاپ ایپ ڈاؤن لوڈ کریں", ar: "تنزيل تطبيق سطح المكتب" },
  note: {
    en: "The web and desktop workspaces are separate; move work between them with an explicit export / import.",
    ur: "ویب اور ڈیسک ٹاپ ورک اسپیس الگ الگ ہیں؛ کام ایک سے دوسرے میں واضح ایکسپورٹ / امپورٹ سے منتقل ہوتا ہے۔",
    ar: "مساحتا الويب وسطح المكتب منفصلتان؛ وتُنقل الأعمال بينهما بتصدير واستيراد صريحين.",
  },
};

export const TRUST: { title: L10n; subtitle: L10n; items: Array<{ title: L10n; desc: L10n }> } = {
  title: {
    en: "Built to assist scholars, not replace them",
    ur: "علماء کی معاونت کے لیے، ان کا متبادل بننے کے لیے نہیں",
    ar: "صُمّم لمعاونة العلماء لا لتعويضهم",
  },
  subtitle: {
    en: "AI output is a draft for you to check. The design choices below keep you in control.",
    ur: "AI کا نتیجہ آپ کی جانچ کے لیے ایک مسودہ ہے۔ نیچے کے ڈیزائن فیصلے کنٹرول آپ کے ہاتھ میں رکھتے ہیں۔",
    ar: "مخرجات الذكاء الاصطناعي مسودة لتراجعها أنت، والخيارات التالية تُبقي زمام الأمر بيدك.",
  },
  items: [
    {
      title: { en: "Sources shown, every time", ur: "ہر بار ماخذ ظاہر", ar: "المصادر ظاهرة دائمًا" },
      desc: {
        en: "Each AI run lists its sources and a confidence score, and annotations survive AI edits.",
        ur: "ہر AI رن اپنے ماخذ اور اعتماد اسکور دکھاتا ہے، اور حاشیہ نوٹس AI ایڈٹ کے بعد بھی محفوظ رہتے ہیں۔",
        ar: "يعرض كل تشغيل مصادره ودرجة الثقة، وتبقى الملاحظات الهامشية سليمة بعد تعديلات الذكاء الاصطناعي.",
      },
    },
    {
      title: { en: "You approve changes", ur: "تبدیلی کی منظوری آپ کی", ar: "الموافقة على التعديلات لك" },
      desc: {
        en: "Fixed pipelines are priced up front, the agent asks before editing, and look-alike entities are only ever suggested as duplicates.",
        ur: "مقررہ پائپ لائنز کی لاگت پہلے بتائی جاتی ہے، ایجنٹ ایڈٹ سے پہلے پوچھتا ہے، اور ملتے جلتے ناموں کو صرف ممکنہ تکرار کے طور پر تجویز کیا جاتا ہے۔",
        ar: "تُعرض كلفة المسارات الثابتة مسبقًا، ويستأذن الوكيل قبل التعديل، ولا تُقترح الكيانات المتشابهة إلا كتكرار محتمل.",
      },
    },
    {
      title: { en: "Your data stays yours", ur: "آپ کا ڈیٹا آپ ہی کا", ar: "بياناتك لك" },
      desc: {
        en: "Your personal library is private to you through row-level security; the desktop app keeps data on your machine; the code is open source under AGPL-3.0.",
        ur: "آپ کی ذاتی لائبریری row-level security کے ذریعے صرف آپ کے لیے نجی ہے؛ ڈیسک ٹاپ ایپ ڈیٹا آپ کے کمپیوٹر پر رکھتی ہے؛ کوڈ AGPL-3.0 کے تحت اوپن سورس ہے۔",
        ar: "مكتبتك الشخصية خاصة بك عبر أمان مستوى الصف؛ وتحفظ نسخة سطح المكتب البيانات على جهازك؛ والشيفرة مفتوحة المصدر برخصة AGPL-3.0.",
      },
    },
  ],
};

export const AUDIENCES: { title: L10n; items: Array<{ title: L10n; desc: L10n }> } = {
  title: { en: "Who it's for", ur: "کن کے لیے ہے", ar: "لمن هو؟" },
  items: [
    {
      title: { en: "Muftis & fatwa desks", ur: "مفتیانِ کرام اور دارالافتاء", ar: "المفتون ودور الإفتاء" },
      desc: {
        en: "Draft fatwas with cited sources and calculate zakat and faraid.",
        ur: "حوالوں کے ساتھ فتویٰ مسودے بنائیں اور زکوٰۃ و فرائض کا حساب کریں۔",
        ar: "صُغ الفتاوى بمصادر موثّقة واحسب الزكاة والفرائض.",
      },
    },
    {
      title: { en: "Researchers & students", ur: "محققین اور طلبہ", ar: "الباحثون والطلاب" },
      desc: {
        en: "Search classical sources, take hadith through takhrij and format a thesis.",
        ur: "کلاسیکی ماخذ تلاش کریں، حدیث کی تخریج کریں اور تھیسس فارمیٹ کریں۔",
        ar: "ابحث في المصادر الكلاسيكية وخرّج الأحاديث ونسّق رسالتك العلمية.",
      },
    },
    {
      title: { en: "Translators", ur: "مترجمین", ar: "المترجمون" },
      desc: {
        en: "Translate whole books with translation memory beside the source.",
        ur: "ماخذ کے ساتھ ٹرانسلیشن میموری کی مدد سے پوری کتابیں ترجمہ کریں۔",
        ar: "ترجم كتبًا كاملة بذاكرة ترجمة إلى جانب النص الأصلي.",
      },
    },
    {
      title: { en: "Publishers & archivists", ur: "ناشرین اور محافظینِ مواد", ar: "الناشرون وأمناء الأرشيف" },
      desc: {
        en: "Digitise scans with OCR, transcribe lectures and typeset print-ready PDFs.",
        ur: "OCR سے اسکین ڈیجیٹائز کریں، دروس کی ٹرانسکرپشن کریں اور پرنٹ کے لیے تیار PDF بنائیں۔",
        ar: "رقمِن المسوحات بـOCR وفرّغ الدروس الصوتية ونضّد ملفات PDF جاهزة للطباعة.",
      },
    },
  ],
};

export const PRICING_NOTE: L10n = {
  en: "Accounts need admin approval before tools unlock. Pay by bank transfer, JazzCash or EasyPaisa and upload your receipt.",
  ur: "ٹولز کھلنے سے پہلے اکاؤنٹ کی ایڈمن منظوری ضروری ہے۔ بینک ٹرانسفر، جاز کیش یا ایزی پیسہ سے ادائیگی کر کے رسید اپلوڈ کریں۔",
  ar: "يلزم اعتماد المشرف للحساب قبل تفعيل الأدوات. ادفع بالتحويل البنكي أو JazzCash أو EasyPaisa وارفع الإيصال.",
};

export const FAQ_HEADING: L10n = { en: "Frequently asked questions", ur: "عام سوالات", ar: "الأسئلة الشائعة" };

export const FAQ: Array<{ q: L10n; a: L10n }> = [
  {
    q: {
      en: "What is Al-Ulama Easy Editor?",
      ur: "العلماء ایزی ایڈیٹر کیا ہے؟",
      ar: "ما هو العلماء إيزي إيديتور؟",
    },
    a: {
      en: "It is an AI research and writing workspace for Islamic scholars, students and researchers. It combines source-grounded research, an Urdu/Arabic/English editor, an AI agent with scholarly playbooks, transcription, OCR and text-to-speech, on the web and as a desktop app.",
      ur: "یہ علماء، طلبہ اور محققین کے لیے AI ریسرچ اور تحریری ورک اسپیس ہے۔ اس میں ماخذ پر مبنی تحقیق، اردو/عربی/انگریزی ایڈیٹر، علمی پلے بُکس والا AI ایجنٹ، ٹرانسکرپشن، OCR اور ٹیکسٹ ٹو اسپیچ شامل ہیں؛ ویب اور ڈیسک ٹاپ دونوں پر۔",
      ar: "هو مساحة عمل بالذكاء الاصطناعي للبحث والكتابة موجّهة للعلماء والطلاب والباحثين، تجمع بحثًا موثّق المصادر ومحرّرًا بالعربية والأردية والإنجليزية ووكيلًا بخطط عمل علمية وتفريغًا صوتيًا وOCR وتحويل نص إلى كلام، على الويب وكتطبيق مكتبي.",
    },
  },
  {
    q: {
      en: "Can I trust the AI's answers?",
      ur: "کیا AI کے جوابات پر اعتماد کیا جا سکتا ہے؟",
      ar: "هل يمكن الوثوق بإجابات الذكاء الاصطناعي؟",
    },
    a: {
      en: "Treat them as drafts. Each run shows its sources and a confidence score so you can verify them, and the tool is designed to assist a scholar's judgement, not to issue rulings.",
      ur: "انہیں مسودہ سمجھیں۔ ہر رن اپنے ماخذ اور اعتماد اسکور دکھاتا ہے تاکہ آپ تصدیق کر سکیں؛ یہ ٹول عالم کی رائے کی معاونت کے لیے ہے، فتویٰ جاری کرنے کے لیے نہیں۔",
      ar: "اعتبرها مسودات. يعرض كل تشغيل مصادره ودرجة الثقة لتتحقق منها، والأداة مصمّمة لمعاونة اجتهاد العالم لا لإصدار الأحكام.",
    },
  },
  {
    q: {
      en: "Is using AI for Islamic research permissible?",
      ur: "کیا اسلامی تحقیق میں AI کا استعمال جائز ہے؟",
      ar: "هل يجوز استخدام الذكاء الاصطناعي في البحث الإسلامي؟",
    },
    a: {
      en: "We discuss this in a dedicated article. In short, we position AI as a tool for finding and organising sources, with the scholar remaining responsible for the conclusion.",
      ur: "اس موضوع پر الگ مضمون میں بات کی گئی ہے۔ مختصراً، ہم AI کو ماخذ ڈھونڈنے اور ترتیب دینے کا ایک آلہ سمجھتے ہیں، جبکہ نتیجے کی ذمہ داری عالم پر رہتی ہے۔",
      ar: "ناقشنا ذلك في مقال مستقل. باختصار، نعدّ الذكاء الاصطناعي أداةً للعثور على المصادر وتنظيمها، ويبقى العالم مسؤولًا عن الاستنتاج.",
    },
  },
  {
    q: {
      en: "Which languages are supported?",
      ur: "کون سی زبانیں سپورٹ ہوتی ہیں؟",
      ar: "ما اللغات المدعومة؟",
    },
    a: {
      en: "The interface, editor, transcription and OCR work in Urdu, Arabic and English, with proper right-to-left layout and Nastaliq / Naskh fonts.",
      ur: "انٹرفیس، ایڈیٹر، ٹرانسکرپشن اور OCR اردو، عربی اور انگریزی میں کام کرتے ہیں، درست دائیں سے بائیں لے آؤٹ اور نستعلیق / نسخ فونٹس کے ساتھ۔",
      ar: "تعمل الواجهة والمحرّر والتفريغ الصوتي وOCR بالأردية والعربية والإنجليزية، مع اتجاه كتابة صحيح من اليمين إلى اليسار وخطوط النستعليق والنسخ.",
    },
  },
  {
    q: {
      en: "Does it work offline, and where is my data stored?",
      ur: "کیا یہ آف لائن چلتی ہے، اور میرا ڈیٹا کہاں رہتا ہے؟",
      ar: "هل يعمل دون اتصال، وأين تُخزَّن بياناتي؟",
    },
    a: {
      en: "The desktop app stores data locally and can run speech-to-text and text-to-speech offline; AI answers use your own Gemini key. The web app stores your account data in our cloud backend, with your personal library private to you.",
      ur: "ڈیسک ٹاپ ایپ ڈیٹا مقامی طور پر رکھتی ہے اور اسپیچ ٹو ٹیکسٹ و ٹیکسٹ ٹو اسپیچ آف لائن چلا سکتی ہے؛ AI جوابات آپ کی اپنی Gemini کلید سے آتے ہیں۔ ویب ایپ آپ کے اکاؤنٹ کا ڈیٹا ہمارے کلاؤڈ بیک اینڈ میں رکھتی ہے، اور ذاتی لائبریری صرف آپ کے لیے نجی رہتی ہے۔",
      ar: "يخزّن تطبيق سطح المكتب البيانات محليًا ويشغّل التفريغ والنطق دون اتصال، وتعتمد إجابات الذكاء الاصطناعي على مفتاح Gemini الخاص بك. أما تطبيق الويب فيحفظ بيانات حسابك في خلفيتنا السحابية، وتبقى مكتبتك الشخصية خاصة بك.",
    },
  },
  {
    q: {
      en: "How do I get access and pay?",
      ur: "رسائی اور ادائیگی کیسے ہوتی ہے؟",
      ar: "كيف أحصل على الوصول وأدفع؟",
    },
    a: {
      en: "Create an account, choose a plan and pay by bank transfer, JazzCash or EasyPaisa, then upload your receipt. An admin approves new accounts before tools unlock. See the pricing page for plan limits and the refund policy.",
      ur: "اکاؤنٹ بنائیں، پلان منتخب کریں، بینک ٹرانسفر، جاز کیش یا ایزی پیسہ سے ادائیگی کر کے رسید اپلوڈ کریں۔ ٹولز کھلنے سے پہلے ایڈمن نئے اکاؤنٹ کی منظوری دیتا ہے۔ پلان کی حدود اور ریفنڈ پالیسی پرائسنگ پیج پر دیکھیں۔",
      ar: "أنشئ حسابًا واختر خطة وادفع بالتحويل البنكي أو JazzCash أو EasyPaisa ثم ارفع الإيصال. يعتمد المشرف الحسابات الجديدة قبل تفعيل الأدوات. راجع صفحة الأسعار لحدود الخطط وسياسة الاسترداد.",
    },
  },
  {
    q: {
      en: "Is voice cloning available?",
      ur: "کیا آواز کی کلوننگ دستیاب ہے؟",
      ar: "هل استنساخ الصوت متاح؟",
    },
    a: {
      en: "Not yet. Personal voice cloning, using only your own voice, is planned. We do not support cloning celebrities or third parties.",
      ur: "ابھی نہیں۔ ذاتی آواز کی کلوننگ، صرف آپ کی اپنی آواز کے ساتھ، منصوبے میں ہے۔ مشہور شخصیات یا کسی تیسرے فرد کی آواز کی کلوننگ ہم سپورٹ نہیں کرتے۔",
      ar: "ليس بعد. استنساخ الصوت الشخصي، بصوتك أنت فقط، مخطّط له. ولا ندعم استنساخ أصوات المشاهير أو أي طرف ثالث.",
    },
  },
];

export const FINAL_CTA: { title: L10n; subtitle: L10n } = {
  title: {
    en: "Ready to start your research?",
    ur: "اپنی تحقیق شروع کرنے کے لیے تیار ہیں؟",
    ar: "هل أنت مستعد لبدء بحثك؟",
  },
  subtitle: {
    en: "Create your account in under a minute and pick the plan that fits you.",
    ur: "ایک منٹ سے کم میں اکاؤنٹ بنائیں اور اپنے مطابق پلان منتخب کریں۔",
    ar: "أنشئ حسابك في أقل من دقيقة واختر الخطة المناسبة لك.",
  },
};
