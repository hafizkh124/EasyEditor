import { useState, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { renderPdfPages } from "@/lib/ocr/pdfRenderer";

export type TranslationInputType = "text" | "pdf" | "image";
export type TranslationMode = "ai" | "voice" | "manual";

export interface TranslationPageData {
  pageNum: number;
  imageBase64?: string;
  sourceText?: string;
  translationText: string;
  mode: TranslationMode;
  completed: boolean;
}

interface UseTranslationReturn {
  inputType: TranslationInputType;
  setInputType: (type: TranslationInputType) => void;
  pages: TranslationPageData[];
  currentPage: number;
  totalPages: number;
  sourceLanguage: string;
  targetLanguage: string;
  setSourceLanguage: (lang: string) => void;
  setTargetLanguage: (lang: string) => void;
  isProcessing: boolean;
  isTranslating: boolean;
  streamingText: string;
  setCurrentPage: (page: number) => void;
  updateTranslation: (pageNum: number, text: string) => void;
  markCompleted: (pageNum: number) => void;
  loadPdf: (file: File) => Promise<void>;
  loadImage: (file: File) => Promise<void>;
  loadText: (text: string) => void;
  translateCurrentPage: () => Promise<void>;
  cancelTranslation: () => void;
  getFullTranslation: () => string;
}

export function useTranslation(): UseTranslationReturn {
  const { session } = useAuth();
  const [inputType, setInputType] = useState<TranslationInputType>("text");
  const [pages, setPages] = useState<TranslationPageData[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [sourceLanguage, setSourceLanguage] = useState("auto");
  const [targetLanguage, setTargetLanguage] = useState("ur");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const loadText = useCallback((text: string) => {
    setPages([{
      pageNum: 1,
      sourceText: text,
      translationText: "",
      mode: "ai",
      completed: false,
    }]);
    setTotalPages(1);
    setCurrentPage(1);
  }, []);

  const loadImage = useCallback(async (file: File) => {
    setIsProcessing(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      setPages([{
        pageNum: 1,
        imageBase64: base64,
        translationText: "",
        mode: "ai",
        completed: false,
      }]);
      setTotalPages(1);
      setCurrentPage(1);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const loadPdf = useCallback(async (file: File) => {
    setIsProcessing(true);
    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const pagesData: TranslationPageData[] = [];

      for await (const result of renderPdfPages(file, { dpi: 150, quality: 0.8, signal: controller.signal })) {
        pagesData.push({
          pageNum: result.pageNum,
          imageBase64: result.imageBase64,
          translationText: "",
          mode: "ai",
          completed: false,
        });
        setTotalPages(result.totalPages);
      }

      setPages(pagesData);
      setCurrentPage(1);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const translateCurrentPage = useCallback(async () => {
    const page = pages.find((p) => p.pageNum === currentPage);
    if (!page || !session?.access_token) return;

    setIsTranslating(true);
    setStreamingText("");
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const body: Record<string, unknown> = {
        targetLanguage,
        sourceLanguage: sourceLanguage !== "auto" ? sourceLanguage : undefined,
      };

      if (page.imageBase64) {
        body.imageBase64 = page.imageBase64;
        body.mimeType = "image/jpeg";
      } else if (page.sourceText) {
        body.text = page.sourceText;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/translate-page`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Translation failed (${response.status})`);
      }

      const contentType = response.headers.get("content-type") ?? "";

      if (contentType.includes("text/event-stream")) {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") break;
            try {
              const parsed = JSON.parse(payload);
              const chunk = parsed.choices?.[0]?.delta?.content;
              if (chunk) {
                accumulated += chunk;
                setStreamingText(accumulated);
              }
            } catch { /* skip malformed lines */ }
          }
        }

        setPages((prev) =>
          prev.map((p) => (p.pageNum === currentPage ? { ...p, translationText: accumulated } : p)),
        );
      } else {
        const data = await response.json();
        const text = data.translation || data.text || "";
        setPages((prev) =>
          prev.map((p) => (p.pageNum === currentPage ? { ...p, translationText: text } : p)),
        );
        setStreamingText(text);
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        throw err;
      }
    } finally {
      setIsTranslating(false);
    }
  }, [pages, currentPage, session, targetLanguage, sourceLanguage]);

  const updateTranslation = useCallback((pageNum: number, text: string) => {
    setPages((prev) =>
      prev.map((p) => (p.pageNum === pageNum ? { ...p, translationText: text } : p)),
    );
  }, []);

  const markCompleted = useCallback((pageNum: number) => {
    setPages((prev) =>
      prev.map((p) => (p.pageNum === pageNum ? { ...p, completed: true } : p)),
    );
  }, []);

  const getFullTranslation = useCallback(() => {
    return pages
      .filter((p) => p.translationText)
      .map((p) => totalPages > 1 ? `--- Page ${p.pageNum} ---\n${p.translationText}` : p.translationText)
      .join("\n\n");
  }, [pages, totalPages]);

  const cancelTranslation = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setIsTranslating(false);
  }, []);

  return {
    inputType, setInputType,
    pages, currentPage, totalPages,
    sourceLanguage, targetLanguage, setSourceLanguage, setTargetLanguage,
    isProcessing, isTranslating, streamingText,
    setCurrentPage, updateTranslation, markCompleted,
    loadPdf, loadImage, loadText,
    translateCurrentPage, cancelTranslation, getFullTranslation,
  };
}
