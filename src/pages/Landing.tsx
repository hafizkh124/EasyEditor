import { useEffect } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Mic,
  Volume2,
  ScanText,
  BookOpen,
  Sparkles,
  Globe,
  Check,
  ArrowRight,
  Languages,
  Crown,
  Zap,
  Star,
} from "lucide-react";

const Landing = () => {
  const { user, loading } = useAuth();
  const { t, language, setLanguage, direction } = useLanguage();

  // Dynamic SEO per language
  useEffect(() => {
    const isUr = language === "ur";
    const title = isUr
      ? "العلماء ایزی ایڈیٹر — اسلامی ریسرچ، ٹرانسکرپشن، OCR اور TTS"
      : "Al-Ulama Easy Editor — Islamic Research, Transcription, OCR & TTS";
    const desc = isUr
      ? "العلماء ایزی ایڈیٹر: قرآن و حدیث پر مبنی اسلامی جی پی ٹی، اردو/عربی/انگریزی ٹرانسکرپشن، OCR اور ٹیکسٹ ٹو اسپیچ — علماء و طلبہ کے لیے۔"
      : "Al-Ulama Easy Editor: Islamic GPT grounded in Quran & Hadith, Urdu/Arabic/English transcription, OCR and Text-to-Speech — built for scholars and students.";

    document.title = title;
    document.documentElement.lang = isUr ? "ur" : "en";

    const setMeta = (selector: string, attr: string, value: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(selector);
      if (!el) {
        el = document.createElement("meta");
        const [a, v] = selector.replace(/\[|\]|"/g, "").split("=");
        el.setAttribute(a, v);
        document.head.appendChild(el);
      }
      el.setAttribute(attr, value);
    };

    setMeta('meta[name="description"]', "content", desc);
    setMeta('meta[property="og:title"]', "content", title);
    setMeta('meta[property="og:description"]', "content", desc);
    setMeta('meta[name="twitter:title"]', "content", title);
    setMeta('meta[name="twitter:description"]', "content", desc);

    // Canonical
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = window.location.origin + "/";

    // JSON-LD structured data
    const ldId = "ld-software-app";
    document.getElementById(ldId)?.remove();
    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.id = ldId;
    ld.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Al-Ulama Easy Editor",
      alternateName: "العلماء ایزی ایڈیٹر",
      applicationCategory: "EducationalApplication",
      operatingSystem: "Web",
      description: desc,
      url: window.location.origin + "/",
      inLanguage: ["ur", "en", "ar"],
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    });
    document.head.appendChild(ld);
  }, [language]);

  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;

  const features = [
    { icon: BookOpen, key: "islamic_gpt" },
    { icon: Mic, key: "transcribe" },
    { icon: ScanText, key: "ocr" },
    { icon: Volume2, key: "tts" },
    { icon: Sparkles, key: "ai_refine" },
    { icon: Globe, key: "multilingual" },
  ] as const;

  const plans = [
    {
      key: "basic",
      icon: Zap,
      price: "1,000 PKR",
      iconClass: "text-blue-500",
      bg: "bg-blue-500/10",
    },
    {
      key: "pro",
      icon: Crown,
      price: "4,000 PKR",
      iconClass: "text-primary",
      bg: "bg-primary/15",
      popular: true,
    },
    {
      key: "ultra",
      icon: Star,
      price: "7,000 PKR",
      iconClass: "text-purple-500",
      bg: "bg-purple-500/10",
      comingSoon: true,
    },
  ] as const;

  return (
    <div dir={direction} className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2.5">
            <img
              src="/favicon.webp"
              alt="EasyEditor"
              width={26}
              height={26}
              className="rounded"
            />
            <h1 className="text-lg font-bold tracking-tight text-foreground">EasyEditor</h1>
          </Link>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLanguage(language === "ur" ? "en" : "ur")}
              className="gap-1.5"
            >
              <Languages className="h-4 w-4" />
              {language === "ur" ? "EN" : "اردو"}
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/15 via-background to-primary/5">
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, hsl(var(--primary) / 0.25) 0, transparent 40%), radial-gradient(circle at 80% 80%, hsl(var(--primary) / 0.2) 0, transparent 40%)",
          }}
        />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
          <div className="flex flex-col justify-center space-y-6">
            <Badge className="w-fit gap-1.5 bg-primary/10 text-primary hover:bg-primary/15">
              <Sparkles className="h-3.5 w-3.5" />
              {t("landing.badge")}
            </Badge>
            <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">
              {t("landing.hero_title")}
            </h1>
            <p className="text-lg text-muted-foreground md:text-xl">
              {t("landing.hero_subtitle")}
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link to="/signup">
                <Button size="lg" className="h-12 gap-2 px-6 text-base">
                  {t("landing.cta_signup")}
                  <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                </Button>
              </Link>
              <Link to="/login">
                <Button variant="outline" size="lg" className="h-12 px-6 text-base">
                  {t("auth.login")}
                </Button>
              </Link>
            </div>
            <div className="flex items-center gap-4 pt-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-primary" />
                {t("landing.trust_langs")}
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-primary" />
                {t("landing.trust_quran")}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-center">
            <img
              src="/og-image.webp"
              alt={
                language === "ur"
                  ? "العلماء ایزی ایڈیٹر — AI-Powered Islamic Research & Editing Suite"
                  : "Al-Ulama Easy Editor — AI-Powered Islamic Research & Editing Suite"
              }
              className="w-full max-w-lg rounded-2xl border border-border/60 shadow-2xl"
              loading="eager"
            />
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-16 md:py-24">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            {t("landing.features_title")}
          </h2>
          <p className="mt-3 text-muted-foreground md:text-lg">
            {t("landing.features_subtitle")}
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, key }) => (
            <Card
              key={key}
              className="group border-border/60 transition-shadow hover:shadow-lg"
            >
              <CardContent className="p-6">
                <div className="mb-4 inline-flex rounded-xl bg-primary/10 p-3 text-primary transition-transform group-hover:scale-110">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="mb-2 text-lg font-semibold">
                  {t(`landing.feature_${key}_title`)}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t(`landing.feature_${key}_desc`)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section
        id="pricing"
        className="bg-gradient-to-b from-background via-primary/5 to-background py-16 md:py-24"
      >
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              {t("landing.pricing_title")}
            </h2>
            <p className="mt-3 text-muted-foreground md:text-lg">
              {t("landing.pricing_subtitle")}
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => {
              const Icon = plan.icon;
              const popular = "popular" in plan && plan.popular;
              const comingSoon = "comingSoon" in plan && plan.comingSoon;
              return (
                <Card
                  key={plan.key}
                  className={`relative overflow-hidden transition-shadow hover:shadow-lg ${
                    popular ? "border-primary ring-2 ring-primary/30" : "border-border/60"
                  }`}
                >
                  {popular && (
                    <div className="absolute inset-x-0 top-0 flex justify-center">
                      <span className="rounded-b-lg bg-primary px-4 py-1 text-xs font-semibold text-primary-foreground">
                        ⭐ {t("pricing.recommended")}
                      </span>
                    </div>
                  )}
                  {comingSoon && (
                    <div className="absolute inset-x-0 top-0 flex justify-center">
                      <span className="rounded-b-lg bg-amber-500 px-4 py-1 text-xs font-semibold text-white">
                        {t("pricing.coming_soon")}
                      </span>
                    </div>
                  )}
                  <CardContent className={`p-6 ${popular || comingSoon ? "pt-10" : ""}`}>
                    <div className={`mb-4 inline-flex rounded-xl p-3 ${plan.bg}`}>
                      <Icon className={`h-6 w-6 ${plan.iconClass}`} />
                    </div>
                    <h3 className="mb-1 text-lg font-semibold">
                      {t(`landing.plan_${plan.key}_name`)}
                    </h3>
                    <div className="mb-4">
                      <span className="text-2xl font-bold">{plan.price}</span>
                      <span className="text-sm text-muted-foreground">
                        {" "}/ {t("pricing.per_month")}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t(`landing.plan_${plan.key}_desc`)}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <p className="mt-8 text-center text-xs text-muted-foreground">
            {t("pricing.manual_note")}
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/60 bg-primary/5 py-16">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            {t("landing.cta_title")}
          </h2>
          <p className="mt-3 text-muted-foreground md:text-lg">
            {t("landing.cta_subtitle")}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link to="/signup">
              <Button size="lg" className="h-12 gap-2 px-6 text-base">
                {t("landing.cta_signup")}
                <ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </Button>
            </Link>
            <Link to="/login">
              <Button variant="outline" size="lg" className="h-12 px-6 text-base">
                {t("auth.login")}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground md:flex-row">
          <div className="flex items-center gap-2">
            <img src="/favicon.webp" alt="" width={24} height={24} className="rounded" />
            <span>© {new Date().getFullYear()} EasyEditor</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/login" className="hover:text-foreground">
              {t("auth.login")}
            </Link>
            <Link to="/signup" className="hover:text-foreground">
              {t("auth.signup")}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
