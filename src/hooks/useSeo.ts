import { useEffect } from "react";

const SITE_ORIGIN = "https://editor.alulama.org";

interface SeoOptions {
  title: string;
  description?: string;
  path?: string;
}

/**
 * Sets per-route <title>, <meta name="description">, <link rel="canonical">,
 * and Open Graph / Twitter title, description and URL.
 */
export function useSeo({ title, description, path }: SeoOptions) {
  useEffect(() => {
    if (title) document.title = title;

    const canonicalPath = path ?? window.location.pathname;
    const url = SITE_ORIGIN + canonicalPath;

    const setMeta = (selector: string, attr: "name" | "property", key: string, value: string) => {
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

    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("rel", "canonical");
      document.head.appendChild(link);
    }
    link.setAttribute("href", url);
  }, [title, description, path]);
}
