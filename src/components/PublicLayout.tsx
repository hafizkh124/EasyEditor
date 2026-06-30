import { Link } from "react-router-dom";
import { Languages, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface PublicLayoutProps {
  children: React.ReactNode;
}

const LANGS = [
  { code: "en" as const, label: "English" },
  { code: "ur" as const, label: "اردو" },
  { code: "ar" as const, label: "العربية" },
];

const tri = (
  en: string,
  ur: string,
  ar: string,
  lang: "en" | "ur" | "ar",
) => (lang === "ar" ? ar : lang === "ur" ? ur : en);

const PublicLayout: React.FC<PublicLayoutProps> = ({ children }) => {
  const { t, language, setLanguage, direction } = useLanguage();
  const current = LANGS.find((l) => l.code === language) ?? LANGS[0];
  const localePrefix = language === "en" ? "" : `/${language}`;

  return (
    <div dir={direction} className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to={localePrefix || "/"} className="flex items-center gap-2.5">
            <img src="/favicon.png" alt="Easy Editor" width={26} height={26} className="rounded" />
            <span className="text-lg font-bold tracking-tight text-foreground">Easy Editor</span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <Link to={`${localePrefix}/about`} className="hidden sm:inline-flex px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              {tri("About", "ہمارے بارے میں", "من نحن", language)}
            </Link>
            <Link to={`${localePrefix}/faq/is-ai-haram-in-islam`} className="hidden md:inline-flex px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              {tri("FAQ", "سوالات", "الأسئلة الشائعة", language)}
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5">
                  <Languages className="h-4 w-4" />
                  {current.label}
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {LANGS.map((l) => (
                  <DropdownMenuItem
                    key={l.code}
                    onClick={() => setLanguage(l.code)}
                    className={l.code === language ? "font-semibold" : ""}
                  >
                    {l.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
            <img src="/favicon.png" alt="Easy Editor" width={24} height={24} className="rounded" />
            <span>© {new Date().getFullYear()} Easy Editor</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link to={`${localePrefix}/about`} className="hover:text-foreground">{tri("About", "ہمارے بارے میں", "من نحن", language)}</Link>
            <Link to={`${localePrefix}/faq/is-ai-haram-in-islam`} className="hover:text-foreground">{tri("FAQ", "سوالات", "الأسئلة الشائعة", language)}</Link>
            <Link to="/login" className="hover:text-foreground">{t("auth.login")}</Link>
            <Link to="/signup" className="hover:text-foreground">{t("auth.signup")}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default PublicLayout;
