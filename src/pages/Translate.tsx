import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Languages, ChevronLeft, ChevronRight, Upload, FileText, Image as ImageIcon,
  Type, Loader2, Copy, Download, ArrowLeft, CheckCircle2, ArrowRightLeft,
} from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import TranslationOutput from "@/components/translate/TranslationOutput";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTranslation, type TranslationInputType } from "@/hooks/useTranslation";
import { useSeo } from "@/hooks/useSeo";
import { cn } from "@/lib/utils";
import { isRtlText } from "@/utils/textUtils";

const LANGUAGES = [
  { value: "auto", label: "Auto-detect" },
  { value: "ur", label: "اردو (Urdu)" },
  { value: "ar", label: "العربية (Arabic)" },
  { value: "en", label: "English" },
  { value: "fa", label: "فارسی (Persian)" },
  { value: "pa", label: "پنجابی (Punjabi)" },
  { value: "ps", label: "پښتو (Pashto)" },
];

const TARGET_LANGUAGES = LANGUAGES.filter((l) => l.value !== "auto");

const INPUT_TYPES: { key: TranslationInputType; icon: typeof Type; labelKey: string }[] = [
  { key: "text", icon: Type, labelKey: "translate.input_text" },
  { key: "pdf", icon: FileText, labelKey: "translate.input_pdf" },
  { key: "image", icon: ImageIcon, labelKey: "translate.input_image" },
];

