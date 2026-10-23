import { ArrowLeft, ArrowRight, Home } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

interface PageBackProps {
  /** Where "back" goes when there is no earlier page in this tab (a deep link, a new tab). */
  fallback?: string;
  /** Also show a Home button (to /dashboard). On by default: a full-screen page has no sidebar. */
  home?: boolean;
  className?: string;
}

/**
 * A way out for a full-screen page that does not sit inside AppLayout (no
 * sidebar, no tab bar). Without it, a scholar who opens such a page from a
 * link has no visible route back to the app.
 *
 * Back follows the browser history when this tab has any, so it returns to
 * wherever the scholar came from; otherwise it goes to `fallback`. The arrow
 * points the way "back" is read: right in RTL, left in LTR.
 */
export function PageBack({ fallback = "/files", home = true, className }: PageBackProps) {
  const { t, direction } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const Arrow = direction === "rtl" ? ArrowRight : ArrowLeft;

  // React Router stores the history index in `window.history.state.idx`; 0 means this entry opened the tab.
  const hasHistory = typeof window !== "undefined" && (window.history.state?.idx ?? 0) > 0;
  const goBack = () => (hasHistory ? navigate(-1) : navigate(fallback, { replace: true }));

  return (
    <nav aria-label={t("common.back", "Back")} className={cn("flex shrink-0 items-center gap-1", className)}>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 min-h-touch min-w-touch md:min-h-0 md:min-w-0"
        onClick={goBack}
        aria-label={t("common.back", "Back")}
        title={t("common.back", "Back")}
      >
        <Arrow className="h-4 w-4" aria-hidden="true" />
      </Button>
      {home && location.pathname !== "/dashboard" && (
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="h-8 w-8 min-h-touch min-w-touch md:min-h-0 md:min-w-0"
        >
          <Link to="/dashboard" aria-label={t("nav.home", "Home")} title={t("nav.home", "Home")}>
            <Home className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      )}
    </nav>
  );
}
