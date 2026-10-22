import { Link } from "react-router-dom";
import { useSeo } from "@/hooks/useSeo";
import { useLanguage } from "@/contexts/LanguageContext";
import PublicLayout from "@/components/PublicLayout";
import { ABOUT_SEO } from "@/lib/pageSeo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowRight,
  BookOpen,
  ShieldCheck,
  Languages,
  Sparkles,
  Users,
  Quote,
  Bot,
  Plug,
  Monitor,
} from "lucide-react";

type Lang = "en" | "ur" | "ar";
const pick = <T,>(lang: Lang, en: T, ur: T, ar: T): T =>
  lang === "ar" ? ar : lang === "ur" ? ur : en;

const About = () => {
  const { language, direction } = useLanguage();
  const lang = language as Lang;

  useSeo({ title: ABOUT_SEO.title[lang], description: ABOUT_SEO.description[lang], path: "/about" });

  const pillars = [
    {
      icon: BookOpen,
      title: pick(lang, "Grounded in Quran & Hadith", "قرآن و حدیث پر مبنی", "مبني على القرآن والسنّة"),
      desc: pick(
        lang,
        "Every answer is sourced from authentic Islamic texts with citations.",
        "ہر جواب مستند اسلامی مصادر سے ماخوذ اور حوالہ جات کے ساتھ۔",
        "كل إجابة مستمدّة من نصوص إسلامية موثوقة مع المراجع الكاملة.",
      ),
    },
    {
      icon: ShieldCheck,
      title: pick(lang, "Built with scholars in mind", "علماء کی نگرانی", "بُني بمنهجية أهل العلم"),
      desc: pick(
        lang,
        "Designed around the methodology of the ulama — careful, honest, source-first.",
        "اہل علم کے اصولوں کے مطابق ڈیزائن کیا گیا، احتیاط اور دیانت کے ساتھ۔",
        "صُمّم وفق منهج العلماء: دقّة وأمانة وتقديم للمصادر.",
      ),
    },
    {
      icon: Languages,
      title: pick(lang, "Urdu, Arabic & English", "اردو، عربی، انگریزی", "العربية والأردية والإنجليزية"),
      desc: pick(
        lang,
        "Research, translation, transcription and OCR across all three languages.",
        "تینوں زبانوں میں ریسرچ، ترجمہ، ٹرانسکرپشن اور OCR۔",
        "بحث وترجمة وتفريغ صوتي وتعرّف ضوئي على النصوص باللغات الثلاث.",
      ),
    },
    {
      icon: Sparkles,
      title: pick(lang, "Modern AI tools", "جدید AI ٹولز", "أدوات ذكاء اصطناعي حديثة"),
      desc: pick(
        lang,
        "Text-to-speech, speech-to-text, image-to-text and a smart Islamic editor.",
        "ٹیکسٹ ٹو اسپیچ، اسپیچ ٹو ٹیکسٹ، تصاویر سے متن، اور سمارٹ ایڈیٹر۔",
        "تحويل النص إلى كلام، وتحويل الكلام إلى نص، واستخراج النصوص من الصور، ومحرّر إسلامي ذكي.",
      ),
    },
    {
      icon: Bot,
      title: pick(lang, "An agent with scholarly playbooks", "علمی پلے بُکس والا ایجنٹ", "وكيل بخطط عمل علمية"),
      desc: pick(
        lang,
        "25 playbooks — fatwa drafting, takhrij, zakat and faraid, thesis formatting — and it asks before changing your documents.",
        "25 پلے بُکس — فتویٰ مسودہ، تخریج، زکوٰۃ و فرائض، تھیسس فارمیٹنگ — اور دستاویز بدلنے سے پہلے آپ سے پوچھتا ہے۔",
        "25 خطة عمل — صياغة الفتوى والتخريج والزكاة والفرائض وتنسيق الرسائل — ويستأذنك قبل تعديل مستنداتك.",
      ),
    },
    {
      icon: Plug,
      title: pick(lang, "Connected to classical sources", "کلاسیکی ماخذ سے مربوط", "موصول بالمصادر الكلاسيكية"),
      desc: pick(
        lang,
        "Maktaba Shamela, Turath, tafsir, hadith and rijal sources, lexicons and poetry through one connectors hub.",
        "مکتبہ شاملہ، تراث، تفاسیر، حدیث و رجال، لغات اور شاعری ایک کنکٹرز ہب کے ذریعے۔",
        "المكتبة الشاملة وتراث والتفاسير ومصادر الحديث والرجال والمعاجم والشعر عبر مركز موصّلات واحد.",
      ),
    },
    {
      icon: Monitor,
      title: pick(lang, "Privacy-first desktop app", "پرائیویسی فرسٹ ڈیسک ٹاپ ایپ", "تطبيق مكتبي يحترم الخصوصية"),
      desc: pick(
        lang,
        "Local storage and offline search, your own AI key in the OS keychain, and open source under AGPL-3.0.",
        "مقامی اسٹوریج اور آف لائن سرچ، OS کی چین میں آپ کی اپنی AI کلید، اور AGPL-3.0 کے تحت اوپن سورس۔",
        "تخزين محلي وبحث دون اتصال ومفتاح ذكاء اصطناعي خاص بك في سلسلة مفاتيح النظام، ومفتوح المصدر برخصة AGPL-3.0.",
      ),
    },
  ];

  return (
    <PublicLayout>
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/15 via-background to-primary/5">
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, hsl(var(--primary) / 0.25) 0, transparent 40%), radial-gradient(circle at 80% 80%, hsl(var(--primary) / 0.2) 0, transparent 40%)",
          }}
        />
        <div className="relative page-container py-16 md:py-24 text-center" dir={direction}>
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Users className="h-3.5 w-3.5" />
            {pick(lang, "About us", "ہمارا تعارف", "من نحن")}
          </div>
          <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-5xl">
            {pick(
              lang,
              "A Muslim AI Assistant for Scholars & Students",
              "علماء و طلبہ کے لیے Muslim AI اسسٹنٹ",
              "مساعد ذكاء اصطناعي إسلامي للعلماء وطلبة العلم",
            )}
          </h1>
          <p className="mt-5 text-lg text-muted-foreground md:text-xl">
            {pick(
              lang,
              "Al-Ulama Easy Editor is an Islamic AI assistant that helps scholars and students search, understand and produce work grounded in Quran, Hadith and the classical Islamic tradition.",
              "العلماء ایزی ایڈیٹر ایک اسلامی AI اسسٹنٹ ہے جو قرآن، حدیث اور کلاسیکی اسلامی مصادر کو سرچ اور سمجھنے میں آپ کی معاونت کرتا ہے۔",
              "Al-Ulama Easy Editor مساعد ذكاء اصطناعي إسلامي يُعين العلماء وطلبة العلم على البحث والفهم وإنتاج عمل علمي مؤصَّل في القرآن والسنّة والتراث الإسلامي الكلاسيكي.",
            )}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="h-12 gap-2 px-6 text-base"><Link to="/signup">
                {pick(lang, "Create account", "اکاؤنٹ بنائیں", "إنشاء حساب")}
                <ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </Link></Button>
            <Button asChild variant="outline" size="lg" className="h-12 px-6 text-base"><Link to="/login">
                {pick(lang, "Sign in for research", "ریسرچ کے لیے لاگ ان کریں", "سجّل الدخول للبحث")}
              </Link></Button>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            {pick(
              lang,
              "Research opens in the signed-in workspace; OCR and Speak also require an account. New accounts require administrator approval before tools become available.",
              "ریسرچ لاگ ان کے بعد ورک اسپیس میں کھلتی ہے؛ OCR اور Speak کے لیے بھی اکاؤنٹ ضروری ہے۔ نئے اکاؤنٹس کو ٹولز استعمال کرنے سے پہلے منتظم کی منظوری درکار ہوتی ہے۔",
              "يفتح البحث في مساحة العمل بعد تسجيل الدخول؛ وتتطلّب أداتا OCR وSpeak حسابًا أيضًا. تحتاج الحسابات الجديدة إلى موافقة المسؤول قبل إتاحة الأدوات.",
            )}
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 md:py-20" dir={direction}>
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            {pick(lang, "What we stand for", "ہمارے اصول", "ما الذي نمثّله")}
          </h2>
          <p className="mt-3 text-muted-foreground md:text-lg">
            {pick(
              lang,
              "We treat technology as a servant of Islamic knowledge — never as a replacement for the ulama.",
              "ہم ٹیکنالوجی کو اسلامی علم کے خادم کے طور پر استعمال کرتے ہیں — متبادل کے طور پر نہیں۔",
              "نتعامل مع التقنية بوصفها خادمةً للعلم الشرعي، لا بديلًا عن العلماء.",
            )}
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {pillars.map(({ icon: Icon, title, desc }) => (
            <Card key={title} className="border-border/60 transition-shadow hover:shadow-lg">
              <CardContent className="p-6">
                <div className="mb-4 inline-flex rounded-xl bg-primary/10 p-3 text-primary">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="mb-2 text-lg font-semibold">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="bg-primary/5 py-16" dir={direction}>
        <div className="page-container text-center">
          <Quote className="mx-auto h-8 w-8 text-primary/70" />
          <p className="mt-4 text-xl font-medium leading-relaxed md:text-2xl">
            {pick(
              lang,
              "Our goal is to give every student of knowledge easy, sourced access to the Quran and the Sunnah.",
              "ہمارا مقصد یہ ہے کہ ہر طالبِ علم کو قرآن و سنت تک سہل اور مستند رسائی ملے۔",
              "هدفنا أن نُتيح لكل طالب علم وصولًا ميسّرًا ومؤصَّلًا إلى القرآن والسنّة.",
            )}
          </p>
        </div>
      </section>

      <section className="border-t border-border/60 py-16" dir={direction}>
        <div className="page-container text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            {pick(lang, "Get started today", "ابھی شروع کریں", "ابدأ اليوم")}
          </h2>
          <p className="mt-3 text-muted-foreground md:text-lg">
            {pick(
              lang,
              "Create a account and try the Islamic AI assistant for yourself.",
              "اکاؤنٹ بنائیں اور اسلامی AI اسسٹنٹ کا تجربہ کریں۔",
              "أنشئ حسابًا وجرّب المساعد الإسلامي بنفسك.",
            )}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="h-12 gap-2 px-6 text-base"><Link to="/signup">
                {pick(lang, "Create account", "اکاؤنٹ بنائیں", "إنشاء حساب")}
                <ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </Link></Button>
            <Button asChild variant="outline" size="lg" className="h-12 px-6 text-base"><Link to="/faq/is-ai-haram-in-islam">
                {pick(lang, "Is AI haram in Islam?", "کیا AI حرام ہے؟", "هل الذكاء الاصطناعي حرام؟")}
              </Link></Button>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
};

export default About;
