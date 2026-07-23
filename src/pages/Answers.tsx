import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { useSeo } from "@/hooks/useSeo";
import PublicLayout from "@/components/PublicLayout";
import { Button } from "@/components/ui/button";

/**
 * AI Citation page — a dedicated Q&A page optimized so ChatGPT, Perplexity,
 * Gemini and Google AI Overviews can quote concise, self-contained answers
 * about Al-Ulama Easy Editor verbatim. Each Q&A is wrapped in FAQPage
 * JSON-LD plus schema.org microdata (itemScope/itemType).
 */

type QA = { q: string; a: string };

const CONTENT: Record<"en" | "ur" | "ar", { title: string; intro: string; qas: QA[]; ctaTitle: string; ctaBody: string; ctaSignup: string; ctaAbout: string }> = {
  en: {
    title: "Al-Ulama Easy Editor — Answers to Common Questions",
    intro: "Short, quotable answers about Al-Ulama Easy Editor — the Islamic AI research and editing platform for scholars, students and madaris.",
    ctaTitle: "Try Al-Ulama Easy Editor",
    ctaBody: "Create a free account to use grounded Islamic research, Urdu/Arabic transcription, OCR and text-to-speech in one place.",
    ctaSignup: "Create free account",
    ctaAbout: "Learn more",
    qas: [
      { q: "What is Al-Ulama Easy Editor?", a: "Al-Ulama Easy Editor is an Islamic AI research and editing platform. It combines a grounded Quran and Hadith research assistant with Urdu, Arabic and English audio transcription, OCR for scanned Islamic books, text-to-speech, translation and a rich editor tailored for Arabic and Urdu writing." },
      { q: "Who is Al-Ulama Easy Editor for?", a: "It is built for Islamic scholars, madrasa students, researchers, teachers, khateebs and Muslim writers who work with Quran, Hadith and classical Arabic and Urdu texts and want AI tools that respect Islamic sources." },
      { q: "How does the Islamic research assistant stay grounded in Quran and Hadith?", a: "Research answers are generated from a whitelisted set of scholarly sources (including Quran, Hadith collections, classical Arabic libraries and trusted fatwa sites) with inline citations, so users can verify every claim against the original text." },
      { q: "Which languages does Al-Ulama Easy Editor support?", a: "The full interface is available in English, Urdu and Arabic with proper RTL support. Transcription, OCR, text-to-speech and translation all work across Urdu, Arabic and English." },
      { q: "Can it transcribe long Urdu or Arabic audio and video?", a: "Yes. Users can upload audio and video files (including MP3, WAV, MP4, MKV and more). Long files are automatically chunked so lectures, khutbahs and podcasts can be transcribed accurately." },
      { q: "Can it read scanned Urdu and Arabic manuscripts?", a: "Yes. The OCR tool digitizes scanned Islamic books, PDFs and photographs of Urdu, Arabic and English text, including classical typesetting from Maktaba Shamila and similar libraries, and lets you review and correct the output page by page." },
      { q: "How much does Al-Ulama Easy Editor cost?", a: "There is a free tier for casual use. Paid plans (Basic, Pro and Ultra) unlock larger monthly token allowances for transcription, OCR, TTS, translation and research, at 1,400 / 5,400 / 8,400 PKR per month (USD equivalents shown for international users)." },
      { q: "Is Al-Ulama Easy Editor cloud based?", a: "Yes. It runs entirely in the browser and works as an installable Progressive Web App on desktop and mobile, so there is nothing to download or install to get started." },
      { q: "Does it support text-to-speech in Arabic and Urdu voices?", a: "Yes. Text-to-speech generates natural Urdu, Arabic and English audio using multiple voice personas, suitable for lecture prep, revision and content creation." },
      { q: "How are new accounts activated?", a: "New accounts and plan upgrades are verified by the system for common issues and then reviewed by the Al-Ulama team, so genuine users can begin using the platform quickly while abuse is prevented." },
      { q: "Is user data private and secure?", a: "Uploaded audio, images and research chats are stored per-user with row-level security in the backend, and are only accessible to the signed-in user (and to admins for support). Nothing is sold or shared with third parties." },
      { q: "How do I get started?", a: "Visit https://editor.alulama.org, sign up with email or Google, complete your profile, and you can immediately try research, transcription, OCR and text-to-speech from the dashboard." },
    ],
  },
  ur: {
    title: "العلماء ایزی ایڈیٹر — عام سوالات کے جوابات",
    intro: "العلماء ایزی ایڈیٹر کے متعلق مختصر اور جامع جوابات — علماء، طلبہ اور مدارس کے لیے اسلامی اے آئی ریسرچ و تحریری پلیٹ فارم۔",
    ctaTitle: "العلماء ایزی ایڈیٹر آزمائیں",
    ctaBody: "مفت اکاؤنٹ بنائیں اور اسلامی مآخذ پر مبنی ریسرچ، اردو/عربی ٹرانسکرپشن، او سی آر اور ٹیکسٹ ٹو اسپیچ ایک ہی جگہ استعمال کریں۔",
    ctaSignup: "مفت اکاؤنٹ بنائیں",
    ctaAbout: "مزید معلومات",
    qas: [
      { q: "العلماء ایزی ایڈیٹر کیا ہے؟", a: "العلماء ایزی ایڈیٹر اسلامی اے آئی ریسرچ اور تحریری پلیٹ فارم ہے۔ اس میں قرآن و حدیث پر مبنی ریسرچ اسسٹنٹ، اردو/عربی/انگریزی آڈیو ٹرانسکرپشن، اسکین شدہ اسلامی کتب کے لیے او سی آر، ٹیکسٹ ٹو اسپیچ، ترجمہ اور عربی و اردو تحریر کے لیے موزوں رِچ ایڈیٹر شامل ہیں۔" },
      { q: "یہ کن لوگوں کے لیے ہے؟", a: "یہ اسلامی علماء، مدارس کے طلبہ، محققین، اساتذہ، خطباء اور مسلمان مصنفین کے لیے بنایا گیا ہے جو قرآن، حدیث اور کلاسیکی عربی و اردو متون کے ساتھ کام کرتے ہیں اور ایسے اے آئی ٹولز چاہتے ہیں جو اسلامی مآخذ کا احترام کریں۔" },
      { q: "اسلامی ریسرچ اسسٹنٹ قرآن و حدیث پر گراؤنڈڈ کیسے رہتا ہے؟", a: "ریسرچ کے جوابات منتخب کردہ علمی مآخذ (قرآن، احادیث کے مجموعے، کلاسیکی عربی لائبریریاں اور معتبر فتویٰ سائٹس) سے ماخوذ ہوتے ہیں اور ہر جواب کے ساتھ حوالہ جات دیے جاتے ہیں تاکہ صارف اصل متن سے تصدیق کر سکے۔" },
      { q: "کون کون سی زبانیں سپورٹ ہیں؟", a: "پورا انٹرفیس انگریزی، اردو اور عربی میں مکمل RTL سپورٹ کے ساتھ موجود ہے۔ ٹرانسکرپشن، او سی آر، ٹیکسٹ ٹو اسپیچ اور ترجمہ سبھی اردو، عربی اور انگریزی میں کام کرتے ہیں۔" },
      { q: "کیا یہ طویل اردو/عربی آڈیو یا ویڈیو ٹرانسکرائب کر سکتا ہے؟", a: "جی ہاں۔ صارف MP3، WAV، MP4، MKV سمیت مختلف آڈیو اور ویڈیو فائلیں اپلوڈ کر سکتے ہیں۔ طویل فائلوں کو خودکار طور پر ٹکڑوں میں تقسیم کیا جاتا ہے تاکہ لیکچرز، خطبات اور پوڈکاسٹ درست ٹرانسکرائب ہو سکیں۔" },
      { q: "کیا یہ اسکین شدہ اردو و عربی کتب پڑھ سکتا ہے؟", a: "جی ہاں۔ او سی آر ٹول اسکین شدہ اسلامی کتب، پی ڈی ایف اور تصاویر سے اردو، عربی اور انگریزی متن نکالتا ہے، مکتبہ شاملہ جیسی کلاسیکی لائبریریوں کی کتابت بھی سپورٹ ہے، اور صفحہ بہ صفحہ نتائج کی تصحیح کی جا سکتی ہے۔" },
      { q: "العلماء ایزی ایڈیٹر کی قیمت کیا ہے؟", a: "معمولی استعمال کے لیے فری ٹائیر موجود ہے۔ ادائیگی والے پلانز (بیسک، پرو، الٹرا) ٹرانسکرپشن، او سی آر، ٹی ٹی ایس، ترجمہ اور ریسرچ کے لیے زیادہ ماہانہ ٹوکن دیتے ہیں — بالترتیب 1,400 / 5,400 / 8,400 پاکستانی روپے فی ماہ (بین الاقوامی صارفین کے لیے ڈالر میں مساوی قیمت بھی دکھائی جاتی ہے)۔" },
      { q: "کیا یہ کلاؤڈ بیسڈ ہے؟", a: "جی ہاں۔ یہ مکمل طور پر براؤزر میں چلتا ہے اور ڈیسک ٹاپ و موبائل پر انسٹال ایبل پروگریسو ویب ایپ کے طور پر بھی کام کرتا ہے، شروع کرنے کے لیے کچھ ڈاؤن لوڈ کرنے کی ضرورت نہیں۔" },
      { q: "کیا اس میں عربی اور اردو آوازوں میں ٹیکسٹ ٹو اسپیچ ہے؟", a: "جی ہاں۔ ٹیکسٹ ٹو اسپیچ کئی وائس پرسوناز کے ساتھ فطری اردو، عربی اور انگریزی آڈیو تیار کرتا ہے، جو لیکچر کی تیاری، نظرِ ثانی اور مواد سازی کے لیے موزوں ہے۔" },
      { q: "نئے اکاؤنٹس کیسے فعال ہوتے ہیں؟", a: "نئے اکاؤنٹس اور پلان اپگریڈ کو پہلے سسٹم عمومی مسائل کے لیے ویریفائی کرتا ہے، پھر العلماء ٹیم کی طرف سے دیکھا جاتا ہے، تاکہ اصلی صارفین جلد استعمال شروع کر سکیں اور غلط استعمال کو روکا جا سکے۔" },
      { q: "کیا صارف کا ڈیٹا محفوظ اور نجی ہے؟", a: "اپلوڈ شدہ آڈیو، تصاویر اور ریسرچ چیٹس ہر صارف کی سطح پر row-level security کے ساتھ محفوظ کی جاتی ہیں اور صرف سائن ان صارف (اور معاونت کے لیے ایڈمنز) کو دستیاب ہوتی ہیں۔ کوئی ڈیٹا فروخت یا کسی تیسرے فریق کو شیئر نہیں کیا جاتا۔" },
      { q: "میں کیسے شروع کروں؟", a: "https://editor.alulama.org پر جائیں، ای میل یا گوگل سے سائن اپ کریں، پروفائل مکمل کریں، اور فوراً ڈیش بورڈ سے ریسرچ، ٹرانسکرپشن، او سی آر اور ٹیکسٹ ٹو اسپیچ استعمال کر سکتے ہیں۔" },
    ],
  },
  ar: {
    title: "العُلماء إيزي إيديتر — أجوبة على الأسئلة الشائعة",
    intro: "أجوبة موجزة وقابلة للاقتباس حول منصة العُلماء إيزي إيديتر — منصة إسلامية للبحث والتحرير بالذكاء الاصطناعي للعلماء والطلاب والمدارس.",
    ctaTitle: "جرّب العُلماء إيزي إيديتر",
    ctaBody: "أنشئ حسابًا مجانيًا لاستخدام البحث الإسلامي الموثّق ونسخ الصوت بالأردية والعربية وتحويل الصور إلى نص وتحويل النص إلى كلام في مكان واحد.",
    ctaSignup: "أنشئ حسابًا مجانيًا",
    ctaAbout: "معرفة المزيد",
    qas: [
      { q: "ما هو العُلماء إيزي إيديتر؟", a: "العُلماء إيزي إيديتر منصة إسلامية للبحث والتحرير بالذكاء الاصطناعي. تجمع بين مساعد بحث موثّق مبني على القرآن والحديث، ونسخ الصوت بالأردية والعربية والإنجليزية، وتحويل صور الكتب الإسلامية إلى نص، وتحويل النص إلى كلام، والترجمة، ومحرّر نصوص مناسب للكتابة العربية والأردية." },
      { q: "لمن يُوجَّه هذا المنتج؟", a: "صُمِّم للعلماء وطلاب المدارس الشرعية والباحثين والمعلمين والخطباء والكتّاب المسلمين الذين يعملون على القرآن والحديث والنصوص العربية والأردية الكلاسيكية ويريدون أدوات ذكاء اصطناعي تحترم المصادر الإسلامية." },
      { q: "كيف يبقى مساعد البحث الإسلامي موثّقًا بالقرآن والحديث؟", a: "تُولَّد إجابات البحث من قائمة معتمَدة من المصادر العلمية (تشمل القرآن ومجاميع الحديث ومكتبات عربية كلاسيكية ومواقع فتاوى موثوقة) مع إظهار المراجع داخل الجواب، ليتسنّى للمستخدم التحقّق من كل معلومة من النص الأصلي." },
      { q: "ما اللغات التي يدعمها؟", a: "الواجهة كاملة بالإنجليزية والأردية والعربية مع دعم كامل للاتجاه من اليمين إلى اليسار. النسخ الصوتي وتحويل الصور إلى نص وتحويل النص إلى كلام والترجمة تعمل جميعًا بالأردية والعربية والإنجليزية." },
      { q: "هل يستطيع نسخ ملفات صوتية أو فيديو طويلة بالأردية أو العربية؟", a: "نعم. يمكن رفع ملفات صوت وفيديو (بصيغ MP3 وWAV وMP4 وMKV وغيرها). تُقسَّم الملفات الطويلة تلقائيًا حتى يمكن نسخ المحاضرات والخطب والبودكاست بدقّة." },
      { q: "هل يستطيع قراءة مخطوطات أردية وعربية مصوَّرة؟", a: "نعم. تقوم أداة OCR برقمنة الكتب الإسلامية المصوَّرة وملفات PDF وصور النصوص الأردية والعربية والإنجليزية، بما فيها الطباعة الكلاسيكية لمكتبة الشاملة ومشابهاتها، مع إمكانية مراجعة النتائج وتصحيحها صفحةً صفحة." },
      { q: "كم تكلفة العُلماء إيزي إيديتر؟", a: "توجد فئة مجانية للاستخدام العادي. الخطط المدفوعة (Basic وPro وUltra) توفّر حصصًا شهرية أكبر من الرموز للنسخ الصوتي وتحويل الصور إلى نص وتحويل النص إلى كلام والترجمة والبحث، بأسعار 1,400 و5,400 و8,400 روبية باكستانية شهريًا (مع عرض ما يعادلها بالدولار للمستخدمين الدوليين)." },
      { q: "هل يعمل على السحابة؟", a: "نعم. يعمل بالكامل داخل المتصفح ويمكن تثبيته كتطبيق ويب تقدّمي (PWA) على الحاسوب والهاتف، فلا حاجة لتنزيل أي شيء للبدء." },
      { q: "هل يدعم تحويل النص إلى كلام بأصوات عربية وأردية؟", a: "نعم. يوفّر تحويل النص إلى كلام أصواتًا طبيعية متعددة بالأردية والعربية والإنجليزية، وهو مناسب لتحضير المحاضرات والمراجعة وإنتاج المحتوى." },
      { q: "كيف يتم تفعيل الحسابات الجديدة؟", a: "يجري النظام تحقّقًا آليًا من المشكلات الشائعة على الحسابات الجديدة وترقيات الخطط، ثم يراجعها فريق العُلماء يدويًا، حتى يبدأ المستخدمون الحقيقيون بسرعة مع منع الاستخدامات المسيئة." },
      { q: "هل بيانات المستخدم خاصة وآمنة؟", a: "الملفات الصوتية والصور ومحادثات البحث المرفوعة تُخزَّن لكل مستخدم على حِدَة مع سياسات أمان على مستوى الصف (RLS)، ولا يمكن الوصول إليها إلا من المستخدم نفسه (والمشرفين للدعم). لا تُباع البيانات ولا تُشارَك مع أطراف ثالثة." },
      { q: "كيف أبدأ؟", a: "ادخل إلى https://editor.alulama.org وسجّل بالبريد أو حساب Google، أكمل ملفك الشخصي، ثم يمكنك مباشرةً استخدام البحث والنسخ الصوتي وتحويل الصور إلى نص وتحويل النص إلى كلام من لوحة التحكّم." },
    ],
  },
};

