import { Link } from "react-router-dom";
import PublicLayout from "@/components/PublicLayout";
import { useSeo } from "@/hooks/useSeo";
import { useLanguage } from "@/contexts/LanguageContext";
import { SHAMELA_GUIDE_SEO, type L10n, type Lang } from "@/lib/pageSeo";

/**
 * SEO guide: /guides/maktaba-shamila-tutorial (+ /ur, /ar mirrors).
 * Targets the keyword "مکتبہ شاملہ" / "Maktaba Shamila".
 *
 * Facts about Shamela itself (≈8,000 books, ≈7M pages, official AI search at
 * shamela.ws/ai, downloads for computer / Android / iPhone) were checked against
 * shamela.ws on 2026-10-19. Nothing here describes Shamela's installer, file
 * formats or disk size — those were not verified, so the guide sends readers to
 * the official download page instead of restating them.
 */

const DATE_MODIFIED = "2026-10-19";
const SHAMELA = "https://shamela.ws";
const SHAMELA_AI = "https://shamela.ws/ai";

interface Section {
  h: L10n;
  p?: L10n[];
  items?: L10n[];
  ordered?: boolean;
}

const INTRO: L10n = {
  en: "Maktaba Shamila (المكتبة الشاملة, “The Comprehensive Library”) is a free digital library of classical Arabic Islamic books. Its homepage describes roughly 8,000 books, 3,000 authors and 7 million pages. This guide explains what to use it for, what it does not do, and how it fits with Al-Ulama Easy Editor.",
  ur: "مکتبہ شاملہ (المكتبة الشاملة) کلاسیکی عربی اسلامی کتب کی مفت ڈیجیٹل لائبریری ہے۔ اس کے ہوم پیج کے مطابق اس میں تقریباً 8,000 کتب، 3,000 مؤلفین اور 70 لاکھ صفحات ہیں۔ یہ رہنما بتاتا ہے کہ اسے کس کام کے لیے استعمال کریں، یہ کیا نہیں کرتی، اور العلماء ایزی ایڈیٹر کے ساتھ اس کا امتزاج کیسے بنتا ہے۔",
  ar: "المكتبة الشاملة مكتبة رقمية مجانية للكتب الإسلامية العربية الكلاسيكية، وتذكر صفحتها الرئيسة نحو 8 آلاف كتاب و3 آلاف مؤلف و7 ملايين صفحة. يوضح هذا الدليل فيمَ تستخدمها، وما لا تفعله، وكيف تتكامل مع العلماء إيزي إيديتور.",
};

