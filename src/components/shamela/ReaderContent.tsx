import React, { useMemo } from "react";
import { AlertCircle } from "lucide-react";
import type { ReaderPage } from "@/hooks/useReaderState";
import { effectiveDirection, type TextDirection } from "@/lib/reader/direction";
import { useLanguage } from "@/contexts/LanguageContext";

interface ReaderContentProps {
  page: ReaderPage | null;
  loading: boolean;
  error: string | null;
  pageNumber: number;
  pageCount: number;
  /** Typography settings from useReaderSettings (font/theme/width/direction). */
  reader: {
    direction: "auto" | "rtl" | "ltr";
    width: string;
  } | null;
}

/**
 * Renders one Shamela page. The `text` is trusted HTML produced by Shamela 4's
 * own Lucene index — it carries `<span data-type="title">` heading markers and
 * reference links. Footnotes arrive separately and are appended in a styled
 * block below the body text.
 *
 * The HTML is intentionally rendered via `dangerouslySetInnerHTML`: the source
 * is the local Shamela installation's index, not user uploads, and re-parsing
 * it into a rich editor would strip the reference markup readers rely on.
 *
 * Direction follows the book's own script (auto) or an explicit reader choice,
 * so Arabic, Urdu and English books all render correctly (SPEC-M6 Phase 3).
 */
export const ReaderContent: React.FC<ReaderContentProps> = ({
  page,
  loading,
  error,
  pageNumber,
  pageCount,
  reader,
}) => {
  const { t } = useLanguage();
  const bodyWithFootnotes = useMemo(() => {
    if (!page) return null;
    if (!page.footnotes?.trim()) return page.text;
    return `${page.text}\n<div class="reader-footnotes" data-reader-footnotes>\n${page.footnotes}\n</div>`;
  }, [page]);

  const direction: TextDirection = useMemo(() => {
    const text = bodyWithFootnotes ?? page?.text ?? "";
    return effectiveDirection(reader?.direction ?? "auto", text);
  }, [bodyWithFootnotes, page, reader]);

  const lang = useMemo(() => (direction === "rtl" ? "ar" : "en"), [direction]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 text-muted-foreground">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
        <p className="mt-3 text-xs">{t("reader.loading_page")} {pageNumber}…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 text-center px-6">
        <AlertCircle className="h-8 w-8 text-destructive mb-3" />
        <p className="text-sm font-medium text-destructive">{error}</p>
      </div>
    );
  }

  if (!page) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 text-muted-foreground">
        <p className="text-sm">{t("reader.no_content")}</p>
      </div>
    );
  }

  return (
    <div
      className="reader-page mx-auto px-6 md:px-10 py-8"
      data-width={reader?.width}
    >
      <div
        className="shamela-page-text"
        dir={direction}
        lang={lang}
        dangerouslySetInnerHTML={{ __html: bodyWithFootnotes ?? "" }}
      />
      <p className="mt-10 text-center text-xs text-muted-foreground/60">
        {t("reader.page")} {pageNumber} / {pageCount || "…"}
      </p>
    </div>
  );
};
