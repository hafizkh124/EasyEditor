import { useEffect } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Mic,
  LayoutPanelLeft,
  ShieldCheck,
  Bot,
  Plug,
  Library,
  BookOpen,
  Sparkles,
  Monitor,
  Download,
  Check,
  ArrowRight,
  Languages,
  Crown,
  Zap,
  Star,
  CreditCard,
  Clock,
  Github,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PLAN_TIERS, buildFeatures, priceForCurrency, type PaidTier } from "@/lib/planTiers";
import { useDisplayCurrency } from "@/hooks/useDisplayCurrency";
import { useSeo } from "@/hooks/useSeo";
import {
  AUDIENCES,
  DESKTOP,
  DESKTOP_DOWNLOAD_URL,
  FAQ,
  FAQ_HEADING,
  FEATURES,
  FEATURES_HEADING,
  FINAL_CTA,
  HERO,
  PRICING_NOTE,
  SEO,
  SOURCE_URL,
  TRUST,
  type FeatureItem,
} from "@/lib/landingContent";

export const PENDING_CHECKOUT_KEY = "pendingCheckoutPlan";
export const PENDING_CHECKOUT_METHOD_KEY = "pendingCheckoutMethod";

const PLAN_STYLE: Record<PaidTier, { icon: typeof Zap; iconClass: string; bg: string }> = {
  basic: { icon: Zap, iconClass: "text-info", bg: "bg-info/10" },
  pro: { icon: Crown, iconClass: "text-primary", bg: "bg-primary/15" },
  ultra: { icon: Star, iconClass: "text-purple-500", bg: "bg-purple-500/10" },
};

