import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useSeo } from "@/hooks/useSeo";
import { useLanguage } from "@/contexts/LanguageContext";
import PublicLayout from "@/components/PublicLayout";
import { Button } from "@/components/ui/button";
import { ArrowRight, BookOpen } from "lucide-react";

const SITE_ORIGIN = "https://editor.alulama.org";
const PATH = "/faq/is-ai-haram-in-islam";

interface QA { q: string; a: string }
type Lang = "en" | "ur" | "ar";

const FaqAiHaram = () => {
  const { language, direction } = useLanguage();
  const lang = language as Lang;

  useSeo({
    title:
      lang === "ar"
        ? "هل الذكاء الاصطناعي حرام في الإسلام؟ — إجابة مراجعة شرعيًا"
        : lang === "ur"
        ? "کیا AI اسلام میں حرام ہے؟ — علماء کا جائزہ شدہ جواب"
        : "Is AI Haram in Islam? A Scholar-Reviewed Answer",
    description:
      lang === "ar"
        ? "هل الذكاء الاصطناعي حرام في الإسلام؟ إجابة مراجعة شرعيًا تستعرض الحكم الشرعي للذكاء الاصطناعي والاستخدامات الجائزة والمحاذير على المسلم."
        : lang === "ur"
        ? "کیا AI اسلام میں حرام ہے؟ شریعت کی روشنی میں مصنوعی ذکاء کا حکم، جائز استعمال اور احتیاطات کا علماء کا جائزہ شدہ جواب۔"
        : "Is AI haram in Islam? A scholar-reviewed answer covering the Shariah ruling on artificial intelligence, permissible uses, and cautions for Muslims.",
    path: PATH,
  });

  // Rebuilt on every render, this fed the JSON-LD effect's dependency list —
  // so the structured-data <script> was torn out of <head> and re-injected
  // each time the page rendered. It only ever depends on the language.
  const qas: QA[] = useMemo(() =>
    lang === "ar"
      ? [
          {
            q: "هل الذكاء الاصطناعي (AI) في حدّ ذاته حرام؟",
            a: "الذكاء الاصطناعي أداة كالقلم والكتاب والحاسوب، وليس حرامًا في ذاته. والحكم الشرعي يتعلّق بطريقة الاستخدام؛ فإذا استُخدم في مقاصد مشروعة كالعلم والتعليم والبحث وخدمة القرآن والسنّة فهو جائز.",
          },
          {
            q: "متى يصبح استخدام الذكاء الاصطناعي حرامًا أو مكروهًا؟",
            a: "إذا استُخدم في الكذب والغشّ والفجور وتعظيم صور ذوات الأرواح، أو في سرقة المحتوى، أو في أيّ عمل أصله محرّم شرعًا، فإن هذا الاستخدام محرّم.",
          },
          {
            q: "هل يجوز أخذ الفتوى مباشرةً من الذكاء الاصطناعي؟",
            a: "لا. لا يجوز أخذ الفتوى مباشرةً من أيّ نموذج ذكاء اصطناعي. وإنّما هو وسيلة بحث وتقصٍّ ابتدائي؛ والحكم الشرعي النهائي يُرجع فيه إلى العلماء المعتبرين.",
          },
          {
            q: "كيف يتعامل Al-Ulama Easy Editor مع هذا الأمر؟",
            a: "مساعدنا الإسلامي مجرّد مُعين، يُقدّم مراجع من القرآن والحديث والمصادر الكلاسيكية ولا يُفتي. كل إجابة مشفوعة بمصادرها ليتمكّن المستخدم من التحقّق منها مع أهل العلم.",
          },
        ]
      : lang === "ur"
      ? [
          {
            q: "کیا AI (مصنوعی ذکاء) بذاتِ خود حرام ہے؟",
            a: "AI ایک ٹول ہے، جیسے قلم، کتاب یا کمپیوٹر۔ بذاتِ خود حرام نہیں۔ شرعی حکم اس کے استعمال پر منحصر ہے: اگر اسے جائز مقاصد جیسے علم، تعلیم، ریسرچ یا قرآن و حدیث کی خدمت کے لیے استعمال کیا جائے تو جائز ہے۔",
          },
          {
            q: "کن صورتوں میں AI کا استعمال حرام یا ناپسندیدہ ہوگا؟",
            a: "جب AI کو جھوٹ، دھوکہ، فحاشی، تصاویرِ ذی روح کی تخلیق برائے تعظیم، چوری شدہ مواد، یا ایسے کام کے لیے استعمال کیا جائے جس کا اصل عمل شریعت میں حرام ہے، تو وہی استعمال حرام ہوگا۔",
          },
          {
            q: "کیا AI سے فتویٰ لینا جائز ہے؟",
            a: "نہیں۔ فتویٰ کسی بھی AI ماڈل سے براہِ راست نہیں لیا جا سکتا۔ AI صرف ایک ابتدائی ریسرچ اور تلاش کا ذریعہ ہے۔ آخری شرعی فیصلہ مستند علماء سے ہی لیا جائے۔",
          },
          {
            q: "العلماء ایزی ایڈیٹر کس طرح اس مسئلے کا خیال رکھتا ہے؟",
            a: "ہمارا اسلامی AI اسسٹنٹ صرف معاون (assistant) ہے۔ یہ قرآن، حدیث اور کلاسیکی مصادر سے حوالہ جات پیش کرتا ہے، فتویٰ نہیں دیتا۔ ہر جواب کے ساتھ ماخذ موجود ہوتا ہے تاکہ صارف اہلِ علم سے توثیق کر سکے۔",
          },
        ]
      : [
          {
            q: "Is AI itself haram in Islam?",
            a: "AI is a tool, like a pen, a book or a computer. It is not haram in itself. The Shariah ruling depends on how it is used: when used for permissible purposes such as learning, teaching, research or serving the Quran and Sunnah, its use is permissible.",
          },
          {
            q: "When does AI use become haram or disliked?",
            a: "When AI is used for lying, deception, generating inappropriate or immoral content, creating images of living beings for veneration, plagiarism, or any task whose underlying act is itself haram, that use is impermissible.",
          },
          {
            q: "Is it allowed to take a fatwa directly from an AI?",
            a: "No. A fatwa cannot be taken directly from any AI model. AI is only a research and lookup aid. Final Shariah rulings must be taken from qualified scholars (ulama).",
          },
          {
            q: "How does Al-Ulama Easy Editor handle this?",
            a: "Our Islamic AI assistant is only an aid (assistant). It surfaces citations from the Quran, Hadith and classical sources — it does not issue fatwas. Every answer ships with its sources so the user can verify with the ulama.",
          },
        ], [lang]);

  // Inject FAQPage JSON-LD
  useEffect(() => {
    const id = "faq-ai-haram-jsonld";
    document.getElementById(id)?.remove();
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.id = id;
    const localePrefix = lang === "en" ? "" : `/${lang}`;
    script.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      inLanguage: lang,
      url: SITE_ORIGIN + localePrefix + PATH,
      mainEntity: qas.map((qa) => ({
        "@type": "Question",
        name: qa.q,
        acceptedAnswer: { "@type": "Answer", text: qa.a },
      })),
    });
    document.head.appendChild(script);
    return () => { document.getElementById(id)?.remove(); };
  }, [qas, lang]);

  const heading =
    lang === "ar"
      ? "هل الذكاء الاصطناعي حرام في الإسلام؟ — إجابة مراجعة شرعيًا"
      : lang === "ur"
      ? "کیا AI اسلام میں حرام ہے؟ — علماء کا جائزہ شدہ جواب"
      : "Is AI Haram in Islam? A Scholar-Reviewed Answer";
  const badge = lang === "ar" ? "أسئلة إسلامية شائعة" : lang === "ur" ? "اسلامی FAQ" : "Islamic FAQ";

  return (
    <PublicLayout>
      <article className="mx-auto max-w-3xl px-4 py-12 md:py-16" dir={direction}>
        <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          <BookOpen className="h-3.5 w-3.5" />
          {badge}
        </div>
        <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-5xl">{heading}</h1>

        <div className="mt-10 space-y-8">
          {qas.map((qa, i) => (
            <section key={i} className="border-l-2 border-primary/40 ps-5">
              <h2 className="text-xl font-semibold leading-snug md:text-2xl">{qa.q}</h2>
              <p className="mt-3 text-base text-foreground/90 leading-relaxed">{qa.a}</p>
            </section>
          ))}
        </div>

        <div className="mt-12 rounded-2xl border border-border/60 bg-primary/5 p-6 text-center">
          <h3 className="text-xl font-bold">
            {lang === "ar"
              ? "احصل على إجابات من القرآن والحديث مع المراجع"
              : lang === "ur"
              ? "اپنے سوالات کا جواب قرآن و حدیث سے حاصل کریں"
              : "Get answers from Quran & Hadith with citations"}
          </h3>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Link to="/signup">
              <Button size="lg" className="h-11 gap-2 px-5">
                {lang === "ar" ? "إنشاء حساب" : lang === "ur" ? "اکاؤنٹ بنائیں" : "Create account"}
                <ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </Button>
            </Link>
            <Link to="/about">
              <Button variant="outline" size="lg" className="h-11 px-5">
                {lang === "ar"
                  ? "تعرّف على مهمّتنا"
                  : lang === "ur"
                  ? "ہمارے مشن کے بارے میں مزید جانیں"
                  : "Learn more about our mission"}
              </Button>
            </Link>
          </div>
        </div>
      </article>
    </PublicLayout>
  );
};

export default FaqAiHaram;