const SECTIONS: Section[] = [
  {
    h: { en: "1. What Shamela gives you", ur: "1. شاملہ آپ کو کیا دیتی ہے", ar: "1. ما تقدّمه الشاملة" },
    p: [
      {
        en: "Shamela is where you find the primary text: you search the Arabic, open the book, and note the volume and page. Versions are offered for computers, Android and iPhone, and the website can also be browsed on a phone. Download from the official page rather than a third-party mirror.",
        ur: "شاملہ اصل متن تلاش کرنے کی جگہ ہے: عربی میں تلاش کریں، کتاب کھولیں، اور جلد و صفحہ نوٹ کریں۔ کمپیوٹر، اینڈرائیڈ اور آئی فون کے ورژن دستیاب ہیں اور ویب سائٹ موبائل پر بھی دیکھی جا سکتی ہے۔ ڈاؤن لوڈ سرکاری صفحے سے کریں، کسی تیسرے فریق کے مِرر سے نہیں۔",
        ar: "الشاملة هي موضع النص الأصلي: تبحث بالعربية وتفتح الكتاب وتدوّن الجزء والصفحة. تتوفر نسخ للحاسوب والأندرويد والآيفون، ويمكن تصفح الموقع من الجوال. نزّلها من الصفحة الرسمية لا من نسخ منقولة.",
      },
    ],
    items: [
      {
        en: "Official site and downloads: shamela.ws",
        ur: "سرکاری سائٹ اور ڈاؤن لوڈ: shamela.ws",
        ar: "الموقع الرسمي والتنزيل: shamela.ws",
      },
    ],
  },
  {
    h: {
      en: "2. Shamela now has its own AI search",
      ur: "2. شاملہ کی اپنی AI سرچ اب موجود ہے",
      ar: "2. للشاملة الآن بحثها بالذكاء الاصطناعي",
    },
    p: [
      {
        en: "Shamela's site links an AI search of its own (shamela.ws/ai). Use it to locate relevant books and passages. We have not benchmarked it, and we do not claim Easy Editor is more accurate. What differs is the workflow around the passage, described next.",
        ur: "شاملہ کی سائٹ پر اپنی AI سرچ (shamela.ws/ai) کا لنک موجود ہے۔ متعلقہ کتب اور عبارات ڈھونڈنے کے لیے اسے استعمال کریں۔ ہم نے اس کا کوئی موازنہ نہیں کیا اور یہ دعویٰ نہیں کرتے کہ ایزی ایڈیٹر زیادہ درست ہے۔ فرق عبارت کے گرد کام کے طریقے میں ہے، جو آگے بیان ہے۔",
        ar: "يرتبط موقع الشاملة ببحث خاص بها بالذكاء الاصطناعي (shamela.ws/ai). استخدمه لتحديد الكتب والنصوص ذات الصلة. لم نقارن دقته، ولا ندّعي أن إيزي إيديتور أدق؛ الفرق في سير العمل حول النص كما يلي.",
      },
    ],
  },
  {
    h: {
      en: "3. Where Easy Editor fits",
      ur: "3. ایزی ایڈیٹر کہاں کام آتا ہے",
      ar: "3. موضع إيزي إيديتور",
    },
    items: [
      {
        en: "Urdu and English translation and summaries of an Arabic passage, kept beside the source in one workspace.",
        ur: "عربی عبارت کا اردو و انگریزی ترجمہ اور خلاصہ، ماخذ کے ساتھ ایک ہی ورک اسپیس میں۔",
        ar: "ترجمة النص العربي وتلخيصه بالأردية والإنجليزية، إلى جانب المصدر في مساحة عمل واحدة.",
      },
      {
        en: "A Trust tab that records, for each AI run, the sources used and a confidence score, so you can check before relying on the answer.",
        ur: "Trust ٹیب جو ہر AI رن کے ماخذ اور اعتماد اسکور محفوظ کرتا ہے تاکہ جواب پر بھروسا کرنے سے پہلے جانچ سکیں۔",
        ar: "تبويب «الثقة» الذي يسجّل لكل تشغيل المصادر ودرجة الثقة لتتحقق قبل الاعتماد على الجواب.",
      },
      {
        en: "A private personal library, a writing editor with footnotes, and DOCX / PDF export for the finished piece.",
        ur: "نجی ذاتی لائبریری، حاشیہ نویسی والا ایڈیٹر، اور مکمل تحریر کے لیے DOCX / PDF ایکسپورٹ۔",
        ar: "مكتبة شخصية خاصة، ومحرّر كتابة بالحواشي، وتصدير DOCX وPDF للنص النهائي.",
      },
      {
        en: "Desktop app: reads your local Maktaba Shamela 4 installation and imports books you choose, keeping the page and volume so citations can name them. Web accounts do not read your local Shamela.",
        ur: "ڈیسک ٹاپ ایپ: آپ کی مقامی مکتبہ شاملہ 4 انسٹالیشن پڑھتی ہے اور منتخب کتب درآمد کرتی ہے، صفحہ اور جلد کے ساتھ تاکہ حوالے انہیں بتا سکیں۔ ویب اکاؤنٹ آپ کی مقامی شاملہ نہیں پڑھتا۔",
        ar: "تطبيق سطح المكتب: يقرأ تثبيت المكتبة الشاملة 4 المحلي ويستورد الكتب التي تختارها مع الصفحة والجزء ليذكرها الاستشهاد. أما حساب الويب فلا يقرأ شاملتك المحلية.",
      },
    ],
  },
  {
    h: {
      en: "4. A safe citation workflow",
      ur: "4. حوالے کی تصدیق کا محفوظ طریقہ",
      ar: "4. سير عمل آمن للتوثيق",
    },
    ordered: true,
    items: [
      {
        en: "Find the passage in Shamela and note the book, volume and page.",
        ur: "شاملہ میں عبارت تلاش کریں اور کتاب، جلد اور صفحہ نوٹ کریں۔",
        ar: "ابحث عن النص في الشاملة ودوّن الكتاب والجزء والصفحة.",
      },
      {
        en: "Paste the Arabic into Research in the Easy Editor workspace and read the sources and confidence shown in the Trust tab.",
        ur: "عربی عبارت ایزی ایڈیٹر ورک اسپیس کے Research میں پیسٹ کریں اور Trust ٹیب میں ماخذ اور اعتماد اسکور دیکھیں۔",
        ar: "الصق النص العربي في «البحث» داخل مساحة العمل، واقرأ المصادر ودرجة الثقة في تبويب «الثقة».",
      },
      {
        en: "Check any hadith grading or wording against the primary books yourself.",
        ur: "حدیث کے درجے یا الفاظ کی تصدیق اصل کتب سے خود کریں۔",
        ar: "تحقق بنفسك من درجة الحديث وألفاظه في الكتب الأصلية.",
      },
      {
        en: "Compare with a printed edition before publishing. AI output is a draft, not a ruling.",
        ur: "اشاعت سے پہلے مطبوعہ ایڈیشن سے موازنہ کریں۔ AI کا نتیجہ مسودہ ہے، فتویٰ نہیں۔",
        ar: "قارن بطبعة مطبوعة قبل النشر؛ فمخرجات الذكاء الاصطناعي مسودة لا حكم.",
      },
    ],
  },
  {
    h: {
      en: "5. Getting access",
      ur: "5. رسائی کیسے ملے",
      ar: "5. الحصول على الوصول",
    },
    p: [
      {
        en: "Research, OCR and Speak need an Easy Editor account. Create one, choose a plan and upload your payment receipt; an admin approves new accounts before the tools unlock. Plans and limits are on the pricing page.",
        ur: "Research، OCR اور Speak کے لیے ایزی ایڈیٹر اکاؤنٹ ضروری ہے۔ اکاؤنٹ بنائیں، پلان منتخب کریں اور ادائیگی کی رسید اپلوڈ کریں؛ ٹولز کھلنے سے پہلے ایڈمن نئے اکاؤنٹ کی منظوری دیتا ہے۔ پلان اور حدود پرائسنگ پیج پر ہیں۔",
        ar: "يتطلب البحث وOCR وSpeak حسابًا في إيزي إيديتور. أنشئ حسابًا واختر خطة وارفع إيصال الدفع؛ ويعتمد المشرف الحسابات الجديدة قبل تفعيل الأدوات. الخطط والحدود في صفحة الأسعار.",
      },
    ],
  },
];

