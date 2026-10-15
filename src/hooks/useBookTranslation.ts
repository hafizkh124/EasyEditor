import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { TOKEN_COSTS } from "@/contexts/SubscriptionContext";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { supabase } from "@/integrations/supabase/client";
import { renderPdfPages } from "@/lib/ocr/pdfRenderer";
import { translateOnePage } from "@/lib/translate/translatePageApi";
import { getShamelaClient } from "@/core/shamela/shamelaClient";
import { htmlToPlainText } from "@/lib/reader/htmlToPlainText";
import { getBookPdfInfo, readBookPdf } from "@/lib/shamela/shamelaPdf";
import { GENRE_TRANSLATION_PROMPTS } from "@/lib/translationMemory";
import { logger } from "@/lib/logger";

const log = logger.child("useBookTranslation");

export type BookSourceKind = "pdf" | "shamela" | "text" | "image";
export type PageStatus = "pending" | "translating" | "done" | "failed";

export interface BookPage {
  pageNum: number;
  /** `source: "pdf"` — the rendered page image. */
  imageBase64?: string;
  /** `source: "shamela"` — the page's trusted HTML, for `ReaderContent`. */
  sourceHtml?: string;
  /** Plain text sent to `translate-page` for a Shamela page. */
  sourceText?: string;
  translationText: string;
  status: PageStatus;
}

export interface BatchProgress {
  // Shaped to match `ChunkedRunProgress` (src/lib/tasks/chunkOrchestrator.ts)
  // so `ChunkProgressBar.tsx` can be reused as-is for this feature's progress
  // UI too, without depending on that module's refine-text-specific types.
  phase: "preparing" | "running" | "finalizing";
  current: number;
  total: number;
  done: number;
  failed: number;
  skipped: number;
  tokensSpent: number;
  throttled: boolean;
}

export interface BatchEstimate {
  pages: number;
  tokenCost: number;
  estimatedSeconds: number;
}

/** Paced against the server's 30/min limit (translate-page/index.ts), with headroom. */
const DISPATCH_INTERVAL_MS = 2200;
const RETRY_BACKOFF_MS = DISPATCH_INTERVAL_MS * 5;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ExistingChunk {
  source_text: string;
  translated_text: string | null;
  status: string;
}

interface UseBookTranslationOptions {
  /** Called as soon as a project row exists, so the caller can reflect it in the URL. */
  onProjectId?: (projectId: string) => void;
}

