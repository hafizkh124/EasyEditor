import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useSeo } from "@/hooks/useSeo";
import { Button } from "@/components/ui/button";
import { Home } from "lucide-react";
import { logger } from "@/lib/logger";

const log = logger.child("NotFound");

const NotFound = () => {
  const location = useLocation();
  const { direction, t } = useLanguage();

  useSeo({ title: "Page not found — Al-Ulama Easy Editor", description: "This page could not be found.", noindex: true });

  useEffect(() => {
    log.error("404 Error: User attempted to access non-existent route", { detail: location.pathname });
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4" dir={direction}>
      <div className="text-center space-y-4">
        <h1 className="text-7xl font-bold text-primary">404</h1>
        <p className="text-xl text-muted-foreground">{t("notfound.title")}</p>
        <p className="text-sm text-muted-foreground max-w-xs mx-auto">
          {t("notfound.description")}
        </p>
        <Link to="/">
          <Button className="gap-2 mt-2">
            <Home className="h-4 w-4" />
            {t("notfound.return_home")}
          </Button>
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