const FAQ: Array<{ q: L10n; a: L10n }> = [
  {
    q: { en: "Is Maktaba Shamila free?", ur: "کیا مکتبہ شاملہ مفت ہے؟", ar: "هل المكتبة الشاملة مجانية؟" },
    a: {
      en: "Shamela describes itself as a free library; check its download page for current terms. Easy Editor is a separate paid service: its tools need an approved account on a paid plan.",
      ur: "شاملہ خود کو مفت لائبریری بتاتی ہے؛ موجودہ شرائط اس کے ڈاؤن لوڈ صفحے پر دیکھیں۔ ایزی ایڈیٹر الگ ادائیگی والی سروس ہے: اس کے ٹولز کے لیے ادائیگی والے پلان پر منظور شدہ اکاؤنٹ چاہیے۔",
      ar: "تصف الشاملة نفسها بأنها مكتبة مجانية؛ راجع صفحة التنزيل للشروط الحالية. أما إيزي إيديتور فخدمة مستقلة مدفوعة، وأدواته تحتاج حسابًا معتمدًا على خطة مدفوعة.",
    },
  },
  {
    q: {
      en: "Does Shamela have Urdu or English books?",
      ur: "کیا شاملہ میں اردو یا انگریزی کتب ہیں؟",
      ar: "هل في الشاملة كتب أردية أو إنجليزية؟",
    },
    a: {
      en: "Shamela is a library of Arabic texts. For Urdu or English, use the translation and research features in Easy Editor on the passage you found.",
      ur: "شاملہ عربی متون کی لائبریری ہے۔ اردو یا انگریزی کے لیے ملی ہوئی عبارت پر ایزی ایڈیٹر کے ترجمہ اور تحقیق کے فیچرز استعمال کریں۔",
      ar: "الشاملة مكتبة نصوص عربية. وللأردية أو الإنجليزية استخدم ميزات الترجمة والبحث في إيزي إيديتور على النص الذي وجدته.",
    },
  },
  {
    q: {
      en: "Can Easy Editor search my local Shamela?",
      ur: "کیا ایزی ایڈیٹر میری مقامی شاملہ میں تلاش کر سکتا ہے؟",
      ar: "هل يبحث إيزي إيديتور في شاملتي المحلية؟",
    },
    a: {
      en: "The desktop app can read a local Maktaba Shamila 4 installation and import selected books. The web app cannot.",
      ur: "ڈیسک ٹاپ ایپ مقامی مکتبہ شاملہ 4 انسٹالیشن پڑھ کر منتخب کتب درآمد کر سکتی ہے۔ ویب ایپ نہیں کر سکتی۔",
      ar: "يستطيع تطبيق سطح المكتب قراءة تثبيت المكتبة الشاملة 4 المحلي واستيراد كتب مختارة، أما تطبيق الويب فلا.",
    },
  },
];

