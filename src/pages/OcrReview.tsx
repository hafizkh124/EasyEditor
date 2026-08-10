import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Upload, Loader2, CheckCircle2,
  FileText, Sparkles, ArrowLeft, Copy, Download,
} from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useLanguage } from "@/contexts/LanguageContext";
import { useOcrReview } from "@/hooks/useOcrReview";
import { useSeo } from "@/hooks/useSeo";
import { isRtlText } from "@/utils/textUtils";
import { cn } from "@/lib/utils";
import { editorRoute } from "@/lib/routes";

const OcrReview = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const review = useOcrReview();
  const [isMobile] = useState(() => window.innerWidth < 768);

  useSeo({ title: "OCR Review — Easy Editor", description: "Review and edit your digitized document page by page — correct recognized Urdu, Arabic and English text before exporting.", path: "/ocr/review", noindex: true });

  const currentPageData = review.pages.find((p) => p.pageNum === review.currentPage);
  const reviewedCount = review.pages.filter((p) => p.reviewed).length;
  const isRtl = isRtlText(currentPageData?.ocrText ?? "");

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      toast.error(t("ocr.invalid_file"));
      return;
    }
    await review.loadPdf(file);
  };

  const handleProcessAndMoveNext = async () => {
    if (!currentPageData?.ocrText) {
      await review.processCurrentPage();
    }
    review.markReviewed(review.currentPage);
    if (review.currentPage < review.totalPages) {
      review.setCurrentPage(review.currentPage + 1);
    }
  };

  const handleCopyAll = () => {
    const text = review.getFullText();
    navigator.clipboard.writeText(text);
    toast.success(t("ocr.copied"));
  };

  const handleOpenInEditor = () => {
    navigate(editorRoute(), { state: { content: review.getFullText(), source: "ocr" } });
  };

  const handleExport = () => {
    const text = review.getFullText();
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ocr-review.txt";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("editor.exported"));
  };

  /* ── Empty state — no PDF loaded ── */
  if (review.totalPages === 0) {
    return (
      <AppLayout>
        <div className="flex flex-col h-[calc(100vh-3.5rem-5rem)] md:h-[calc(100vh-3.5rem)] items-center justify-center p-8">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
            <FileText className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold mb-2">{t("ocr_review.title")}</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-md text-center">{t("ocr_review.upload_hint")}</p>

          {review.isProcessing ? (
            <div className="flex items-center gap-2 text-primary">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">{t("ocr_review.loading_pdf")}</span>
            </div>
          ) : (
            <Button onClick={() => fileInputRef.current?.click()} className="gap-2">
              <Upload className="h-4 w-4" />
              {t("ocr_review.upload_pdf")}
            </Button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </AppLayout>
    );
  }

  /* ── Main review layout ── */
  const progressPercent = review.totalPages > 0 ? (reviewedCount / review.totalPages) * 100 : 0;

  const leftPanel = (
    <ScrollArea className="h-full">
      <div className="p-4 flex items-center justify-center min-h-full">
        {currentPageData?.imageBase64 ? (
          <img
            src={`data:image/jpeg;base64,${currentPageData.imageBase64}`}
            alt={`Page ${review.currentPage}`}
            className="max-w-full rounded-lg border border-border shadow-sm"
          />
        ) : (
          <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
            {t("ocr_review.no_preview")}
          </div>
        )}
      </div>
    </ScrollArea>
  );

  const rightPanel = (
    <div className="flex flex-col h-full">
      {/* OCR action bar */}
      <div className="p-3 border-b border-border flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          variant="default"
          className="gap-1.5 text-xs"
          onClick={() => review.processCurrentPage()}
          disabled={review.isProcessing}
        >
          {review.isProcessing && review.processingPage === review.currentPage ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {t("ocr_review.extract_page")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs"
          onClick={() => review.processAllPages()}
          disabled={review.isProcessing}
        >
          {t("ocr_review.extract_all")}
        </Button>
        <div className="flex-1" />
        {currentPageData?.reviewed && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t("ocr_review.reviewed")}
          </span>
        )}
      </div>

      {/* Editable text area */}
      <div className="flex-1 p-3">
        <Textarea
          value={currentPageData?.ocrText ?? ""}
          onChange={(e) => review.updatePageText(review.currentPage, e.target.value)}
          dir={isRtl ? "rtl" : "ltr"}
          className={cn(
            "h-full min-h-[300px] resize-none text-sm leading-relaxed",
            isRtl && "text-right",
          )}
          placeholder={t("ocr_review.text_placeholder")}
        />
      </div>

      {/* Review + Next button */}
      <div className="p-3 border-t border-border">
        <Button className="w-full gap-2" onClick={handleProcessAndMoveNext} disabled={review.isProcessing}>
          <CheckCircle2 className="h-4 w-4" />
          {review.currentPage < review.totalPages
            ? t("ocr_review.review_next")
            : t("ocr_review.finish")}
        </Button>
      </div>
    </div>
  );

  return (
    <AppLayout>
      <div className="flex flex-col h-[calc(100vh-3.5rem-5rem)] md:h-[calc(100vh-3.5rem)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-background/80 backdrop-blur-sm">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/ocr")} aria-label="Back to OCR">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-base font-semibold text-foreground flex-1">{t("ocr_review.title")}</h1>

          {/* Page nav */}
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost" size="icon" className="h-8 w-8"
              disabled={review.currentPage <= 1}
              onClick={() => review.setCurrentPage(review.currentPage - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium tabular-nums min-w-[4rem] text-center">
              {review.currentPage} / {review.totalPages}
            </span>
            <Button
              variant="ghost" size="icon" className="h-8 w-8"
              disabled={review.currentPage >= review.totalPages}
              onClick={() => review.setCurrentPage(review.currentPage + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={handleCopyAll} aria-label="Copy all text">
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={handleOpenInEditor} aria-label="Open in editor">
              <FileText className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={handleExport} aria-label="Export">
              <Download className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="px-4 py-1.5 border-b border-border bg-muted/60">
          <div className="flex items-center gap-3 max-w-full">
            <Progress value={progressPercent} className="h-1.5 flex-1" />
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {reviewedCount}/{review.totalPages} {t("ocr_review.pages_reviewed")}
            </span>
          </div>
        </div>

        {/* Main content — side-by-side on desktop, stacked on mobile */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {isMobile ? (
            <div className="flex flex-col h-full">
              <div className="h-1/2 border-b border-border overflow-hidden">{leftPanel}</div>
              <div className="h-1/2 overflow-hidden">{rightPanel}</div>
            </div>
          ) : (
            <ResizablePanelGroup direction="horizontal">
              <ResizablePanel defaultSize={50} minSize={30}>
                {leftPanel}
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={50} minSize={30}>
                {rightPanel}
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default OcrReview;