const Landing = () => {
  const { user, loading } = useAuth();
  const { t, language, setLanguage, direction } = useLanguage();
  const currency = useDisplayCurrency();
  const navigate = useNavigate();

  const openChoice = (planId: PaidTier) => {
    try {
      sessionStorage.setItem(PENDING_CHECKOUT_KEY, planId);
      sessionStorage.setItem(PENDING_CHECKOUT_METHOD_KEY, "manual");
    } catch {
      // ignore storage errors
    }
    navigate(`/signup?checkout=${planId}&method=manual`);
  };



  const lang = language as "en" | "ur" | "ar";
  const prefix = lang === "en" ? "" : `/${lang}`;
  useSeo({ title: SEO.title[lang], description: SEO.description[lang], path: "/" });

  // <html lang> is set by LanguageContext. The site-wide Organization / WebSite /
  // SoftwareApplication graph lives in index.html; only the FAQ is page-specific.
  useEffect(() => {
    const ldId = "ld-faq";
    document.getElementById(ldId)?.remove();
    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.id = ldId;
    ld.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      inLanguage: lang,
      mainEntity: FAQ.map((item) => ({
        "@type": "Question",
        name: item.q[lang],
        acceptedAnswer: { "@type": "Answer", text: item.a[lang] },
      })),
    });
    document.head.appendChild(ld);
    return () => ld.remove();
  }, [lang]);

  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;

  const featureIcons: Record<FeatureItem["icon"], typeof Mic> = {
    workspace: LayoutPanelLeft,
    research: ShieldCheck,
    tasks: Sparkles,
    agent: Bot,
    connectors: Plug,
    library: Library,
    voice: Mic,
    book: BookOpen,
  };

  const plans = PLAN_TIERS.map((tier) => {
    const style = PLAN_STYLE[tier.id];
    return {
      ...tier,
      icon: style.icon,
      iconClass: style.iconClass,
      bg: style.bg,
      features: buildFeatures(tier.featureTemplates, t).filter((f) => f.included || f.comingSoon),
    };
  });

  return (
    <div dir={direction} className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2.5">
            <img
              src="/favicon.png"
              alt="Easy Editor"
              width={26}
              height={26}
              className="rounded"
            />
            <span className="text-lg font-bold tracking-tight text-foreground">Easy Editor</span>
          </Link>

          <nav className="flex items-center gap-1 sm:gap-2">
            <Link to={`${prefix}/about`} className="hidden sm:inline-flex px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              {language === "ar" ? "من نحن" : language === "ur" ? "ہمارے بارے میں" : "About"}
            </Link>
            <Link to={`${prefix}/faq/is-ai-haram-in-islam`} className="hidden md:inline-flex px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              {language === "ar" ? "الأسئلة الشائعة" : language === "ur" ? "سوالات" : "FAQ"}
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5">
                  <Languages className="h-4 w-4" />
                  {language === "ar" ? "العربية" : language === "ur" ? "اردو" : "EN"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setLanguage("en")}>English</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLanguage("ur")}>اردو</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLanguage("ar")}>العربية</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
              {HERO.badge[lang]}
            </Badge>
            <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">
              {HERO.title[lang]}
            </h1>
            <p className="text-lg text-muted-foreground md:text-xl">{HERO.subtitle[lang]}</p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link to="/signup">
                <Button size="lg" className="h-12 gap-2 px-6 text-base">
                  {HERO.ctaSignup[lang]}
                  <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                </Button>
              </Link>
              <Button asChild variant="outline" size="lg" className="h-12 gap-2 px-6 text-base">
                <a href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
                  <Download className="h-4 w-4" />
                  {HERO.ctaDesktop[lang]}
                </a>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">{HERO.access[lang]}</p>
            <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-sm text-muted-foreground">
              {HERO.trust.map((item) => (
                <li key={item.en} className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-primary" />
                  {item[lang]}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center justify-center">
            <img
              src="/og-image.webp"
              alt={HERO.imageAlt[lang]}
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
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{FEATURES_HEADING.title[lang]}</h2>
          <p className="mt-3 text-muted-foreground md:text-lg">{FEATURES_HEADING.subtitle[lang]}</p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => {
            const Icon = featureIcons[feature.icon];
            return (
              <Card key={feature.icon} className="group border-border/60 transition-shadow hover:shadow-lg">
                <CardContent className="p-6">
                  <div className="mb-4 inline-flex rounded-xl bg-primary/10 p-3 text-primary transition-transform group-hover:scale-110">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold">{feature.title[lang]}</h3>
                  <p className="text-sm text-muted-foreground">{feature.desc[lang]}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
        <p className="mt-8 text-center text-sm">
          <Link to={`${prefix}/guides/maktaba-shamila-tutorial`} className="font-medium text-primary hover:underline">
            {lang === "ar"
              ? "دليل: توثيق البحث الشرعي انطلاقًا من المكتبة الشاملة"
              : lang === "ur"
              ? "رہنما: مکتبہ شاملہ سے حوالہ جانچ کر تحقیق کیسے کریں"
              : "Guide: citation-checked research starting from Maktaba Shamila"}
          </Link>
        </p>
      </section>

      {/* Desktop */}
      <section id="desktop" className="border-y border-border/60 bg-primary/5 py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mx-auto mb-10 max-w-3xl text-center">
            <div className="mx-auto mb-4 inline-flex rounded-xl bg-primary/10 p-3 text-primary">
              <Monitor className="h-6 w-6" />
            </div>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{DESKTOP.title[lang]}</h2>
            <p className="mt-3 text-muted-foreground md:text-lg">{DESKTOP.subtitle[lang]}</p>
          </div>
          <ul className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-2">
            {DESKTOP.points.map((point) => (
              <li key={point.en} className="flex items-start gap-2 rounded-lg border border-border/60 bg-background p-4 text-sm">
                <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-success" />
                <span>{point[lang]}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-col items-center gap-3 text-center">
            <Button asChild size="lg" className="h-12 gap-2 px-6 text-base">
              <a href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
                <Download className="h-4 w-4" />
                {DESKTOP.cta[lang]}
              </a>
            </Button>
            <p className="max-w-xl text-sm text-muted-foreground">{DESKTOP.note[lang]}</p>
          </div>
        </div>
      </section>

      {/* Trust */}
      <section id="trust" className="mx-auto max-w-6xl px-4 py-16 md:py-24">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{TRUST.title[lang]}</h2>
          <p className="mt-3 text-muted-foreground md:text-lg">{TRUST.subtitle[lang]}</p>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {TRUST.items.map((item) => (
            <Card key={item.title.en} className="border-border/60">
              <CardContent className="p-6">
                <h3 className="mb-2 text-lg font-semibold">{item.title[lang]}</h3>
                <p className="text-sm text-muted-foreground">{item.desc[lang]}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="mt-6 text-center">
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={lang === "ar" ? "الشيفرة المصدرية على GitHub" : lang === "ur" ? "GitHub پر سورس کوڈ" : "Source code on GitHub"}
            title={lang === "ar" ? "الشيفرة المصدرية على GitHub" : lang === "ur" ? "GitHub پر سورس کوڈ" : "Source code on GitHub"}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/60 text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
          >
            <Github className="h-5 w-5" />
          </a>
        </p>
      </section>

      {/* Audiences */}
      <section id="audiences" className="border-y border-border/60 bg-muted/60 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="mb-10 text-center text-3xl font-bold tracking-tight">{AUDIENCES.title[lang]}</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {AUDIENCES.items.map((item) => (
              <div key={item.title.en} className="rounded-xl border border-border/60 bg-background p-5">
                <h3 className="mb-1 font-semibold">{item.title[lang]}</h3>
                <p className="text-sm text-muted-foreground">{item.desc[lang]}</p>
              </div>
            ))}
          </div>
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
              const popular = plan.popular;
              const comingSoon = plan.comingSoon;
              return (
                <Card
                  key={plan.id}
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
                      <span className="rounded-b-lg bg-warning px-4 py-1 text-xs font-semibold text-warning-foreground">
                        {t("pricing.coming_soon")}
                      </span>
                    </div>
                  )}
                  <CardContent className={`p-6 ${popular || comingSoon ? "pt-10" : ""}`}>
                    <div className={`mb-4 inline-flex rounded-xl p-3 ${plan.bg}`}>
                      <Icon className={`h-6 w-6 ${plan.iconClass}`} />
                    </div>
                    <h3 className="mb-1 text-lg font-semibold">
                      {t(plan.nameKey as import("@/lib/i18n").TranslationKey)}
                    </h3>
                    <div className="mb-1">
                      <span className="text-2xl font-bold text-primary">{priceForCurrency(plan, currency)}</span>
                      <span className="text-sm text-muted-foreground">
                        {" "}/ {t("pricing.per_month")}
                      </span>
                    </div>
                    <div className="mb-4 inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                      <Zap className="h-3 w-3" /> {language === "ar" ? "تحقّق فوري من النظام" : language === "ur" ? "سسٹم سے فوری تصدیق" : "Instant system verification"}
                    </div>
                    <ul className="space-y-2 text-start">
                      {plan.features.map((f, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm">
                          {f.comingSoon ? (
                            <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
                          ) : (
                            <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-success" />
                          )}
                          <span className="text-foreground/90 flex-1">{f.label}</span>
                          {f.comingSoon && (
                            <Badge variant="outline" className="text-xs py-0 px-1.5 border-warning/60 text-warning">
                              {t("pricing.coming_soon")}
                            </Badge>
                          )}
                        </li>
                      ))}
                    </ul>

                    {!comingSoon && (
                      <Button
                        onClick={() => openChoice(plan.id)}
                        className="mt-5 w-full gap-2"
                        size="sm"
                      >
                        <CreditCard className="h-4 w-4" />
                        {language === "ar" ? `اشترك في ${t(plan.nameKey as import("@/lib/i18n").TranslationKey)}` : language === "ur" ? `${t(plan.nameKey as import("@/lib/i18n").TranslationKey)} حاصل کریں` : `Get ${t(plan.nameKey as import("@/lib/i18n").TranslationKey)}`}
                      </Button>
                    )}
                    {comingSoon && (
                      <Button disabled variant="outline" className="mt-5 w-full" size="sm">
                        {t("pricing.coming_soon")}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-muted-foreground">{PRICING_NOTE[lang]}</p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl px-4 py-16 md:py-24">
        <h2 className="mb-8 text-center text-3xl font-bold tracking-tight md:text-4xl">{FAQ_HEADING[lang]}</h2>
        <div className="space-y-3">
          {FAQ.map((item) => (
            <details key={item.q.en} className="group rounded-lg border border-border/60 bg-background p-4">
              <summary className="cursor-pointer list-none font-medium">{item.q[lang]}</summary>
              <p className="mt-3 text-sm text-muted-foreground">{item.a[lang]}</p>
            </details>
          ))}
        </div>
        <p className="mt-6 text-center text-sm">
          <Link to={`${prefix}/faq/is-ai-haram-in-islam`} className="text-primary hover:underline">
            {lang === "ar" ? "هل الذكاء الاصطناعي حرام؟ اقرأ المقال" : lang === "ur" ? "کیا AI حرام ہے؟ مضمون پڑھیں" : "Is AI haram in Islam? Read the article"}
          </Link>
        </p>
      </section>

      {/* CTA */}
      <section className="border-t border-border/60 bg-primary/5 py-16">
        <div className="page-container text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            {FINAL_CTA.title[lang]}
          </h2>
          <p className="mt-3 text-muted-foreground md:text-lg">
            {FINAL_CTA.subtitle[lang]}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link to="/signup">
              <Button size="lg" className="h-12 gap-2 px-6 text-base">
                {HERO.ctaSignup[lang]}
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
            <img src="/favicon.png" alt="Easy Editor" width={24} height={24} className="rounded" />
            <span>© {new Date().getFullYear()} EasyEditor</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link to={`${prefix}/about`} className="hover:text-foreground">
              {language === "ar" ? "من نحن" : language === "ur" ? "ہمارے بارے میں" : "About"}
            </Link>
            <Link to={`${prefix}/pricing-info`} className="hover:text-foreground">
              {language === "ar" ? "الأسعار" : language === "ur" ? "پرائسنگ" : "Pricing"}
            </Link>
            <Link to={`${prefix}/terms`} className="hover:text-foreground">
              {language === "ar" ? "الشروط" : language === "ur" ? "شرائط" : "Terms"}
            </Link>
            <Link to={`${prefix}/privacy`} className="hover:text-foreground">
              {language === "ar" ? "الخصوصية" : language === "ur" ? "پرائیویسی" : "Privacy"}
            </Link>
            <Link to={`${prefix}/refund-policy`} className="hover:text-foreground">
              {language === "ar" ? "الاسترداد" : language === "ur" ? "ریفنڈ" : "Refunds"}
            </Link>
            <Link to={`${prefix}/guides/maktaba-shamila-tutorial`} className="hover:text-foreground">
              {language === "ar" ? "دليل الشاملة" : language === "ur" ? "شاملہ رہنما" : "Shamila guide"}
            </Link>
            <Link to={`${prefix}/faq/is-ai-haram-in-islam`} className="hover:text-foreground">
              {language === "ar" ? "الأسئلة الشائعة" : language === "ur" ? "سوالات" : "FAQ"}
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