const LINKS = {
  related: { en: "Related: ", ur: "مزید رہنما: ", ar: "مزيد من الأدلة: " } as L10n,
  aiHaram: { en: "Is AI haram in Islam?", ur: "کیا AI حرام ہے؟", ar: "هل الذكاء الاصطناعي حرام؟" } as L10n,
  about: { en: "About", ur: "ہمارے بارے میں", ar: "من نحن" } as L10n,
  pricing: { en: "Pricing", ur: "پرائسنگ", ar: "الأسعار" } as L10n,
  faq: { en: "Frequently asked questions", ur: "عام سوالات", ar: "أسئلة شائعة" } as L10n,
  officialSite: { en: "Shamela official site", ur: "شاملہ کی سرکاری سائٹ", ar: "موقع الشاملة الرسمي" } as L10n,
  officialAi: { en: "Shamela AI search", ur: "شاملہ AI سرچ", ar: "بحث الشاملة بالذكاء الاصطناعي" } as L10n,
  cta: { en: "Create an account", ur: "اکاؤنٹ بنائیں", ar: "أنشئ حسابًا" } as L10n,
};

export default function MaktabaShamilaGuide() {
  const { language, direction } = useLanguage();
  const lang = language as Lang;
  const prefix = lang === "en" ? "" : `/${lang}`;

  const title = SHAMELA_GUIDE_SEO.title[lang];
  const description = SHAMELA_GUIDE_SEO.description[lang];

  useSeo({ title: `${title} — Al-Ulama Easy Editor`, description, path: "/guides/maktaba-shamila-tutorial" });

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: title,
        description,
        inLanguage: lang,
        author: { "@type": "Organization", name: "Al-Ulama" },
        publisher: { "@type": "Organization", name: "Al-Ulama Easy Editor" },
        datePublished: "2026-07-02",
        dateModified: DATE_MODIFIED,
      },
      {
        "@type": "FAQPage",
        inLanguage: lang,
        mainEntity: FAQ.map((item) => ({
          "@type": "Question",
          name: item.q[lang],
          acceptedAnswer: { "@type": "Answer", text: item.a[lang] },
        })),
      },
    ],
  };

  return (
    <PublicLayout>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <article dir={direction} className="mx-auto max-w-3xl px-4 py-12 prose prose-neutral dark:prose-invert prose-headings:scroll-mt-20 prose-h2:mt-10 prose-h2:text-2xl prose-h3:text-xl prose-a:text-primary">
        <h1>{title}</h1>
        <p>{INTRO[lang]}</p>
        <p>
          <a href={SHAMELA} rel="noopener noreferrer" target="_blank">{LINKS.officialSite[lang]}</a>
          {" · "}
          <a href={SHAMELA_AI} rel="noopener noreferrer" target="_blank">{LINKS.officialAi[lang]}</a>
        </p>

        {SECTIONS.map((section) => {
          const List = section.ordered ? "ol" : "ul";
          return (
            <section key={section.h.en}>
              <h2>{section.h[lang]}</h2>
              {section.p?.map((p) => <p key={p.en}>{p[lang]}</p>)}
              {section.items && (
                <List>
                  {section.items.map((item) => <li key={item.en}>{item[lang]}</li>)}
                </List>
              )}
            </section>
          );
        })}

        <h2>{LINKS.faq[lang]}</h2>
        {FAQ.map((item) => (
          <div key={item.q.en}>
            <h3>{item.q[lang]}</h3>
            <p>{item.a[lang]}</p>
          </div>
        ))}

        <p className="mt-8">
          <Link to="/signup">{LINKS.cta[lang]}</Link>
          {" · "}
          <Link to={`${prefix}/pricing-info`}>{LINKS.pricing[lang]}</Link>
        </p>

        <hr className="my-10" />
        <p className="text-sm text-muted-foreground">
          {LINKS.related[lang]}
          <Link to={`${prefix}/faq/is-ai-haram-in-islam`}>{LINKS.aiHaram[lang]}</Link>
          {" · "}
          <Link to={`${prefix}/about`}>{LINKS.about[lang]}</Link>
        </p>
      </article>
    </PublicLayout>
  );
}
