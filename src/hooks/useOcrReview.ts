import { useState, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { renderPdfPages } from "@/lib/ocr/pdfRenderer";

export interface OcrPageData {
  pageNum: number;
  imageBase64: string;
  ocrText: string;
  reviewed: boolean;
}

interface UseOcrReviewReturn {
  pages: OcrPageData[];
  currentPage: number;
  totalPages: number;
  isProcessing: boolean;
  processingPage: number;
  error: string | null;
  setCurrentPage: (page: number) => void;
  updatePageText: (pageNum: number, text: string) => void;
  markReviewed: (pageNum: number) => void;
  loadPdf: (file: File) => Promise<void>;
  processCurrentPage: () => Promise<void>;
  processAllPages: () => Promise<void>;
  getFullText: () => string;
  cancelProcessing: () => void;
}

export function useOcrReview(): UseOcrReviewReturn {
  const { session } = useAuth();
  const [pages, setPages] = useState<OcrPageData[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingPage, setProcessingPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pdfFileRef = useRef<File | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadPdf = useCallback(async (file: File) => {
    pdfFileRef.current = file;
    setError(null);
    setIsProcessing(true);

    try {
      const pagesData: OcrPageData[] = [];
      const controller = new AbortController();
      abortRef.current = controller;

      for await (const result of renderPdfPages(file, { dpi: 150, quality: 0.8, signal: controller.signal })) {
        pagesData.push({
          pageNum: result.pageNum,
          imageBase64: result.imageBase64,
          ocrText: "",
          reviewed: false,
        });
        setTotalPages(result.totalPages);
      }

      setPages(pagesData);
      setCurrentPage(1);
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(err.message);
      }
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const ocrSinglePage = useCallback(async (pageData: OcrPageData): Promise<string> => {
    if (!session?.access_token) throw new Error("Not authenticated");

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-ocr`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          imageBase64: pageData.imageBase64,
          mimeType: "image/jpeg",
        }),
      },
    );

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `OCR failed (${response.status})`);
    }

    const data = await response.json();
    return data.text || "";
  }, [session]);

  const processCurrentPage = useCallback(async () => {
    const page = pages.find((p) => p.pageNum === currentPage);
    if (!page) return;

    setIsProcessing(true);
    setProcessingPage(currentPage);
    setError(null);

    try {
      const text = await ocrSinglePage(page);
      setPages((prev) =>
        prev.map((p) => (p.pageNum === currentPage ? { ...p, ocrText: text } : p)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "OCR failed");
    } finally {
      setIsProcessing(false);
      setProcessingPage(0);
    }
  }, [pages, currentPage, ocrSinglePage]);

  const processAllPages = useCallback(async () => {
    setIsProcessing(true);
    setError(null);

    try {
      for (const page of pages) {
        if (abortRef.current?.signal.aborted) break;
        if (page.ocrText) continue;

        setProcessingPage(page.pageNum);
        const text = await ocrSinglePage(page);
        setPages((prev) =>
          prev.map((p) => (p.pageNum === page.pageNum ? { ...p, ocrText: text } : p)),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "OCR failed");
    } finally {
      setIsProcessing(false);
      setProcessingPage(0);
    }
  }, [pages, ocrSinglePage]);

  const updatePageText = useCallback((pageNum: number, text: string) => {
    setPages((prev) =>
      prev.map((p) => (p.pageNum === pageNum ? { ...p, ocrText: text } : p)),
    );
  }, []);

  const markReviewed = useCallback((pageNum: number) => {
    setPages((prev) =>
      prev.map((p) => (p.pageNum === pageNum ? { ...p, reviewed: true } : p)),
    );
  }, []);

  const getFullText = useCallback(() => {
    return pages
      .filter((p) => p.ocrText)
      .map((p) => `--- Page ${p.pageNum} ---\n${p.ocrText}`)
      .join("\n\n");
  }, [pages]);

  const cancelProcessing = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setIsProcessing(false);
    setProcessingPage(0);
  }, []);

  return {
    pages,
    currentPage,
    totalPages,
    isProcessing,
    processingPage,
    error,
    setCurrentPage,
    updatePageText,
    markReviewed,
    loadPdf,
    processCurrentPage,
    processAllPages,
    getFullText,
    cancelProcessing,
  };
}
