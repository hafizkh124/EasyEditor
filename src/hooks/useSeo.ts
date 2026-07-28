import { useEffect } from "react";
import { useLanguage } from "@/contexts/LanguageContext";

const SITE_ORIGIN = "https://editor.alulama.org";

interface SeoOptions {
  title: string;
  description?: string;
  /**
   * Canonical base path WITHOUT a locale prefix (e.g. "/about", "/privacy").
   * The hook prepends "/ar" or "/ur" automatically based on current language.
   * Defaults to the current window pathname (with any locale prefix stripped).
   */
  path?: string;
  /**
   * If true, emit `<meta name="robots" content="noindex, nofollow" />` so
   * search engines skip this route. Use for authenticated / private pages.
   */
  noindex?: boolean;
}

/**
 * Sets per-route <title>, <meta name="description">, <link rel="canonical">,
 * Open Graph / Twitter title-description-url, AND hreflang alternates for
 * English / Urdu / Arabic / x-default.
 *
 * The canonical points at the current locale's URL (per Google's guidance for
 * localized variants).
 */
export function useSeo({ title, description, path, noindex }: SeoOptions) {
  const { language } = useLanguage();

  useEffect(() => {
    if (title) document.title = title;

    // Managed robots meta — added when noindex, removed otherwise.
    const existingRobots = document.head.querySelector<HTMLMetaElement>(
      'meta[name="robots"][data-managed="seo-hook"]',
    );
    if (noindex) {
      const el = existingRobots ?? document.createElement("meta");
      el.setAttribute("name", "robots");
      el.setAttribute("content", "noindex, nofollow");
      el.setAttribute("data-managed", "seo-hook");
      if (!existingRobots) document.head.appendChild(el);
    } else if (existingRobots) {
      existingRobots.remove();
    }


    const stripLocale = (p: string) => p.replace(/^\/(ar|ur)(?=\/|$)/, "") || "/";
    const basePath = path ?? stripLocale(window.location.pathname);
    const localePrefix = language === "en" ? "" : `/${language}`;
    const currentPath = basePath === "/" ? localePrefix || "/" : `${localePrefix}${basePath}`;
    const url = SITE_ORIGIN + currentPath;

    const setMeta = (
      selector: string,
      attr: "name" | "property",
      key: string,
      value: string,
    ) => {
      let el = document.head.querySelector<HTMLMetaElement>(selector);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute("content", value);
    };

    if (description) {
      setMeta('meta[name="description"]', "name", "description", description);
      setMeta('meta[property="og:description"]', "property", "og:description", description);
      setMeta('meta[name="twitter:description"]', "name", "twitter:description", description);
    }
    if (title) {
      setMeta('meta[property="og:title"]', "property", "og:title", title);
      setMeta('meta[name="twitter:title"]', "name", "twitter:title", title);
    }
    setMeta('meta[property="og:url"]', "property", "og:url", url);
    setMeta('meta[property="og:locale"]', "property", "og:locale", language === "ar" ? "ar_SA" : language === "ur" ? "ur_PK" : "en_US");

    // Canonical
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("rel", "canonical");
      document.head.appendChild(link);
    }
    link.setAttribute("href", url);

    // hreflang alternates — remove old, then add fresh.
    document.head
      .querySelectorAll('link[rel="alternate"][data-managed="seo-hook"]')
      .forEach((el) => el.remove());

    const alternates: Array<{ hreflang: string; path: string }> = [
      { hreflang: "en", path: basePath },
      { hreflang: "ur", path: `/ur${basePath === "/" ? "" : basePath}` },
      { hreflang: "ar", path: `/ar${basePath === "/" ? "" : basePath}` },
      { hreflang: "x-default", path: basePath },
    ];
    for (const alt of alternates) {
      const a = document.createElement("link");
      a.setAttribute("rel", "alternate");
      a.setAttribute("hreflang", alt.hreflang);
      a.setAttribute("href", SITE_ORIGIN + (alt.path || "/"));
      a.setAttribute("data-managed", "seo-hook");
      document.head.appendChild(a);
    }
  }, [title, description, path, language, noindex]);
}
