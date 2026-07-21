import { useState, useRef, useCallback } from "react";
import { useSeo } from "@/hooks/useSeo";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useLimitReached } from "@/hooks/useLimitReached";
import { useCanAfford } from "@/hooks/useTokenBalance";
import TokenCostBadge from "@/components/TokenCostBadge";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Upload, Camera, Copy, Volume2, Loader2, ImageIcon, X, Crop, SpellCheck, Languages, MessageSquarePlus, FileText } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import AppLayout from "@/components/AppLayout";
import ImageCropper from "@/components/ImageCropper";
import { cn } from "@/lib/utils";
import { logActivity } from "@/lib/activityLog";
import { usePageSession } from "@/hooks/usePageSession";
import { isRtlText } from "@/utils/textUtils";
import { getUpgradeLabelKey } from "@/lib/tierUpgrade";
import { ACCEPTED_OCR, getDocumentType, getMaxFileSize, MAX_PDF_PAGES } from "@/lib/ocr/documentFormats";
import { renderPdfPages, getPdfPageCount } from "@/lib/ocr/pdfRenderer";

const OCR = () => {
  useSeo({ title: "Urdu & Arabic OCR — Islamic Text Digitization", description: "Extract Urdu, Arabic and English text from images and scanned Islamic books with high accuracy. Free Quran-friendly OCR.", path: "/ocr" });

  const { user, session } = useAuth();
  const { t } = useLanguage();
  const { subscription, refetch } = useSubscription();
  const upgradeKey = getUpgradeLabelKey(subscription?.tier);
  const navigate = useNavigate();

  const { used: ocrPagesUsed, limit: ocrPagesLimitRaw, reached: legacyOcrLimitReached } = useLimitReached("ocr");
  const { canAfford: canAffordOcr } = useCanAfford("ocr", 1);
  const ocrLimitReached = !canAffordOcr;
  void ocrPagesLimitRaw; // legacy limit no longer surfaced — token meter handles it
  void legacyOcrLimitReached; // legacy per-tier column no longer gates — token wallet does
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<string>("image/jpeg");
  const [extractedText, setExtractedText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [activeRefineAction, setActiveRefineAction] = useState<"spelling_check" | "normalize_script" | null>(null);
  const [isCropping, setIsCropping] = useState(false);
  const [autoCopy, setAutoCopy] = useState(() => localStorage.getItem("ocr-autocopy") === "true");
  const [isDragOver, setIsDragOver] = useState(false);
  // PDF-specific state
  const [isPdfMode, setIsPdfMode] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [currentPdfPage, setCurrentPdfPage] = useState(0);
  const [pdfProcessing, setPdfProcessing] = useState(false);
  const pdfAbortRef = useRef<AbortController | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleRestoreSession = useCallback((metadata: { extractedText?: string }) => {
    if (typeof metadata.extractedText === "string") setExtractedText(metadata.extractedText);
  }, []);
  const { save: saveSession } = usePageSession<{ extractedText: string }>({
    section: "ocr",
    onRestore: handleRestoreSession,
  });

  const setImageFromDataUrl = useCallback((dataUrl: string, mimeType?: string) => {
    setImagePreview(dataUrl);
    const base64 = dataUrl.split(",")[1];
    setImageBase64(base64);
    if (mimeType) setImageMimeType(mimeType);
    setExtractedText("");
    setIsCropping(false);
  }, []);

  const handleFile = useCallback(async (file: File) => {
    const docType = getDocumentType(file);

    if (docType === "unsupported") {
      toast.error(t("ocr.invalid_file"));
      return;
    }

    const maxSize = getMaxFileSize(docType);
    if (file.size > maxSize) {
      toast.error(t("ocr.file_too_large"));
      return;
    }

    if (docType === "pdf") {
      // PDF mode: load page count and show PDF preview
      try {
        const pageCount = await getPdfPageCount(file);
        if (pageCount > MAX_PDF_PAGES) {
          toast.error(t("ocr.pdf_page_limit").replace("{n}", String(MAX_PDF_PAGES)));
          return;
        }
        setPdfFile(file);
        setPdfPageCount(pageCount);
        setIsPdfMode(true);
        setImagePreview(null);
        setImageBase64(null);
        setExtractedText("");
        setCurrentPdfPage(0);
        toast.info(t("ocr.pdf_loaded").replace("{n}", String(pageCount)));
      } catch {
        toast.error(t("ocr.error"));
      }
      return;
    }

    // Image mode (existing flow)
    setIsPdfMode(false);
    setPdfFile(null);
    setPdfPageCount(0);

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setImageFromDataUrl(dataUrl, file.type);
    };
    reader.readAsDataURL(file);
  }, [t, setImageFromDataUrl]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  // Drag & Drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const clearImage = () => {
    setImagePreview(null);
    setImageBase64(null);
    setExtractedText("");
    setIsCropping(false);
    // Clear PDF state
    setIsPdfMode(false);
    setPdfFile(null);
    setPdfPageCount(0);
    setCurrentPdfPage(0);
    setPdfProcessing(false);
    pdfAbortRef.current?.abort();
    pdfAbortRef.current = null;
  };

  const handleCropComplete = (croppedDataUrl: string) => {
    setImageFromDataUrl(croppedDataUrl, "image/jpeg");
  };

  /** Send a single image (base64) to the OCR edge function and return extracted text. */
  const ocrSingleImage = async (base64: string, mimeType: string): Promise<string> => {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-ocr`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${session!.access_token}`,
        },
        body: JSON.stringify({ imageBase64: base64, mimeType }),
      },
    );

    if (!response.ok) {
      const errData = await response.json().catch(() => ({ error: "Unknown error" }));
      if (response.status === 429) throw new Error("rate_limited");
      throw new Error(errData.error || "OCR failed");
    }

    const data = await response.json();
    return data.text || "";
  };

  const handleExtract = async () => {
    if (!session?.access_token) return;
    if (ocrLimitReached) {
      toast.error(t("ocr.limit_reached"));
      return;
    }

    // ── PDF multi-page processing ──
    if (isPdfMode && pdfFile) {
      setPdfProcessing(true);
      setIsProcessing(true);
      const controller = new AbortController();
      pdfAbortRef.current = controller;
      const parts: string[] = [];

      try {
        for await (const page of renderPdfPages(pdfFile, { signal: controller.signal })) {
          if (controller.signal.aborted) break;
          setCurrentPdfPage(page.pageNum);

          const text = await ocrSingleImage(page.imageBase64, page.mimeType);
          if (text.trim()) {
            parts.push(`--- ${t("ocr.page_label") || "Page"} ${page.pageNum} ---\n${text}`);
          }
          // Show incremental results
          setExtractedText(parts.join("\n\n"));
        }

        const fullText = parts.join("\n\n").trim();
        setExtractedText(fullText);

        if (!fullText) {
          toast.info(t("ocr.no_text_found"));
        } else {
          toast.success(t("ocr.pdf_success").replace("{n}", String(pdfPageCount)));
          logActivity("ocr", fullText.slice(0, 60));
          saveSession({ title: fullText.slice(0, 80), metadata: { extractedText: fullText } });
          if (autoCopy) {
            await navigator.clipboard.writeText(fullText);
            toast.info(t("ocr.auto_copied"));
          }
        }

        // Increment usage counter by number of pages processed
        if (user) {
          const pagesProcessed = parts.length || 1;
          const { error } = await supabase
            .from("subscriptions")
            .update({ ocr_pages_used: ocrPagesUsed + pagesProcessed })
            .eq("user_id", user.id);
          if (!error) refetch();
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          const msg = err instanceof Error ? err.message : "";
          toast.error(msg === "rate_limited" ? t("ocr.limit_reached") : t("ocr.error"));
        }
      } finally {
        setPdfProcessing(false);
        setIsProcessing(false);
        pdfAbortRef.current = null;
      }
      return;
    }

    // ── Single image processing (existing flow) ──
    if (!imageBase64) return;
    setIsProcessing(true);

    try {
      const text = await ocrSingleImage(imageBase64, imageMimeType);
      setExtractedText(text);

      if (!text.trim()) {
        toast.info(t("ocr.no_text_found"));
      } else {
        toast.success(t("ocr.success"));
        logActivity("ocr", text.slice(0, 60));
        saveSession({ title: text.slice(0, 80), metadata: { extractedText: text } });
        if (autoCopy) {
          await navigator.clipboard.writeText(text);
          toast.info(t("ocr.auto_copied"));
        }
      }

      // Increment usage counter and sync context
      if (user) {
        console.log("[OCR] Incrementing ocr_pages_used for user:", user.id);
        const { error } = await supabase
          .from("subscriptions")
          .update({ ocr_pages_used: ocrPagesUsed + 1 })
          .eq("user_id", user.id);
        if (!error) refetch();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg === "rate_limited" ? t("ocr.limit_reached") : t("ocr.error"));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(extractedText);
      toast.success(t("ocr.copied"));
    } catch {
      toast.error(t("ocr.copy_failed"));
    }
  };

  const handleListenNow = () => {
    navigate("/speak", { state: { text: extractedText } });
  };

  const handleRefine = async (action: "spelling_check" | "normalize_script") => {
    if (!extractedText.trim() || !session?.access_token) return;
    setIsRefining(true);
    setActiveRefineAction(action);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/refine-text`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ text: extractedText, action }),
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Unknown error" }));
        toast.error(errData.error || t("ocr.refine_error"));
        return;
      }

      const data = await response.json();
      if (data.text) {
        setExtractedText(data.text);
        saveSession({ title: data.text.slice(0, 80), metadata: { extractedText: data.text } });
        toast.success(t(`ocr.${action}_done`));
      }
    } catch {
      toast.error(t("ocr.refine_error"));
    } finally {
      setIsRefining(false);
      setActiveRefineAction(null);
    }
  };

  const toggleAutoCopy = (checked: boolean) => {
    setAutoCopy(checked);
    localStorage.setItem("ocr-autocopy", String(checked));
  };

  const rtl = isRtlText(extractedText);

  return (
    <AppLayout>
      <div className="p-4 md:p-8 space-y-6 max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground">{t("ocr.title")}</h1>
            <p className="text-muted-foreground mt-1">{t("ocr.subtitle")}</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <TokenCostBadge action="ocr" quantity={1} />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="auto-copy" className="text-xs text-muted-foreground">
                {t("ocr.auto_copy")}
              </Label>
              <Switch id="auto-copy" checked={autoCopy} onCheckedChange={toggleAutoCopy} />
            </div>
            {(imagePreview || extractedText) && (
              <Button variant="outline" size="sm" onClick={clearImage} className="gap-1.5">
                <MessageSquarePlus className="h-3.5 w-3.5" />
                {t("common.new_chat")}
              </Button>
            )}
          </div>
        </div>

        {ocrLimitReached && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center justify-between">
            <span>{t("ocr.limit_reached")}</span>
            {upgradeKey && (
              <Link to="/pricing">
                <Badge variant="destructive" className="cursor-pointer">{t(upgradeKey)}</Badge>
              </Link>
            )}
          </div>
        )}

        {/* PDF Preview Card */}
        {isPdfMode && pdfFile && (
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-muted p-3">
                    <FileText className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-sm truncate max-w-[200px]">{pdfFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("ocr.pdf_loaded").replace("{n}", String(pdfPageCount))}
                    </p>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="icon"
                  className="h-10 w-10"
                  onClick={clearImage}
                  aria-label={t("ocr.remove_image") || "Remove"}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* PDF processing progress */}
              {pdfProcessing && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">
                      {t("ocr.processing_page")
                        .replace("{current}", String(currentPdfPage))
                        .replace("{total}", String(pdfPageCount))}
                    </span>
                  </div>
                  <Progress value={(currentPdfPage / pdfPageCount) * 100} className="h-2" />
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => pdfAbortRef.current?.abort()}
                      className="gap-1.5"
                    >
                      <X className="h-3.5 w-3.5" />
                      {t("stt.cancel")}
                    </Button>
                  </div>
                </div>
              )}

              {!pdfProcessing && (
                <div className="flex flex-col gap-2">
                  <Button
                    onClick={handleExtract}
                    disabled={isProcessing || ocrLimitReached}
                    className="w-full"
                  >
                    {t("ocr.extract")} ({pdfPageCount} {t("ocr.page_label") || "pages"})
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => navigate("/ocr/review")}
                    className="w-full gap-2"
                  >
                    <FileText className="h-4 w-4" />
                    {t("ocr_review.page_review_btn")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Image Upload / Drag-Drop Area */}
        {!imagePreview && !isPdfMode ? (
          <Card
            className={cn(
              "border-dashed border-2 transition-colors",
              isDragOver && "border-primary bg-primary/5"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <CardContent className="p-8 flex flex-col items-center gap-4">
              <div className="rounded-full bg-muted p-4">
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                {isDragOver ? (t("ocr.drop_here") || "Drop image here") : t("ocr.upload_hint")}
              </p>
              <div className="flex gap-3">
                <Button onClick={() => fileInputRef.current?.click()} variant="outline">
                  <Upload className="h-4 w-4" />
                  {t("ocr.upload")}
                </Button>
                <Button onClick={() => cameraInputRef.current?.click()} variant="outline">
                  <Camera className="h-4 w-4" />
                  {t("ocr.camera")}
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_OCR}
                onChange={handleFileInput}
                className="hidden"
                aria-label={t("ocr.upload")}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileInput}
                className="hidden"
                aria-label={t("ocr.camera")}
              />
            </CardContent>
          </Card>
        ) : isCropping && imagePreview ? (
          <Card>
            <CardContent className="p-4">
              <ImageCropper
                imageSrc={imagePreview}
                onCropComplete={handleCropComplete}
                onCancel={() => setIsCropping(false)}
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="relative">
                <img
                  src={imagePreview ?? undefined}
                  alt={t("ocr.uploaded_alt") || "Uploaded document for text extraction"}
                  className="w-full max-h-64 object-contain rounded-lg bg-muted"
                />
                <div className="absolute top-2 end-2 flex gap-1.5">
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-10 w-10"
                    onClick={() => setIsCropping(true)}
                    aria-label={t("ocr.crop_image") || "Crop image"}
                  >
                    <Crop className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    className="h-10 w-10"
                    onClick={clearImage}
                    aria-label={t("ocr.remove_image") || "Remove image"}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <Button
                onClick={handleExtract}
                disabled={isProcessing || ocrLimitReached}
                className="w-full"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("ocr.processing")}
                  </>
                ) : (
                  t("ocr.extract")
                )}
              </Button>
              {isProcessing && <Progress className="h-2" />}
            </CardContent>
          </Card>
        )}

        {/* Extracted Text */}
        {extractedText && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">{t("ocr.result")}</h2>
            <Textarea
              value={extractedText}
              onChange={(e) => setExtractedText(e.target.value)}
              aria-label={t("ocr.result")}
              dir={rtl ? "rtl" : "ltr"}
              className={cn("min-h-[200px] resize-y", rtl && "text-right")}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => handleRefine("spelling_check")}
                variant="outline"
                size="sm"
                disabled={isRefining}
                className="gap-1.5"
              >
                {isRefining && activeRefineAction === "spelling_check" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <SpellCheck className="h-3.5 w-3.5" />
                )}
                {t("ocr.spelling_check")}
              </Button>
              <Button
                onClick={() => handleRefine("normalize_script")}
                variant="outline"
                size="sm"
                disabled={isRefining}
                className="gap-1.5"
              >
                {isRefining && activeRefineAction === "normalize_script" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Languages className="h-3.5 w-3.5" />
                )}
                {t("ocr.normalize_script")}
              </Button>
            </div>
            <div className="flex gap-3 flex-wrap">
              <Button onClick={handleCopy} variant="outline" className="flex-1 sm:flex-none">
                <Copy className="h-4 w-4" />
                {t("ocr.copy")}
              </Button>
              <Button onClick={() => navigate("/editor", { state: { content: extractedText, source: "ocr" } })} variant="outline" className="flex-1 sm:flex-none">
                <FileText className="h-4 w-4" />
                {t("editor.open_in_editor")}
              </Button>
              <Button onClick={handleListenNow} className="flex-1 sm:flex-none">
                <Volume2 className="h-4 w-4" />
                {t("ocr.listen_now")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default OCR;
