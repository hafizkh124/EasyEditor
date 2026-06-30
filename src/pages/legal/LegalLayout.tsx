import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { useSeo } from "@/hooks/useSeo";
import { getLegalArabicHtml, type LegalSlug } from "@/lib/legalArabic";

interface Props {
  title: string;
  titleAr?: string;
  description: string;
  descriptionAr?: string;
  path: string;
  lastUpdated: string;
  slug?: LegalSlug;
  children: ReactNode;
}

export default function LegalLayout({
  title,
  titleAr,
  description,
  descriptionAr,
  path,
  lastUpdated,
  slug,
  children,
}: Props) {
  const { language, direction } = useLanguage();
  const isAr = language === "ar";

  useSeo({
    title: `${isAr && titleAr ? titleAr : title} — Al-Ulama Easy Editor`,
    description: isAr && descriptionAr ? descriptionAr : description,
    path,
  });

  const arHtml = slug ? getLegalArabicHtml(slug) : "";

  return (
    <div dir={direction} className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/favicon.png" alt="Easy Editor" width={24} height={24} className="rounded" />
            <span className="text-base font-bold tracking-tight">Easy Editor</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link to="/terms" className="hover:text-foreground">
              {language === "ar" ? "الشروط" : language === "ur" ? "شرائط" : "Terms"}
            </Link>
            <Link to="/privacy" className="hover:text-foreground">
              {language === "ar" ? "الخصوصية" : language === "ur" ? "پرائیویسی" : "Privacy"}
            </Link>
            <Link to="/refund-policy" className="hover:text-foreground">
              {language === "ar" ? "الاسترداد" : language === "ur" ? "ریفنڈ" : "Refunds"}
            </Link>
            <Link to="/pricing-info" className="hover:text-foreground">
              {language === "ar" ? "الأسعار" : language === "ur" ? "پرائسنگ" : "Pricing"}
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">
          {isAr && titleAr ? titleAr : title}
        </h1>
        <p className="text-sm text-muted-foreground mb-10">
          {language === "ar" ? "آخر تحديث: " : language === "ur" ? "آخری اپ ڈیٹ: " : "Last updated: "}
          {lastUpdated}
        </p>
        <article className="prose prose-neutral dark:prose-invert max-w-none prose-headings:scroll-mt-20 prose-h2:mt-10 prose-h2:text-xl prose-h3:text-lg prose-a:text-primary">
          {isAr && arHtml ? (
            <div dangerouslySetInnerHTML={{ __html: arHtml }} />
          ) : (
            children
          )}
        </article>
      </main>

      <footer className="border-t border-border/60 py-8 mt-12">
        <div className="mx-auto max-w-4xl px-4 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} Al-Ulama Easy Editor · Operated by Hafiz Khizar Hayat ·{" "}
          <Link to="/terms" className="hover:text-foreground">
            {language === "ar" ? "الشروط" : language === "ur" ? "شرائط" : "Terms"}
          </Link>{" "}
          ·{" "}
          <Link to="/privacy" className="hover:text-foreground">
            {language === "ar" ? "الخصوصية" : language === "ur" ? "پرائیویسی" : "Privacy"}
          </Link>{" "}
          ·{" "}
          <Link to="/refund-policy" className="hover:text-foreground">
            {language === "ar" ? "الاسترداد" : language === "ur" ? "ریفنڈ" : "Refunds"}
          </Link>
        </div>
      </footer>
    </div>
  );
}
