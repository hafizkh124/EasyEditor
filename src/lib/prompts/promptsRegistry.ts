/**
 * 14 Specialized Scholarly Prompts Registry for Al-Ulama Easy Editor
 * Integrates classical Shamela workflow methods adapted for multi-tier search.
 */

export interface ScholarlyPromptDef {
  id: string;
  code: string;
  titleAr: string;
  titleUr: string;
  descriptionUr: string;
  category: "fiqh" | "hadith" | "tafsir" | "general" | "authoring" | "lexicon";
  arguments: { name: string; labelUr: string; placeholderUr: string; required: boolean }[];
  systemInstructionTemplate: string;
  /** Should the query route through the grounded Islamic engine (corpus-cited) rather than a general LLM? */
  grounded: boolean;
  /** Is the corpus this prompt depends on for citations already ingested? If false, results may be unverified. */
  corpusReady: boolean;
}

const RAW_PROMPTS: Omit<ScholarlyPromptDef, "grounded" | "corpusReady">[] = [
  {
    id: "study_masala",
    code: "study_masala",
    titleAr: "دراسة مسألة فقهية",
    titleUr: "فقہی مسئلے کا تفصیلی مطالعہ",
    descriptionUr: "مسئلے کی تصویر کشی، ابوابِ فقہ میں تلاش، متن و حاشیہ کی تمیز اور دلائل کا خلاصہ بمعہ حوالہ جات۔",
    category: "fiqh",
    arguments: [
      { name: "masala", labelUr: "فقہی مسئلہ", placeholderUr: "مثلاً: رفع یدین عند الرکوع کا شرعی حکم", required: true }
    ],
    systemInstructionTemplate: `ادرس المسألة الفقهية: «{{masala}}». ابدأ بتصوير المسألة واستفصل عن الملابسات المؤثرة قبل البحث؛ فالحكم على الشيء فرع عن تصوره. ثم حدّد مظانّها في کتب الفقه ومصادرها، واقرأ المواضع بسياقها مع التمييز بين المتن والحاشية، ولخّص الأقوال بأدلتها معزوًّا كلَّ قولٍ بإحالة مستندة إلى الكتاب والجلد والصفحة دون اختلاق.`
  },
  {
    id: "compare_madhahib",
    code: "compare_madhahib",
    titleAr: "مقارنة المذاهب الفقهية",
    titleUr: "مذاہبِ اربعہ کا بالمقابل موازنہ",
    descriptionUr: "حنفی، مالکی، شافعی، حنبلی کتب سے اقوال کا براہِ راست نقل اور تقابلی جدول (Matrix Table)۔",
    category: "fiqh",
    arguments: [
      { name: "masala", labelUr: "فقہی مسئلہ", placeholderUr: "مثلاً: بيع العربون (بیع بالعبون)", required: true },
      { name: "madhahib", labelUr: "مطلوبہ مذاہب", placeholderUr: "مثلاً: الحنفية، الشافعية، الحنابلة، المالكية", required: false }
    ],
    systemInstructionTemplate: `قارن أقوال المذاهب الفقهية في: «{{masala}}»، والنطاق المطلوب: {{madhahib}}. وانقل عن كل مذهب من كتبه هو لا من كتب خصومه. اقرأ الموضع بسياقه وانقل القول بنصه مميّزًا المتن من الحاشية مع الإحالة للمصدر، ثم اجمع المقارنة في جدول: (المذهب | القول | الدليل | المصدر).`
  },
  {
    id: "trace_hadith",
    code: "trace_hadith",
    titleAr: "تخريج الحديث ودراسة الإسناد",
    titleUr: "تخریجِ حدیث و جائزہ",
    descriptionUr: "حدیث کے مواضع، صحابہ و راویوں کی نشاندہی، اور متن و محقق کے حواشی کی الگ نسبت۔",
    category: "hadith",
    arguments: [
      { name: "text", labelUr: "حدیث کا متن یا حصہ", placeholderUr: "مثلاً: إنما الأعمال بالنيات", required: true }
    ],
    systemInstructionTemplate: `خرّج الحديث: «{{text}}». صنّف أولًا المعلومَ عن الحديث قبل البحث (صحابيه؟ أول متنه؟ لفظة مميزة؟ موضوعه؟). تتبع مواضعه في کتب الحديث وتخريجه، واعزل ما في الحواشي من تخريج مطبوع للمحقق لا للمصنّف، مع إيراد الإحالات والدقيقة لكل موضع.`
  },
  {
    id: "tafsir_aya_muqaran",
    code: "tafsir_aya_muqaran",
    titleAr: "تفسير آية مقارن",
    titleUr: "موازنہ تفاسیر بترتیبِ وفیات",
    descriptionUr: "آیت کے عثمانی و املا رسم اور سنِ وفات کی تاریخی ترتیب میں مفسرین کے اقوال کا موازنہ۔",
    category: "tafsir",
    arguments: [
      { name: "aya", labelUr: "آیت مبارکہ یا حوالہ", placeholderUr: "مثلاً: البقرة: 255 یا «اللَّهُ لا إِلَهَ إِلاَّ هُوَ الْحَيُّ الْقَيُّومُ»", required: true }
    ],
    systemInstructionTemplate: `فسّر الآية: «{{aya}}» من عدة تفاسير معتمدة. حدّد الآية بالرسمين الإملائي والعثماني، واعرض نصوص التفاسير مرتّبةً بوفيات المفسرين التاريخية مع إحالة موثقة لكل نقل، موضحًا الفروق واللطائف البلاغية بين المفسرين.`
  },
  {
    id: "nazila_muasira",
    code: "nazila_muasira",
    titleAr: "دراسة نازلة معاصرة",
    titleUr: "جدید درپیش مسائل کا 5 مرحلہ وار مطالعہ",
    descriptionUr: "تصوير الواقع ← التكييف ← تحقيق المناط ← النظر في المآلات ← الحكم الشرعي۔",
    category: "fiqh",
    arguments: [
      { name: "nazila", labelUr: "جدید درپیش مسئلہ / نازلہ", placeholderUr: "مثلاً: التداول بالعملات الرقمية (Crypto Trading)", required: true }
    ],
    systemInstructionTemplate: `ادرس النازلة المعاصرة: «{{nazila}}» على المراحل الخمس: (1) تصوير الواقع: استفصل عن حقيقة النازلة؛ فالحكم على الشيء فرع عن تصوره. (2) التكييف: ألحقها ببابها الفقهي ونظائرها. (3) تحقيق المناط: تثبّت من انطباق علل الأحكام. (4) النظر في المآلات: اعرض اعتبار المآلات والنظائر. (5) الحكم: اعرض خلاصة الأقوال بأدلتها منسوبةً دون ترجيح إلا بطلب المستخدم.`
  },
  {
    id: "khittat_bahth",
    code: "khittat_bahth",
    titleAr: "خطة البحث والتأليف وعدم السبق",
    titleUr: "تحقیقی مقالے یا کتاب کا خاکہ",
    descriptionUr: "پرانی دراسات کی چھان بین (عدم سبقِ دراسہ)، مسئلہ، اہمیت، اور ابواب و فصول کا مکمل خاکہ۔",
    category: "authoring",
    arguments: [
      { name: "mawdu", labelUr: "موضوعِ تحقیق", placeholderUr: "مثلاً: أحكام العقود الذكية في الفقه الإسلامي", required: true },
      { name: "jamia", labelUr: "جامعہ یا مقصد", placeholderUr: "مثلاً: جامعة الأزهر / کتاب برائے طبع", required: false }
    ],
    systemInstructionTemplate: `أعدّ خطة بحث لموضوع: «{{mawdu}}»، والجهة المقصودة: {{jamia}}. تحقق أولًا من عدم سبق دراسته في الفهارس والأبواب، واذكر ما وجدته من دراسات قريبة وموضع الجدة. ثم اقترح عناصر الخطة: العنوان، المشكلة، الأهمية، الدراسات السابقة، المنهج، التقسيم إلى فصول وأبواب، وقائمة المصادر.`
  },
  {
    id: "kitabat_maqal",
    code: "kitabat_maqal",
    titleAr: "كتابة مقال صحفي/دعوي/إعلامي",
    titleUr: "مضمون و کالم نگاری برائے سوشل میڈیا و مجلات",
    descriptionUr: "پرکشش عنوان، مؤثر تمہید، سلیس استدلال مع مراجع، اور فکری و اصلاحی پیغام۔",
    category: "authoring",
    arguments: [
      { name: "topic", labelUr: "مضمون کا موضوع", placeholderUr: "مثلاً: دور الشباب في حفظ الهوية الإسلامية", required: true },
      { name: "platform", labelUr: "پلیٹ فارم / میڈیم", placeholderUr: "مثلاً: سوشل میڈیا / علمی مجلہ / اخبار", required: false }
    ],
    systemInstructionTemplate: `اكتب مقالًا فكريًّا/دعويًّا موجَّهًا لـ {{platform}} في موضوع: «{{topic}}». صغ عنوانًا جذابًا وبليغًا، وابدأ بمقدمة مشوقة، واعرض الأفكار باستدلال سليس وموثق بالقرآن والحديث والأقوال دون إغراق في الجدل الفقهي، واختم بخلاصة ورسالة فكرية مؤثره.`
  },
  {
    id: "tarjama_muqaran",
    code: "tarjama_muqaran",
    titleAr: "تقابل التراجم (آية / جملة / لفظ)",
    titleUr: "مختلف مترجمین کا بالمقابل موازنہ",
    descriptionUr: "کسی آیت، جملے یا لفظ کا جالندھری، رضا خان، مودودی، تقی عثمانی، Saheeh وغیرہ کا موازنہ۔",
    category: "general",
    arguments: [
      { name: "passage_or_phrase", labelUr: "آیت، جملہ یا لفظ", placeholderUr: "مثلاً: البقرة: 255 یا لفظ «الصَّمَدُ»", required: true }
    ],
    systemInstructionTemplate: `أجرِ مقارنة تراجم شاملة لـ: «{{passage_or_phrase}}» بين مختلف المترجمين المعتمدين (مثل: فتح محمد جالندھری، أحمد رضا خان، المودودي، تفي العثماني، Saheeh International). اعرض النتائج في جدول مقارن: (المترجم | الأسلوب | الترجمة | النكتة اللغوية/البيانية)، وإذا كان الإدخال لفظة مفردة فبيّن دلالتها اللغوية واختيار كل مترجم لها.`
  },
  {
    id: "takhrij_fatwa",
    code: "takhrij_fatwa",
    titleAr: "تخريج وتفتيش جزئيات الفتاوى",
    titleUr: "فتاویٰ کے نصوص و جزئیات کی تصدیق",
    descriptionUr: "فتاویٰ عالمگیری، رد المحتار، فتاویٰ رضویہ، دیوبند سے نص اور جزئیہ کا نکالنا۔",
    category: "fiqh",
    arguments: [
      { name: "fatwa_query", labelUr: "مسئلہ یا جزئیہ فتاویٰ", placeholderUr: "مثلاً: حكم الصلاة في السفينة المتحركة", required: true }
    ],
    systemInstructionTemplate: `فتّش واستخرج جزئيات الفتاوى المتعلقة بـ: «{{fatwa_query}}» من كتب الفتاوى المعتمدة (مثل: الفتاوى الهندية، رد المحتار لابن عابدين، الفتاوى الرضوية، فتاوى دار العلوم). انقل النص الفقهي بدقة مع عزو تام للجزء والصفحة واسم المفتي/الكتاب.`
  },
  {
    id: "lughat_w_irab",
    code: "lughat_w_irab",
    titleAr: "اللغة والإعراب والبلاغة",
    titleUr: "لغوی و نحوی تحقیق اور ترکیبی اعراب",
    descriptionUr: "لسان العرب، القاموس المحیط سے مادہ، اور آیت/حدیث کا ترکیبی نحوی اعراب۔",
    category: "lexicon",
    arguments: [
      { name: "word_or_text", labelUr: "عربی لفظ یا آیت/نص", placeholderUr: "مثلاً: «الصَّمَدُ» یا «إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ»", required: true }
    ],
    systemInstructionTemplate: `أجرِ بحثًا لغويًّا وإعرابيًّا لـ: «{{word_or_text}}». استخرج جذر اللفظة ومدلولاتها من معاجم اللغة (لسان العرب، القاموس المحيط، مفردات راغب)، واذكر التصريف الصرفي، والإعراب النحوي التفصيلي للجملة مع بيان الدقائق البلاغية.`
  },
  {
    id: "tahqeeq_texts",
    code: "tahqeeq_texts",
    titleAr: "تحقيق وتصحيح النصوص والضبط",
    titleUr: "نصوص کے اعراب، تصحیح اور ایڈیٹنگ",
    descriptionUr: "عربی/اردو نصوص کے اعراب کی تصدیق، سمارٹ املاء درستگی، اور محققانہ ایڈیٹنگ۔",
    category: "authoring",
    arguments: [
      { name: "raw_text", labelUr: "نص المراد تحقيقه", placeholderUr: "عربی یا اردو متن یہاں درج کریں...", required: true }
    ],
    systemInstructionTemplate: `حقّق وضبط النص التالي: «{{raw_text}}». اضبط الكلمات المعجمة والشكيلة بالتشكيل التام الصحيح وفق قواعد النحو والصرف، واصلح الأخطاء الإملائية والمطبعية، وميّز نصوص القرآن والأحاديث بالأقواس المعتمدة مع إيراد التخريج المختصر.`
  },
  {
    id: "tarjama_rawi",
    code: "tarjama_rawi",
    titleAr: "ترجمة راوٍ (علم الرجال والجرح والتعديل)",
    titleUr: "راوی کا ترجمہ و جرح و تعدیل",
    descriptionUr: "راوی کا تعارف، طبقہ، شیوخ، تلامذہ، ائمہ جرح و تعدیل کے اقوال اور حکم۔",
    category: "hadith",
    arguments: [
      { name: "rawi_name", labelUr: "راوی کا نام", placeholderUr: "مثلاً: محمد بن إسحاق بن يسار / نافع مولى ابن عمر", required: true }
    ],
    systemInstructionTemplate: `أورد ترجمة وافية للراوي: «{{rawi_name}}» من كتب الرجال المعتمدة (تهذيب الكمال، تهذيب التهذيب، ميزان الاعتدال، سير أعلام النبلاء). اذكر اسمه ونسبه وطبقته، وأبرز شيوخه (من روى عنه) وتلامذته (من روى عنهم)، واجمع أقوال أئمة الجرح والتعديل فيه مع خلاصة حكم العلماء على حديثه.`
  },
  {
    id: "seerat_alam",
    code: "seerat_alam",
    titleAr: "سيرة علَم وسوانح العلماء",
    titleUr: "علماء و شخصیات کے حالاتِ زندگی",
    descriptionUr: "ولادت، نسب، شیوخ، علمی اسفار، دینی خدمات، تصانیف، اور سنِ وفات مع مراجع۔",
    category: "general",
    arguments: [
      { name: "scholar_name", labelUr: "عالم یا شخصیت کا نام", placeholderUr: "مثلاً: الإمام النووي / الشاه ولي الله الدهلوي", required: true }
    ],
    systemInstructionTemplate: `أعدّ سيرة ومترجمة شاملة للعَلَم: «{{scholar_name}}». اذكر ولادته ونسبه ونشأته، ورحلاته العلمية وأبرز شيوخه وتلامذته، وجهوده العلمية والدعوية، وأهم تآليفه ومؤلفاته، وسنة وفاته، مستندًا إلى كتب التاريخ والطبقات مع الإحالة للمصادر.`
  },
  {
    id: "tabsira_kitab",
    code: "tabsira_kitab",
    titleAr: "تعريف بكتاب وتبصرة نقدية",
    titleUr: "کتب کا تعارف، خوبیاں، خامیاں اور تبصرہ",
    descriptionUr: "کتاب کا شناسنامہ، موضوع، مصنف کا اسلوب، نمایاں خوبیاں، علمی ملاحظات، اور نتیجہ۔",
    category: "authoring",
    arguments: [
      { name: "book_title", labelUr: "کتاب کا نام", placeholderUr: "مثلاً: فتح الباري بشرح صحيح البخاري / الموافقات للشاطبي", required: true },
      { name: "author", labelUr: "مصنف کا نام", placeholderUr: "مثلاً: ابن حجر العسقلاني", required: false }
    ],
    systemInstructionTemplate: `أعدّ تعريفًا وتبصرة نقدية لكتاب: «{{book_title}}» للمؤلف: {{author}}. اذكر بطاقة الكتاب (الفن، المجلدات، الطبعة)، وبيّن موضوعه الأساسي ومنهج المؤلف فيه، وأبرز محاسنه وميزاته العلمية، والملاحظات النقدية عليه إن وجدت، ثم أورد خلاصة لأهميته ولمن يصلح من الباحثين.`
  }
];

