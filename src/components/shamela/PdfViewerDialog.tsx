import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  ChevronRight,
  ChevronLeft,
  ZoomIn,
  ZoomOut,
  Loader2,
  FileText,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getBookPdfInfo, readBookPdf } from "@/lib/shamela/shamelaPdf";
import { openPdfDocument, renderPdfPage, type PdfPageRenderResult } from "@/lib/shamela/pdfRender";
import { useLanguage } from "@/contexts/LanguageContext";
import { translateStored } from "@/lib/i18n";

interface PdfViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookId: string | number;
  title: string;
  author?: string | null;
}

/**
 * SPEC-M6 Phase 10 — in-app PDF viewer.
 *
 * Reads the book's PDF through the native bridge, renders pages with pdfjs,
 * and offers paging + zoom. Falls back to the OCR-free page renderer so the
 * viewer stays independent of the OCR pipeline.
 */
export const PdfViewerDialog: React.FC<PdfViewerDialogProps> = ({
  open,
  onOpenChange,
  bookId,
  title,
  author,
}) => {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<Awaited<ReturnType<typeof openPdfDocument>> | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load the PDF when the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      setPage(1);
      setZoom(1);
      try {
        const info = await getBookPdfInfo(bookId);
        if (cancelled) return;
        if (!info.available || info.files.length === 0) {
          setError(translateStored("reader.pdf_missing"));
          return;
        }
        const bytes = await readBookPdf(bookId, info.files[0].fileIndex);
        if (!bytes || cancelled) return;
        const pdf = await openPdfDocument(bytes);
        if (cancelled) {
          await pdf.destroy();
          return;
        }
        setDoc(pdf);
        setNumPages(pdf.numPages);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : translateStored("reader.pdf_open_failed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();

    return () => {
      cancelled = true;
      setDoc((prev) => {
        void prev?.destroy();
        return null;
      });
    };
  }, [open, bookId]);

  // Render the current page at the current zoom.
  const render = useCallback(async () => {
    if (!doc || !canvasRef.current) return;
    setRendering(true);
    try {
      const result: PdfPageRenderResult = await renderPdfPage(
        doc,
        page,
        canvasRef.current,
        720 * zoom,
      );
      setNumPages(result.numPages);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : translateStored("reader.pdf_render_failed"));
    } finally {
      setRendering(false);
    }
  }, [doc, page, zoom]);

  useEffect(() => {
    if (!open) return;
    void render();
  }, [open, render]);

  const close = () => {
    onOpenChange(false);
  };

  const goToPage = (next: number) => {
    setPage(() => Math.min(Math.max(1, next), numPages || 1));
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col",
        !open && "pointer-events-none invisible opacity-0 transition-opacity",
        open && "opacity-100",
      )}
      role="dialog"
      aria-modal="true"
      aria-label={t("reader.pdf_dialog").replace("{title}", title)}
    >
      {/* Header */}
      <header className="flex items-center gap-2 px-3 h-11 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate leading-tight">{title}</p>
            {author && (
              <p className="text-xs text-muted-foreground truncate leading-tight">{author}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => goToPage(page - 1)} disabled={page <= 1} title={t("reader.previous_page")} aria-label={t("reader.previous_page")}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground px-1 tabular-nums whitespace-nowrap">
            {page} / {numPages || "…"}
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => goToPage(page + 1)} disabled={page >= numPages} title={t("reader.next_page")} aria-label={t("reader.next_page")}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="w-px h-4 bg-border mx-1" />
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} title={t("reader.zoom_out")} aria-label={t("reader.zoom_out")}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground px-1 tabular-nums whitespace-nowrap w-11 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom((z) => Math.min(3, z + 0.25))} title={t("reader.zoom_in")} aria-label={t("reader.zoom_in")}>
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>

        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={close} title={t("reader.close_pdf")} aria-label={t("reader.close_pdf")}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto bg-muted/60">
        {loading ? (
          <div className="h-full flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("reader.opening_pdf")}
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
            <FileText className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground max-w-xs">{error}</p>
          </div>
        ) : (
          <div className="min-h-full flex items-start justify-center p-4">
            <div className="relative">
              {rendering && (
                <div className="absolute -top-8 start-0 text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("reader.rendering_pdf")}
                </div>
              )}
              <canvas
                ref={canvasRef}
                className="rounded-sm shadow-sm bg-white border border-border/50"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
