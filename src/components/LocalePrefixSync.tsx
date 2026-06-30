import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";

const SUPPORTED_PREFIXES = ["ar", "ur"] as const;
type LocalePrefix = (typeof SUPPORTED_PREFIXES)[number];

const isPrefix = (v: string | undefined): v is LocalePrefix =>
  v === "ar" || v === "ur";

/**
 * Two-way sync between URL locale prefix (/ar/..., /ur/...) and LanguageContext.
 * - On URL change: sets language to match prefix (or "en" when no prefix).
 * - On language change: updates URL to add/remove the prefix, preserving the rest of the path.
 * Only mounted inside <BrowserRouter>; only affects public pages — protected routes
 * have no prefix and continue using the language toggle for in-app translation.
 */
export default function LocalePrefixSync() {
  const { language, setLanguage } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();

  // URL → language
  useEffect(() => {
    const segments = location.pathname.split("/").filter(Boolean);
    const first = segments[0];
    if (isPrefix(first)) {
      if (language !== first) setLanguage(first);
    }
    // If no locale prefix, do NOT force language to "en" — user may have toggled
    // to ur/ar on a page that hasn't been mirrored under /ar/. We only push the
    // prefix when language change happens (effect below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Language → URL (only for routes that have public mirrors)
  useEffect(() => {
    const segments = location.pathname.split("/").filter(Boolean);
    const first = segments[0];
    const hasPrefix = isPrefix(first);
    const rest = hasPrefix ? "/" + segments.slice(1).join("/") : location.pathname;

    let target: string;
    if (language === "en") {
      target = hasPrefix ? (rest === "/" ? "/" : rest) : location.pathname;
    } else {
      // ar or ur
      target = `/${language}${rest === "/" ? "" : rest}`;
      if (target === `/${language}`) target = `/${language}`;
    }

    // Only navigate if path differs and target is one we actually serve as public.
    // Avoid prefixing app/protected routes by checking against an allowlist.
    if (target !== location.pathname && isPublicRoute(rest === "" ? "/" : rest)) {
      navigate(target + location.search + location.hash, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  return null;
}

const PUBLIC_ROUTES = new Set([
  "/",
  "/about",
  "/faq/is-ai-haram-in-islam",
  "/terms",
  "/privacy",
  "/refund-policy",
  "/pricing-info",
]);

function isPublicRoute(path: string): boolean {
  return PUBLIC_ROUTES.has(path);
}
