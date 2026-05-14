import { useEffect, Fragment } from "react";
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
  MessageCircle,
  Copy,
} from "lucide-react";
import { toast } from "sonner";

interface PaymentAccount {
  methodKey: string;
  title: string;
  rows: { labelKey: string; value: string; mono?: boolean; small?: boolean }[];
}

const PAYMENT_ACCOUNTS: PaymentAccount[] = [
  {
    methodKey: "pricing.payment_method_nbp",
    title: "Al-Ulama",
    rows: [
      { labelKey: "pricing.payment_iban", value: "PK04NBPA1997004243449556", mono: true, small: true },
      { labelKey: "pricing.payment_branch", value: "Badami Bagh 1997" },
    ],
  },
  {
    methodKey: "pricing.payment_method_jazzcash_business",
    title: "Ulama Centre",
    rows: [{ labelKey: "pricing.payment_till_id", value: "00420745", mono: true }],
  },
  {
    methodKey: "pricing.payment_method_jazzcash_personal",
    title: "Hafiz Khizar Hayat",
    rows: [{ labelKey: "pricing.payment_number", value: "0308 4164816", mono: true }],
  },
  {
    methodKey: "pricing.payment_method_easypaisa_personal",
    title: "Hafiz Khizar Hayat",
    rows: [{ labelKey: "pricing.payment_number", value: "0308 4164816", mono: true }],
  },
];

const Landing = () => {
  const { user, loading } = useAuth();
  const { t, language, setLanguage, direction } = useLanguage();

  // Dynamic SEO per language
  useEffect(() => {
    const isUr = language === "ur";
    const title = isUr
      ? "العلماء ایزی ایڈیٹر — اسلامی AI ریسرچ اسسٹنٹ"
      : "Al-Ulama Easy Editor — Islamic AI Research Assistant";
    const desc = isUr
      ? "العلماء ایزی ایڈیٹر: قرآن و حدیث پر مبنی اسلامی AI اسسٹنٹ، اردو/عربی/انگریزی ریسرچ، ٹرانسکرپشن، OCR اور ٹیکسٹ ٹو اسپیچ — علماء و طلبہ کے لیے۔"
      : "Al-Ulama Easy Editor: Islamic AI assistant grounded in Quran & Hadith. Muslim AI for Urdu, Arabic and English research, transcription, OCR and text-to-speech.";

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
              src="/favicon.png"
              alt="EasyEditor"
              width={26}
              height={26}
              className="rounded"
            />
            <span className="text-lg font-bold tracking-tight text-foreground">EasyEditor</span>
          </Link>

          <nav className="flex items-center gap-1 sm:gap-2">
            <Link to="/about" className="hidden sm:inline-flex px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              {language === "ur" ? "ہمارے بارے میں" : "About"}
            </Link>
            <Link to="/faq/is-ai-haram-in-islam" className="hidden md:inline-flex px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              {language === "ur" ? "سوالات" : "FAQ"}
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLanguage(language === "ur" ? "en" : "ur")}
              className="gap-1.5"
            >
              <Languages className="h-4 w-4" />
              {language === "ur" ? "EN" : "اردو"}
            </Button>
          </nav>
        </div>
      </header>

      <main>
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
              src="/og-image.png"
              alt={
                language === "ur"
                  ? "العلماء ایزی ایڈیٹر — AI-Powered Islamic Research & Editing Suite"
                  : "Al-Ulama Easy Editor — AI-Powered Islamic Research & Editing Suite"
              }
              width={1200}
              height={630}
              className="w-full max-w-lg rounded-2xl border border-border/60 shadow-2xl"
              loading="eager"
              fetchPriority="high"
              decoding="async"
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

          <div className="mx-auto grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3 text-center">
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

          {/* Payment accounts */}
          <div id="payment-accounts" className="mx-auto mt-10 max-w-4xl scroll-mt-24">
            <h3 className="mb-4 text-center text-lg font-semibold text-foreground">
              {t("pricing.payment_methods_heading")}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {PAYMENT_ACCOUNTS.map((acc, i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-border/60 bg-card/40 p-5 shadow-sm backdrop-blur-sm"
                >
                  <p className="mb-3 text-sm font-semibold text-primary">
                    {t(acc.methodKey)}
                  </p>
                  <div className="grid grid-cols-[auto,1fr] items-center gap-x-3 gap-y-2 text-sm">
                    <span className="text-muted-foreground">
                      {t("pricing.payment_account_title")}:
                    </span>
                    <span className="font-medium" dir="ltr">
                      {acc.title}
                    </span>
                    {acc.rows.map((r, j) => (
                      <Fragment key={j}>
                        <span className="text-muted-foreground">{t(r.labelKey)}:</span>
                        <div className="flex items-center gap-2 min-w-0" dir="ltr">
                          <span
                            className={`font-medium break-all ${r.mono ? "font-mono" : ""} ${r.small ? "text-xs" : ""}`}
                          >
                            {r.value}
                          </span>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(r.value.replace(/\s+/g, ""));
                                toast.success(t("pricing.copied"));
                              } catch {
                                toast.error("Copy failed");
                              }
                            }}
                            aria-label={`${t("pricing.copy")} ${t(r.labelKey)}`}
                            className="flex-shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </Fragment>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-border/60 bg-card/40 p-6 shadow-sm backdrop-blur-sm sm:p-8">
            <p className="text-center text-sm leading-relaxed text-muted-foreground">
              {t("pricing.manual_note_intro")}
            </p>

            <a
              href="https://wa.me/923184269036"
              target="_blank"
              rel="noopener noreferrer"
              className="group mx-auto my-5 flex w-full max-w-sm items-center justify-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-3 transition-all hover:border-emerald-500/60 hover:bg-emerald-500/20 hover:shadow-md"
              dir="ltr"
            >
              <MessageCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <span className="font-mono text-base font-semibold tracking-wider text-emerald-700 dark:text-emerald-300">
                +92 318 4269036
              </span>
            </a>

            <p className="text-center text-sm leading-relaxed text-muted-foreground">
              {t("pricing.manual_note_outro")}
            </p>
          </div>
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
      </main>

      {/* Footer */}
      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground md:flex-row">
          <div className="flex items-center gap-2">
            <img src="/favicon.png" alt="" width={24} height={24} className="rounded" />
            <span>© {new Date().getFullYear()} EasyEditor</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link to="/about" className="hover:text-foreground">
              {language === "ur" ? "ہمارے بارے میں" : "About"}
            </Link>
            <Link to="/faq/is-ai-haram-in-islam" className="hover:text-foreground">
              {language === "ur" ? "سوالات" : "FAQ"}
            </Link>
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