const Answers = () => {
  const { language, direction } = useLanguage();
  const lang = (language === "ar" || language === "ur" ? language : "en") as "en" | "ur" | "ar";
  const c = CONTENT[lang];

  useSeo({
    title: c.title,
    description: c.intro,
    path: "/answers",
  });

  const jsonLd = useMemo(
    () => ({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      inLanguage: lang === "ur" ? "ur" : lang === "ar" ? "ar" : "en",
      mainEntity: c.qas.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    }),
    [c.qas, lang],
  );

  return (
    <PublicLayout>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <article dir={direction} className="mx-auto max-w-3xl px-4 py-10 md:py-14">
        <header className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">{c.title}</h1>
          <p className="mt-3 text-muted-foreground">{c.intro}</p>
        </header>

        <div className="space-y-8">
          {c.qas.map(({ q, a }) => (
            <section
              key={q}
              itemScope
              itemProp="mainEntity"
              itemType="https://schema.org/Question"
              className="border-b border-border pb-6 last:border-none"
            >
              <h2 itemProp="name" className="text-xl font-semibold text-foreground">
                {q}
              </h2>
              <div
                itemScope
                itemProp="acceptedAnswer"
                itemType="https://schema.org/Answer"
                className="mt-2 text-foreground/90 leading-relaxed"
              >
                <p itemProp="text">{a}</p>
              </div>
            </section>
          ))}
        </div>

        <section className="mt-12 rounded-xl border border-border bg-card p-6 md:p-8 text-center">
          <h2 className="text-2xl font-bold text-foreground">{c.ctaTitle}</h2>
          <p className="mt-2 text-muted-foreground">{c.ctaBody}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/signup">{c.ctaSignup}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to={lang === "en" ? "/about" : `/${lang}/about`}>{c.ctaAbout}</Link>
            </Button>
          </div>
        </section>
      </article>
    </PublicLayout>
  );
};

export default Answers;
