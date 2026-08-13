import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useLimitReached } from "@/hooks/useLimitReached";
import { useCanAfford } from "@/hooks/useTokenBalance";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePageSession } from "@/hooks/usePageSession";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { logActivity } from "@/lib/activityLog";
import { getDocumentType, getMaxFileSize, MAX_PDF_PAGES } from "@/lib/ocr/documentFormats";
import { renderPdfPages, getPdfPageCount } from "@/lib/ocr/pdfRenderer";

const log = logger.child("OCR");

/**
 * The OCR page's workflow: validate an incoming file, branch to image or PDF
 * mode, run extraction against the process-ocr edge function, then publish,
 * refine and persist the text.
 *
 * Extracted from OCR.tsx so the page is layout only. Covered by
 * src/test/ocrPage.test.tsx, which drives it through the rendered page.
 */
export function useOcrWorkflow() {
  const { user, session } = useAuth();
  const { t } = useLanguage();
  const { subscription, refetch } = useSubscription();
  const navigate = useNavigate();

  const { used: ocrPagesUsed } = useLimitReached("ocr");
  const { canAfford: canAffordOcr } = useCanAfford("ocr", 1);
  const ocrLimitReached = !canAffordOcr;

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
        log.info("incrementing OCR usage", { hasUser: Boolean(user.id) });
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
        toast.success(t(`ocr.${action}_done` as import("@/lib/i18n").TranslationKey));
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


  return {
    // intake
    imagePreview, imageBase64, imageMimeType, isDragOver, isCropping,
    handleFile, handleFileInput, handleDragOver, handleDragLeave, handleDrop,
    handleCropComplete, clearImage, setIsCropping,
    // pdf
    isPdfMode, pdfFile, pdfPageCount, currentPdfPage, pdfProcessing,
    // extraction
    extractedText, setExtractedText, isProcessing, handleExtract,
    isRefining, activeRefineAction, handleRefine,
    // output
    autoCopy, toggleAutoCopy, handleCopy, handleListenNow,
    // gating
    ocrLimitReached, subscription, user, session, t, navigate,
    fileInputRef, cameraInputRef, pdfAbortRef,
  };
}
