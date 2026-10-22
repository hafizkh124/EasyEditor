import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { splitPages, splitUncertain } from "@/lib/extract/uncertain";

/**
 * An image or PDF result checked against its source (SYSTEM-2026 §5): the
 * page beside its text — stacked on a phone — with the words OCR was unsure
 * of in yellow, and page by page through a multi-page PDF. Read-only: the
 * text is edited in the "Edit" view, and this one follows those edits.
 */
export function PageCompare({ images, text, dir }: { images: readonly string[]; text: string; dir: "rtl" | "ltr" }) {
  const { t } = useLanguage();
  const [index, setIndex] = useState(0);
  const pages = useMemo(() => splitPages(text), [text]);
  const total = images.length;

  useEffect(() => {
    if (index >= total) setIndex(Math.max(0, total - 1));
  }, [index, total]);

  // The text for the page on show: by its marker number, else by position.
  const pageText = pages.find((p) => p.pageNum === index + 1)?.text ?? pages[index]?.text ?? "";
  const runs = splitUncertain(pageText);
  const uncertain = runs.filter((r) => r.uncertain).length;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
        {total > 1 && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost" size="icon" className="h-9 w-9"
              onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}
              aria-label={t("translate.prev_page", "پچھلا صفحہ")}
            >
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {t("extract.page_of", "صفحہ {n} از {total}").replace("{n}", String(index + 1)).replace("{total}", String(total))}
            </span>
            <Button
              variant="ghost" size="icon" className="h-9 w-9"
              onClick={() => setIndex((i) => Math.min(total - 1, i + 1))} disabled={index >= total - 1}
              aria-label={t("translate.next_page", "اگلا صفحہ")}
            >
              <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            </Button>
          </div>
        )}
        <span className={cn("ms-auto text-xs", uncertain ? "text-warning" : "text-muted-foreground")}>
          {uncertain
            ? t("extract.uncertain_count", "{n} غیر یقینی الفاظ پیلے ہیں — تصویر سے ملا لیں").replace("{n}", String(uncertain))
            : t("extract.uncertain_none", "اس صفحے پر کوئی غیر یقینی لفظ نہیں")}
        </span>
      </div>
      <div className="grid md:grid-cols-2">
        <div className="flex items-start justify-center border-b border-border bg-muted p-2 md:border-b-0 md:border-e">
          <img
            src={images[index]}
            alt={t("extract.page_image", "صفحہ {n} کی تصویر").replace("{n}", String(index + 1))}
            className="max-h-[70vh] w-full rounded object-contain"
          />
        </div>
        <p dir={dir} className="max-h-[70vh] overflow-y-auto whitespace-pre-wrap p-4 text-start text-base leading-loose">
          {runs.map((run, i) =>
            run.uncertain ? (
              <mark key={i} className="rounded bg-warning-soft px-0.5 text-foreground ring-1 ring-warning-border">
                {run.text}
                <span className="sr-only"> ({t("extract.uncertain", "غیر یقینی")})</span>
              </mark>
            ) : (
              <span key={i}>{run.text}</span>
            ),
          )}
        </p>
      </div>
    </div>
  );
}
