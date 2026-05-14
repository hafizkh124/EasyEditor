import { useEffect } from "react";

const SITE_ORIGIN = "https://editor.alulama.org";

interface SeoOptions {
  title: string;
  description?: string;
  path?: string; // route path for canonical, e.g. "/ocr"
}

/**
 * Sets per-route <title>, <meta name="description">, and self-referencing
 * <link rel="canonical">. Title should be < 60 chars, description 50-160.
 */
export function useSeo({ title, description, path }: SeoOptions) {
  useEffect(() => {
    if (title) document.title = title;

    if (description) {
      let meta = document.head.querySelector<HTMLMetaElement>(
        'meta[name="description"]',
      );
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "description");
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", description);
    }

    const canonicalPath = path ?? window.location.pathname;
    const href = SITE_ORIGIN + canonicalPath;
    let link = document.head.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("rel", "canonical");
      document.head.appendChild(link);
    }
    link.setAttribute("href", href);
  }, [title, description, path]);
}