/**
 * Grounding metadata per prompt (kept separate from templates for clarity).
 * - grounded: route through the grounded Islamic engine (islamic-search) so
 *   citations come from the corpus, not a general LLM.
 * - corpusReady: whether the corpus this prompt cites from is already ingested.
 *   Quran (6,236) + 17 hadith collections ARE loaded; fiqh / fatawa / tafsir /
 *   lughat / rijal corpora are NOT yet (see Master Plan Phase 3-corpus), so
 *   prompts depending on them are marked unverified until then.
 */
const GROUNDING: Record<string, { grounded: boolean; corpusReady: boolean }> = {
  study_masala:       { grounded: true,  corpusReady: false }, // fiqh corpus pending
  compare_madhahib:   { grounded: true,  corpusReady: false }, // fiqh corpus pending
  trace_hadith:       { grounded: true,  corpusReady: true  }, // hadith loaded
  tafsir_aya_muqaran: { grounded: true,  corpusReady: false }, // tafsir corpus pending
  nazila_muasira:     { grounded: true,  corpusReady: false }, // fiqh corpus pending
  khittat_bahth:      { grounded: false, corpusReady: true  }, // authoring aid
  kitabat_maqal:      { grounded: false, corpusReady: true  }, // authoring aid
  tarjama_muqaran:    { grounded: true,  corpusReady: true  }, // Quran translations loaded
  takhrij_fatwa:      { grounded: true,  corpusReady: false }, // fatawa corpus pending
  lughat_w_irab:      { grounded: true,  corpusReady: false }, // lughat corpus pending
  tahqeeq_texts:      { grounded: false, corpusReady: true  }, // editing aid
  tarjama_rawi:       { grounded: true,  corpusReady: false }, // rijal corpus pending
  seerat_alam:        { grounded: true,  corpusReady: false }, // biographies corpus pending
  tabsira_kitab:      { grounded: false, corpusReady: true  }, // authoring aid
};

export const SCHOLARLY_PROMPTS: ScholarlyPromptDef[] = RAW_PROMPTS.map((p) => ({
  ...p,
  grounded: GROUNDING[p.id]?.grounded ?? false,
  corpusReady: GROUNDING[p.id]?.corpusReady ?? true,
}));