const Translate = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const trans = useTranslation();
  const [sourceText, setSourceText] = useState("");
  const [isMobile] = useState(() => window.innerWidth < 768);

  useSeo({ title: "Translate — Easy Editor", description: "Translate text, PDFs, and images with AI, voice, or manual input.", path: "/translate" });

  const currentPageData = trans.pages.find((p) => p.pageNum === trans.currentPage);
  const completedCount = trans.pages.filter((p) => p.completed).length;

  const handleInputTypeChange = (type: TranslationInputType) => {
    trans.setInputType(type);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (trans.inputType === "pdf") {
      if (file.type !== "application/pdf") {
        toast.error(t("ocr.invalid_file"));
        return;
      }
      await trans.loadPdf(file);
    } else if (trans.inputType === "image") {
      if (!file.type.startsWith("image/")) {
        toast.error(t("ocr.invalid_file"));
        return;
      }
      await trans.loadImage(file);
    }
  };

  const handleTextSubmit = () => {
    if (!sourceText.trim()) return;
    trans.loadText(sourceText);
  };

  const handleTranslateAi = async () => {
    try {
      await trans.translateCurrentPage();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Translation failed");
    }
  };

  const handleVoiceResult = (_base64Audio: string) => {
    toast.info(t("translate.voice_processing"));
    // Voice transcription would call the transcribe edge function here
    // For now, we show a notification
  };

  const handleCompleteAndNext = () => {
    trans.markCompleted(trans.currentPage);
    if (trans.currentPage < trans.totalPages) {
      trans.setCurrentPage(trans.currentPage + 1);
    }
  };

  const handleCopyAll = () => {
    navigator.clipboard.writeText(trans.getFullTranslation());
    toast.success(t("editor.copied"));
  };

  const handleOpenInEditor = () => {
    navigate("/editor", { state: { content: trans.getFullTranslation(), source: "manual" } });
  };

  const handleExport = () => {
    const text = trans.getFullTranslation();
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "translation.txt";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("editor.exported"));
  };

  /* ── Upload/Input state — no content loaded ── */
  if (trans.totalPages === 0) {
    return (
      <AppLayout>
        <div className="flex flex-col h-[calc(100vh-3.5rem-5rem)] md:h-[calc(100vh-3.5rem)] overflow-y-auto">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/80 backdrop-blur-sm">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Languages className="h-5 w-5 text-primary" />
            <h1 className="text-base font-semibold">{t("translate.title")}</h1>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-lg mx-auto w-full">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
              <Languages className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold mb-2">{t("translate.title")}</h2>
            <p className="text-sm text-muted-foreground mb-8 text-center">{t("translate.subtitle")}</p>

            {/* Input type selector */}
            <div className="flex gap-2 mb-6 w-full">
              {INPUT_TYPES.map((it) => (
                <Button
                  key={it.key}
                  variant={trans.inputType === it.key ? "default" : "outline"}
                  className="flex-1 gap-2 text-xs h-10"
                  onClick={() => handleInputTypeChange(it.key)}
                >
                  <it.icon className="h-4 w-4" />
                  {t(it.labelKey)}
                </Button>
              ))}
            </div>

            {/* Language selectors */}
            <div className="flex items-center gap-2 mb-6 w-full">
              <Select value={trans.sourceLanguage} onValueChange={trans.setSourceLanguage}>
                <SelectTrigger className="flex-1 h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ArrowRightLeft className="h-4 w-4 text-muted-foreground shrink-0" />
              <Select value={trans.targetLanguage} onValueChange={trans.setTargetLanguage}>
                <SelectTrigger className="flex-1 h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_LANGUAGES.map((l) => (
                    <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Input based on type */}
            {trans.inputType === "text" && (
              <div className="w-full space-y-3">
                <Textarea
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                  dir={isRtlText(sourceText) ? "rtl" : "ltr"}
                  className={cn("min-h-[160px] resize-none", isRtlText(sourceText) && "text-right")}
                  placeholder={t("translate.text_placeholder")}
                />
                <Button onClick={handleTextSubmit} disabled={!sourceText.trim()} className="w-full gap-2">
                  <Languages className="h-4 w-4" />
                  {t("translate.start_translation")}
                </Button>
              </div>
            )}

            {(trans.inputType === "pdf" || trans.inputType === "image") && (
              <div className="w-full space-y-3">
                {trans.isProcessing ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-primary">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-sm">{t("translate.loading")}</span>
                  </div>
                ) : (
                  <Button onClick={() => fileInputRef.current?.click()} variant="outline" className="w-full h-24 border-dashed gap-2 flex-col">
                    <Upload className="h-6 w-6 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {trans.inputType === "pdf" ? t("translate.upload_pdf") : t("translate.upload_image")}
                    </span>
                  </Button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={trans.inputType === "pdf" ? "application/pdf" : "image/*"}
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>
            )}
          </div>
        </div>
      </AppLayout>
    );
  }

  /* ── Main translation layout ── */
  const progressPercent = trans.totalPages > 0 ? (completedCount / trans.totalPages) * 100 : 0;
  const isRtlSource = isRtlText(currentPageData?.sourceText ?? "");

  const leftPanel = (
    <ScrollArea className="h-full">
      <div className="p-4">
        {currentPageData?.imageBase64 ? (
          <img
            src={`data:image/jpeg;base64,${currentPageData.imageBase64}`}
            alt={`Page ${trans.currentPage}`}
            className="max-w-full rounded-lg border border-border shadow-sm mx-auto"
          />
        ) : currentPageData?.sourceText ? (
          <div
            dir={isRtlSource ? "rtl" : "ltr"}
            className={cn("prose prose-sm dark:prose-invert max-w-none p-4 rounded-lg border border-border bg-muted/20 min-h-[200px]", isRtlSource && "text-right")}
          >
            {currentPageData.sourceText}
          </div>
        ) : (
          <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
            {t("ocr_review.no_preview")}
          </div>
        )}
      </div>
    </ScrollArea>
  );

  const rightPanel = (
    <TranslationOutput
      translationText={currentPageData?.translationText ?? ""}
      streamingText={trans.streamingText}
      isTranslating={trans.isTranslating}
      onTranslateAi={handleTranslateAi}
      onUpdateText={(text) => trans.updateTranslation(trans.currentPage, text)}
      onVoiceResult={handleVoiceResult}
      t={t}
    />
  );

  return (
    <AppLayout>
      <div className="flex flex-col h-[calc(100vh-3.5rem-5rem)] md:h-[calc(100vh-3.5rem)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-background/80 backdrop-blur-sm">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Languages className="h-4 w-4 text-primary" />
          <h1 className="text-base font-semibold flex-1">{t("translate.title")}</h1>

          {/* Page nav (for multi-page) */}
          {trans.totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="icon" className="h-8 w-8"
                disabled={trans.currentPage <= 1}
                onClick={() => trans.setCurrentPage(trans.currentPage - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium tabular-nums min-w-[4rem] text-center">
                {trans.currentPage} / {trans.totalPages}
              </span>
              <Button variant="ghost" size="icon" className="h-8 w-8"
                disabled={trans.currentPage >= trans.totalPages}
                onClick={() => trans.setCurrentPage(trans.currentPage + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={handleCopyAll}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={handleOpenInEditor}>
              <FileText className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={handleExport}>
              <Download className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Progress (multi-page) */}
        {trans.totalPages > 1 && (
          <div className="px-4 py-1.5 border-b border-border bg-muted/20">
            <div className="flex items-center gap-3">
              <Progress value={progressPercent} className="h-1.5 flex-1" />
              <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                {completedCount}/{trans.totalPages} {t("translate.pages_done")}
              </span>
            </div>
          </div>
        )}

        {/* Complete & Next bar */}
        <div className="px-4 py-2 border-b border-border flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{t("translate.source")}: {LANGUAGES.find((l) => l.value === trans.sourceLanguage)?.label ?? trans.sourceLanguage}</span>
            <ArrowRightLeft className="h-3 w-3" />
            <span>{t("translate.target")}: {TARGET_LANGUAGES.find((l) => l.value === trans.targetLanguage)?.label ?? trans.targetLanguage}</span>
          </div>
          <div className="flex-1" />
          {currentPageData?.completed && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
            </span>
          )}
          <Button size="sm" className="gap-1.5 text-xs" onClick={handleCompleteAndNext}>
            <CheckCircle2 className="h-3.5 w-3.5" />
            {trans.currentPage < trans.totalPages ? t("translate.complete_next") : t("translate.complete")}
          </Button>
        </div>

        {/* Side-by-side */}
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

export default Translate;