export function useBookTranslation(options: UseBookTranslationOptions = {}) {
  const { user, session } = useAuth();
  const tokenBalance = useTokenBalance();

  const [sourceKind, setSourceKind] = useState<BookSourceKind | null>(null);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [pages, setPages] = useState<BookPage[]>([]);
  const [currentPage, setCurrentPageState] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoadingSource, setIsLoadingSource] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [sourceError, setSourceError] = useState<string | null>(null);
  // Only meaningful right after `resumeProject` when the source needs the
  // user to re-supply something — "pdf" (re-upload) vs "text"/"image"/null
  // (those complete in seconds; not worth a resume prompt, just start over).
  const [resumeSourceRef, setResumeSourceRef] = useState<string | null>(null);
  const [resumedShamelaBookId, setResumedShamelaBookId] = useState<string | null>(null);

  const [sourceLanguage, setSourceLanguage] = useState("auto");
  const [targetLanguage, setTargetLanguage] = useState("ur");
  const [genre, setGenre] = useState("general");

  const [isTranslatingSingle, setIsTranslatingSingle] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [batch, setBatch] = useState<BatchProgress | null>(null);

  // Refs mirror state that async loops (render loop, batch loop) need to read
  // without capturing a stale closure — the same reason `useChunkedRuns.ts`
  // keeps its own refs alongside state.
  const pagesRef = useRef<BookPage[]>([]);
  const titleRef = useRef("");
  const projectIdRef = useRef<string | null>(null);
  const sourceMarkerRef = useRef<string>("pdf");
  // "pdf"/"shamela" charge the cheaper batch rate (translate_book); a single
  // pasted text or image is the same one-shot job Quick Translate used to be,
  // so it keeps the regular per-call "translate" rate — see bookMode below.
  const sourceKindRef = useRef<BookSourceKind>("pdf");
  const existingChunksRef = useRef<Map<number, ExistingChunk>>(new Map());
  const batchAbortRef = useRef<AbortController | null>(null);
  const singleAbortRef = useRef<AbortController | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => { pagesRef.current = pages; }, [pages]);

  const setPageStatus = useCallback((pageNum: number, status: PageStatus) => {
    setPages((prev) => prev.map((p) => (p.pageNum === pageNum ? { ...p, status } : p)));
  }, []);

  const setPageResult = useCallback((pageNum: number, text: string, status: PageStatus) => {
    setPages((prev) =>
      prev.map((p) => (p.pageNum === pageNum ? { ...p, translationText: text, status } : p)),
    );
  }, []);

  const updateTranslation = useCallback((pageNum: number, text: string) => {
    setPages((prev) => prev.map((p) => (p.pageNum === pageNum ? { ...p, translationText: text } : p)));
  }, []);

  const ensureProject = useCallback(
    async (explicitTitle: string, sourceRef: string): Promise<string | null> => {
      if (projectIdRef.current) return projectIdRef.current;
      if (!user) {
        setSourceError("پراجیکٹ محفوظ کرنے کے لیے سائن ان ضروری ہے۔");
        return null;
      }
      const { data, error } = await supabase
        .from("translation_projects")
        .insert({
          user_id: user.id,
          title: explicitTitle || "بلا عنوان کتاب",
          source_lang: sourceLanguage !== "auto" ? sourceLanguage : "ar",
          target_lang: targetLanguage,
          genre,
          status: "in_progress",
          source_ref: sourceRef,
        })
        .select("id")
        .single();

      if (error || !data) {
        log.error("Failed to create translation project", { error });
        setSourceError("پراجیکٹ نہیں بن سکا۔");
        return null;
      }
      projectIdRef.current = data.id;
      setProjectId(data.id);
      options.onProjectId?.(data.id);
      return data.id;
    },
    [user, sourceLanguage, targetLanguage, genre, options],
  );

  const persistChunk = useCallback(
    async (pageNum: number, sourceText: string, translatedText: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const { error } = await supabase.from("translation_chunks").upsert(
        {
          project_id: pid,
          chunk_index: pageNum,
          source_text: sourceText || "",
          translated_text: translatedText,
          status: "completed",
        },
        { onConflict: "project_id,chunk_index" },
      );
      if (error) log.error("Failed to persist page translation", { pageNum, error });
    },
    [],
  );

  const loadPdf = useCallback(async (file: File) => {
    const isResuming = !!projectIdRef.current;
    setIsLoadingSource(true);
    setSourceError(null);
    setSourceKind("pdf");
    sourceKindRef.current = "pdf";
    setPages([]);
    setCurrentPageState(1);
    setTotalPages(0);
    setLoadedCount(0);
    sourceMarkerRef.current = "pdf";
    if (!isResuming) {
      existingChunksRef.current = new Map();
      titleRef.current = file.name.replace(/\.pdf$/i, "");
      setTitle(titleRef.current);
    }

    try {
      await ensureProject(titleRef.current, "pdf");

      const controller = new AbortController();
      loadAbortRef.current = controller;
      let count = 0;

      for await (const result of renderPdfPages(file, { dpi: 150, quality: 0.8, signal: controller.signal })) {
        const existing = existingChunksRef.current.get(result.pageNum);
        const page: BookPage = {
          pageNum: result.pageNum,
          imageBase64: result.imageBase64,
          translationText: existing?.translated_text ?? "",
          status: existing?.status === "completed" ? "done" : "pending",
        };
        setPages((prev) => [...prev, page]);
        count += 1;
        setLoadedCount(count);
        setTotalPages(result.totalPages);
      }
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : "PDF لوڈ نہیں ہو سکی۔");
    } finally {
      setIsLoadingSource(false);
    }
  }, [ensureProject]);

  const loadShamelaBook = useCallback(async (bookId: string, bookTitle: string) => {
    const isResuming = !!projectIdRef.current;
    setIsLoadingSource(true);
    setSourceError(null);
    setSourceKind("shamela");
    sourceKindRef.current = "shamela";
    setPages([]);
    setCurrentPageState(1);
    sourceMarkerRef.current = `shamela:${bookId}`;
    if (!isResuming) {
      existingChunksRef.current = new Map();
      titleRef.current = bookTitle;
      setTitle(bookTitle);
    }

    try {
      await ensureProject(titleRef.current, sourceMarkerRef.current);

      const client = getShamelaClient();
      const book = await client.readBook(bookId);

      if (book && book.pages.length > 0) {
        const newPages: BookPage[] = book.pages.map((p, idx) => {
          const pageNum = idx + 1;
          const plainText = htmlToPlainText(p.text);
          const existing = existingChunksRef.current.get(pageNum);
          return {
            pageNum,
            sourceHtml: p.text,
            sourceText: plainText,
            translationText: existing?.translated_text ?? "",
            status: existing?.status === "completed" ? "done" : "pending",
          };
        });
        setPages(newPages);
        setTotalPages(newPages.length);
        setLoadedCount(newPages.length);
        return;
      }

      // No digitized text — some Shamela books are scanned-image PDFs
      // instead. Fall back to the same PDF→image→vision pipeline the
      // "Upload PDF" source uses, sourced from the book's on-disk PDF
      // (served over the bridge on web, read directly on desktop).
      const pdfInfo = await getBookPdfInfo(bookId);
      if (!pdfInfo.available || pdfInfo.files.length === 0) {
        throw new Error("یہ کتاب دستیاب نہیں ہے۔");
      }
      const bytes = await readBookPdf(bookId, pdfInfo.files[0].fileIndex);
      if (!bytes) throw new Error("کتاب کی اسکین شدہ فائل نہیں کھل سکی۔");

      // Renders identically to an uploaded PDF (image pages, BookPageViewer) —
      // reuse that source kind rather than adding a third branch in the UI.
      setSourceKind("pdf");
      sourceKindRef.current = "pdf";
      let count = 0;
      for await (const result of renderPdfPages(bytes, { dpi: 150, quality: 0.8 })) {
        const existing = existingChunksRef.current.get(result.pageNum);
        const page: BookPage = {
          pageNum: result.pageNum,
          imageBase64: result.imageBase64,
          translationText: existing?.translated_text ?? "",
          status: existing?.status === "completed" ? "done" : "pending",
        };
        setPages((prev) => [...prev, page]);
        count += 1;
        setLoadedCount(count);
        setTotalPages(result.totalPages);
      }
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : "کتاب لوڈ نہیں ہو سکی۔");
    } finally {
      setIsLoadingSource(false);
    }
  }, [ensureProject]);

  /** A pasted/typed snippet — the one-shot job Quick Translate's "متن" mode used to be. */
  const loadText = useCallback(async (text: string) => {
    setIsLoadingSource(false);
    setSourceError(null);
    setSourceKind("text");
    sourceKindRef.current = "text";
    sourceMarkerRef.current = "text";
    existingChunksRef.current = new Map();
    titleRef.current = text.slice(0, 60).trim() || "متن کا ترجمہ";
    setTitle(titleRef.current);
    setPages([{ pageNum: 1, sourceText: text, translationText: "", status: "pending" }]);
    setTotalPages(1);
    setLoadedCount(1);
    setCurrentPageState(1);
    await ensureProject(titleRef.current, "text");
  }, [ensureProject]);

  /** A single uploaded image — Quick Translate's "تصویر" mode. */
  const loadImage = useCallback(async (file: File) => {
    setIsLoadingSource(true);
    setSourceError(null);
    setSourceKind("image");
    sourceKindRef.current = "image";
    sourceMarkerRef.current = "image";
    existingChunksRef.current = new Map();
    titleRef.current = file.name.replace(/\.[a-z0-9]+$/i, "");
    setTitle(titleRef.current);
    setPages([]);
    setTotalPages(0);
    setLoadedCount(0);
    setCurrentPageState(1);

    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await ensureProject(titleRef.current, "image");
      setPages([{ pageNum: 1, imageBase64: base64, translationText: "", status: "pending" }]);
      setTotalPages(1);
      setLoadedCount(1);
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : "تصویر لوڈ نہیں ہو سکی۔");
    } finally {
      setIsLoadingSource(false);
    }
  }, [ensureProject]);

  /** Resume: hydrate project metadata + already-translated pages from the DB. */
  const resumeProject = useCallback(async (existingProjectId: string) => {
    setIsLoadingSource(true);
    setSourceError(null);
    try {
      const { data: project, error: pErr } = await supabase
        .from("translation_projects")
        .select("id, title, source_lang, target_lang, genre, source_ref")
        .eq("id", existingProjectId)
        .single();
      if (pErr || !project) throw new Error("پراجیکٹ نہیں ملا۔");

      projectIdRef.current = project.id;
      titleRef.current = project.title;
      setProjectId(project.id);
      setTitle(project.title);
      setSourceLanguage(project.source_lang);
      setTargetLanguage(project.target_lang);
      setGenre(project.genre);

      const { data: chunks } = await supabase
        .from("translation_chunks")
        .select("chunk_index, source_text, translated_text, status")
        .eq("project_id", project.id);

      existingChunksRef.current = new Map(
        (chunks ?? []).map((c) => [c.chunk_index, {
          source_text: c.source_text,
          translated_text: c.translated_text,
          status: c.status,
        }]),
      );

      if (project.source_ref?.startsWith("shamela:")) {
        const bookId = project.source_ref.slice("shamela:".length);
        setResumedShamelaBookId(bookId);
        await loadShamelaBook(bookId, project.title);
      } else {
        // 'pdf', 'text', 'image', or null — none of these can be re-fetched
        // from a stored id the way a Shamela book can. "pdf" gets a real
        // re-upload prompt (isLoadingSource stays false, sourceKind stays
        // null); "text"/"image"/null get told to start over instead, since
        // those complete in seconds and a resume prompt for them would just
        // be confusing ("upload PDF" for a project that was never a PDF).
        setResumeSourceRef(project.source_ref ?? null);
        setIsLoadingSource(false);
      }
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : "پراجیکٹ لوڈ نہیں ہو سکا۔");
      setIsLoadingSource(false);
    }
  }, [loadShamelaBook]);

  const setCurrentPage = useCallback((n: number) => {
    setCurrentPageState((prev) => {
      const max = pagesRef.current.length;
      if (max === 0) return prev;
      return Math.min(Math.max(1, n), max);
    });
  }, []);

  const cancelSingle = useCallback(() => {
    singleAbortRef.current?.abort();
  }, []);

  const translateSinglePage = useCallback(async (pageNum: number) => {
    if (!session?.access_token) return;
    const page = pagesRef.current.find((p) => p.pageNum === pageNum);
    if (!page) return;

    setIsTranslatingSingle(true);
    setStreamingText("");
    const controller = new AbortController();
    singleAbortRef.current = controller;
    setPageStatus(pageNum, "translating");

    try {
      await ensureProject(titleRef.current, sourceMarkerRef.current);
      const result = await translateOnePage({
        text: page.sourceText,
        imageBase64: page.imageBase64,
        targetLanguage,
        sourceLanguage: sourceLanguage !== "auto" ? sourceLanguage : undefined,
        genreInstruction: GENRE_TRANSLATION_PROMPTS[genre]?.prompt,
        bookMode: sourceKindRef.current === "pdf" || sourceKindRef.current === "shamela",
        accessToken: session.access_token,
        signal: controller.signal,
        onChunk: setStreamingText,
      });
      setPageResult(pageNum, result, "done");
      await persistChunk(pageNum, page.sourceText ?? "", result);
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setPageStatus(pageNum, "failed");
        setSourceError(err.message);
      } else {
        setPageStatus(pageNum, "pending");
      }
    } finally {
      setIsTranslatingSingle(false);
    }
  }, [session, targetLanguage, sourceLanguage, genre, ensureProject, persistChunk, setPageStatus, setPageResult]);

  const estimateBatch = useCallback((from: number, to: number): BatchEstimate => {
    const targets = pagesRef.current.filter(
      (p) => p.pageNum >= from && p.pageNum <= to && p.status !== "done",
    );
    const perPageCost = sourceKindRef.current === "pdf" || sourceKindRef.current === "shamela"
      ? TOKEN_COSTS.translate_book
      : TOKEN_COSTS.translate;
    return {
      pages: targets.length,
      tokenCost: targets.length * perPageCost,
      estimatedSeconds: Math.ceil(targets.length * (DISPATCH_INTERVAL_MS / 1000)),
    };
  }, []);

  const cancelBatch = useCallback(() => {
    batchAbortRef.current?.abort();
  }, []);

  const translateAll = useCallback(async (fromPage?: number, toPage?: number) => {
    if (!session?.access_token) return;

    const from = fromPage ?? 1;
    const to = toPage ?? pagesRef.current.length;
    const targets = pagesRef.current.filter((p) => p.pageNum >= from && p.pageNum <= to);
    const pending = targets.filter((p) => p.status !== "done");
    const alreadyDone = targets.length - pending.length;

    const controller = new AbortController();
    batchAbortRef.current = controller;

    const progress: BatchProgress = {
      phase: "preparing",
      current: 0,
      total: targets.length,
      done: alreadyDone,
      failed: 0,
      skipped: 0,
      tokensSpent: 0,
      throttled: false,
    };
    setBatch({ ...progress });

    let lastDispatch = 0;
    let remainingTokens = tokenBalance.total;
    const bookMode = sourceKindRef.current === "pdf" || sourceKindRef.current === "shamela";
    const perPageCost = bookMode ? TOKEN_COSTS.translate_book : TOKEN_COSTS.translate;

    try {
      await ensureProject(titleRef.current, sourceMarkerRef.current);
      progress.phase = "running";

      for (const page of pending) {
        if (controller.signal.aborted) break;
        if (remainingTokens < perPageCost) break;

        const wait = DISPATCH_INTERVAL_MS - (Date.now() - lastDispatch);
        if (lastDispatch > 0 && wait > 0) {
          progress.throttled = true;
          setBatch({ ...progress });
          await sleep(wait);
          if (controller.signal.aborted) break;
        }
        progress.throttled = false;
        progress.current += 1;
        setPageStatus(page.pageNum, "translating");
        setBatch({ ...progress });
        lastDispatch = Date.now();

        const callArgs = {
          text: page.sourceText,
          imageBase64: page.imageBase64,
          targetLanguage,
          sourceLanguage: sourceLanguage !== "auto" ? sourceLanguage : undefined,
          genreInstruction: GENRE_TRANSLATION_PROMPTS[genre]?.prompt,
          bookMode,
          accessToken: session.access_token,
          signal: controller.signal,
        };

        let result: string | null = null;
        try {
          result = await translateOnePage(callArgs);
        } catch (err) {
          const isRateLimit = err instanceof Error && err.name === "RateLimitError";
          if (isRateLimit && !controller.signal.aborted) {
            progress.throttled = true;
            setBatch({ ...progress });
            await sleep(RETRY_BACKOFF_MS);
            try {
              result = await translateOnePage(callArgs);
            } catch {
              result = null;
            }
          }
        }

        if (result) {
          setPageResult(page.pageNum, result, "done");
          await persistChunk(page.pageNum, page.sourceText ?? "", result);
          progress.done += 1;
          progress.tokensSpent += perPageCost;
          remainingTokens -= perPageCost;
        } else {
          setPageStatus(page.pageNum, "failed");
          progress.failed += 1;
        }
        setBatch({ ...progress });
      }

      progress.phase = "finalizing";
      setBatch({ ...progress });

      const finishedAll = progress.done + progress.failed >= targets.length && !controller.signal.aborted;
      if (finishedAll && progress.failed === 0 && projectIdRef.current) {
        await supabase.from("translation_projects").update({ status: "completed" }).eq("id", projectIdRef.current);
      }
    } finally {
      setBatch(null);
      batchAbortRef.current = null;
    }
  }, [session, targetLanguage, sourceLanguage, genre, tokenBalance.total, ensureProject, persistChunk, setPageStatus, setPageResult]);

  const getFullTranslation = useCallback(() => {
    return pages
      .filter((p) => p.translationText)
      .map((p) => `--- صفحہ ${p.pageNum} ---\n${p.translationText}`)
      .join("\n\n");
  }, [pages]);

  return {
    sourceKind,
    title,
    projectId,
    pages,
    currentPage,
    totalPages,
    isLoadingSource,
    loadedCount,
    sourceError,
    resumeSourceRef,
    resumedShamelaBookId,

    sourceLanguage,
    targetLanguage,
    genre,
    setSourceLanguage,
    setTargetLanguage,
    setGenre,

    loadPdf,
    loadShamelaBook,
    loadText,
    loadImage,
    resumeProject,

    setCurrentPage,
    translateSinglePage,
    cancelSingle,
    isTranslatingSingle,
    streamingText,

    batch,
    estimateBatch,
    translateAll,
    cancelBatch,

    updateTranslation,
    getFullTranslation,
  };
}

export type UseBookTranslationReturn = ReturnType<typeof useBookTranslation>;
