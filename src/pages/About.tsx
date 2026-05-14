import { Link } from "react-router-dom";
import { useSeo } from "@/hooks/useSeo";
import { useLanguage } from "@/contexts/LanguageContext";
import PublicLayout from "@/components/PublicLayout";
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
} from "lucide-react";

const About = () => {
  const { language, direction } = useLanguage();
  const isUr = language === "ur";

  useSeo({
    title: "Muslim AI Assistant for Scholars & Students — About",
    description:
      "About Al-Ulama Easy Editor: a Muslim AI assistant for scholars and students grounded in Quran, Hadith and classical Islamic sources. Urdu, Arabic and English.",
    path: "/about",
  });

  const pillars = isUr
    ? [
        { icon: BookOpen, title: "قرآن و حدیث پر مبنی", desc: "ہر جواب مستند اسلامی مصادر سے ماخوذ اور حوالہ جات کے ساتھ۔" },
        { icon: ShieldCheck, title: "علماء کی نگرانی", desc: "اہل علم کے اصولوں کے مطابق ڈیزائن کیا گیا، احتیاط اور دیانت کے ساتھ۔" },
        { icon: Languages, title: "اردو، عربی، انگریزی", desc: "تینوں زبانوں میں ریسرچ، ترجمہ، ٹرانسکرپشن اور OCR۔" },
        { icon: Sparkles, title: "جدید AI ٹولز", desc: "ٹیکسٹ ٹو اسپیچ، اسپیچ ٹو ٹیکسٹ، تصاویر سے متن، اور سمارٹ ایڈیٹر۔" },
      ]
    : [
        { icon: BookOpen, title: "Grounded in Quran & Hadith", desc: "Every answer is sourced from authentic Islamic texts with citations." },
        { icon: ShieldCheck, title: "Built with scholars in mind", desc: "Designed around the methodology of the ulama — careful, honest, source-first." },
        { icon: Languages, title: "Urdu, Arabic & English", desc: "Research, translation, transcription and OCR across all three languages." },
        { icon: Sparkles, title: "Modern AI tools", desc: "Text-to-speech, speech-to-text, image-to-text and a smart Islamic editor." },
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
        <div className="relative mx-auto max-w-4xl px-4 py-16 md:py-24 text-center" dir={direction}>
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Users className="h-3.5 w-3.5" />
            {isUr ? "ہمارا تعارف" : "About us"}
          </div>
          <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-5xl">
            {isUr
              ? "علماء و طلبہ کے لیے Muslim AI اسسٹنٹ"
              : "A Muslim AI Assistant for Scholars & Students"}
          </h1>
          <p className="mt-5 text-lg text-muted-foreground md:text-xl">
            {isUr
              ? "العلماء ایزی ایڈیٹر ایک اسلامی AI اسسٹنٹ ہے جو قرآن، حدیث اور کلاسیکی اسلامی مصادر کو سرچ اور سمجھنے میں آپ کی معاونت کرتا ہے۔"
              : "Al-Ulama Easy Editor is an Islamic AI assistant that helps scholars and students search, understand and produce work grounded in Quran, Hadith and the classical Islamic tradition."}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/signup">
              <Button size="lg" className="h-12 gap-2 px-6 text-base">
                {isUr ? "مفت اکاؤنٹ بنائیں" : "Create free account"}
                <ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </Button>
            </Link>
            <Link to="/research">
              <Button variant="outline" size="lg" className="h-12 px-6 text-base">
                {isUr ? "ریسرچ اسسٹنٹ آزمائیں" : "Try the research assistant"}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 md:py-20" dir={direction}>
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            {isUr ? "ہمارے اصول" : "What we stand for"}
          </h2>
          <p className="mt-3 text-muted-foreground md:text-lg">
            {isUr
              ? "ہم ٹیکنالوجی کو اسلامی علم کے خادم کے طور پر استعمال کرتے ہیں — متبادل کے طور پر نہیں۔"
              : "We treat technology as a servant of Islamic knowledge — never as a replacement for the ulama."}
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
        <div className="mx-auto max-w-3xl px-4 text-center">
          <Quote className="mx-auto h-8 w-8 text-primary/70" />
          <p className="mt-4 text-xl font-medium leading-relaxed md:text-2xl">
            {isUr
              ? "ہمارا مقصد یہ ہے کہ ہر طالبِ علم کو قرآن و سنت تک سہل اور مستند رسائی ملے۔"
              : "Our goal is to give every student of knowledge easy, sourced access to the Quran and the Sunnah."}
          </p>
        </div>
      </section>

      <section className="border-t border-border/60 py-16" dir={direction}>
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            {isUr ? "ابھی شروع کریں" : "Get started today"}
          </h2>
          <p className="mt-3 text-muted-foreground md:text-lg">
            {isUr
              ? "مفت اکاؤنٹ بنائیں اور اسلامی AI اسسٹنٹ کا تجربہ کریں۔"
              : "Create a account and try the Islamic AI assistant for yourself."}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link to="/signup">
              <Button size="lg" className="h-12 gap-2 px-6 text-base">
                {isUr ? "مفت اکاؤنٹ بنائیں" : "Create free account"}
                <ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </Button>
            </Link>
            <Link to="/faq/is-ai-haram-in-islam">
              <Button variant="outline" size="lg" className="h-12 px-6 text-base">
                {isUr ? "کیا AI حرام ہے؟" : "Is AI haram in Islam?"}
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
};

export default About;
