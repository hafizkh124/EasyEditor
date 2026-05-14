import { Link } from "react-router-dom";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

interface PublicLayoutProps {
  children: React.ReactNode;
}

const PublicLayout: React.FC<PublicLayoutProps> = ({ children }) => {
  const { t, language, setLanguage, direction } = useLanguage();

  return (
    <div dir={direction} className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/favicon.png" alt="EasyEditor" width={26} height={26} className="rounded" />
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
            <Link to="/login">
              <Button variant="outline" size="sm">{t("auth.login")}</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <footer className="border-t border-border/60 py-8 mt-12">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground md:flex-row">
          <div className="flex items-center gap-2">
            <img src="/favicon.png" alt="" width={24} height={24} className="rounded" />
            <span>© {new Date().getFullYear()} EasyEditor</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link to="/about" className="hover:text-foreground">{language === "ur" ? "ہمارے بارے میں" : "About"}</Link>
            <Link to="/faq/is-ai-haram-in-islam" className="hover:text-foreground">{language === "ur" ? "سوالات" : "FAQ"}</Link>
            <Link to="/login" className="hover:text-foreground">{t("auth.login")}</Link>
            <Link to="/signup" className="hover:text-foreground">{t("auth.signup")}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default PublicLayout;
