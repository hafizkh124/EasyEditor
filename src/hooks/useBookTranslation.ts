import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { TOKEN_COSTS } from "@/contexts/SubscriptionContext";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { renderPdfPages } from "@/lib/ocr/pdfRenderer";
import { translateOnePage } from "@/lib/translate/translatePageApi";
import { getShamelaClient } from "@/core/shamela/shamelaClient";
import { htmlToPlainText } from "@/lib/reader/htmlToPlainText";
import { getBookPdfInfo, readBookPdf } from "@/lib/shamela/shamelaPdf";
import { GENRE_TRANSLATION_PROMPTS } from "@/lib/translationMemory";
import { ocrPageImage } from "@/lib/ocr/ocrClient";
import {
  cleanGlossary, composeInstruction, parseGlossary,
  type GlossaryEntry, type TranslationStyle,
} from "@/lib/translate/glossary";
import { joinParagraphs, pairParagraphs, replaceParagraph, splitParagraphs } from "@/lib/translate/paragraphs";
import { logger } from "@/lib/logger";
import {
  addJob, emitJobEvent, isActive, onJobEvent, registerCancel, updateJob, useJob,
} from "@/lib/jobs/jobStore";
import { deleteStash, readStash, writeStash } from "@/lib/jobs/fileStash";
import { translateStored } from "@/lib/i18n";
import { getTranslationStore } from "@/hooks/bookTranslations";
import { usePageEngine } from "@/lib/pages/pageEngine";

const log = logger.child("useBookTranslation");

export type BookSourceKind = "pdf" | "shamela" | "text" | "image";
/** "reading": a page image is being read (OCR) before it is translated. */
export type PageStatus = "pending" | "reading" | "translating" | "done" | "failed";

export interface BookPage {
  pageNum: number;
  /** `source: "pdf"` — the rendered page image. */
  imageBase64?: string;
  /** `source: "shamela"` — the page's trusted HTML, for `ReaderContent`. */
  sourceHtml?: string;
  /** `source: "image"` — the uploaded image's type (rendered PDF pages are JPEG). */
  mimeType?: string;
  /**
   * The text that is translated: a Shamela page's text, pasted text, or — for
   * a page image — what OCR read from it first, so the page can be reviewed
   * paragraph by paragraph and exported bilingual (SYSTEM-2026 §6).
   */
  sourceText?: string;
  translationText: string;
  status: PageStatus;
  /** Review pairs marked reviewed (indices into `pairParagraphs`). */
  reviewed?: number[];
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
  /** Of those, page images that are read (OCR) first. */
  pagesToRead: number;
  tokenCost: number;
  estimatedSeconds: number;
}

/** Paced against the server's 30/min limit (translate-page/index.ts), with headroom. */
const DISPATCH_INTERVAL_MS = 2200;
const RETRY_BACKOFF_MS = DISPATCH_INTERVAL_MS * 5;

/** Rough time for reading one page image, for the estimate only. */
const OCR_SECONDS_PER_PAGE = 4;
/** Chunk status for a page that was read but not yet translated. */
const READ_STATUS = "read";
const EDIT_SAVE_DELAY_MS = 800;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ExistingChunk {
  source_text: string;
  translated_text: string | null;
  status: string;
  reviewed: number[];
}

function pageFromChunk(pageNum: number, existing: ExistingChunk | undefined, base: Partial<BookPage>): BookPage {
  return {
    pageNum,
    ...base,
    sourceText: base.sourceText ?? (existing?.source_text || undefined),
    translationText: existing?.translated_text ?? "",
    status: existing?.status === "completed" ? "done" : "pending",
    reviewed: existing?.reviewed ?? [],
  };
}

/** One queue entry per translation project (SYSTEM-2026 §9). */
export const translationJobId = (projectId: string) => `translate-${projectId}`;
/** Where an uploaded PDF is kept on the device, so resuming needs no re-upload. */
const pdfStashKey = (projectId: string) => `pdf:${projectId}`;

/** A page's change, sent to a re-opened screen while the run goes on elsewhere. */
interface PageEvent {
  pageNum: number;
  patch: Partial<BookPage>;
}

interface UseBookTranslationOptions {
  /** Called as soon as a project row exists, so the caller can reflect it in the URL. */
  onProjectId?: (projectId: string) => void;
  /** The workspace folder this translation was started from ("+" in a folder). */
  folderId?: string | null;
}

export function useBookTranslation(options: UseBookTranslationOptions = {}) {
  const { user, session } = useAuth();
  // Signed in: the account. A desktop signed out: this computer (SYSTEM-2026 §10).
  const store = getTranslationStore(user?.id);
  const storeRef = useRef(store);
  storeRef.current = store;
  // Who reads and translates: the desktop's own key, or the account (tokens).
  const { engine, loading: engineLoading } = usePageEngine();
  const ownKey = engine === "own-key";
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
  const [style, setStyleState] = useState<TranslationStyle>("idiomatic");
  const [glossary, setGlossaryState] = useState<GlossaryEntry[]>([]);
  const [retranslating, setRetranslating] = useState<{ pageNum: number; index: number } | null>(null);

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

  /**
   * Patch one page in both the ref (read by the async loops right away) and
   * state. Functional so a page appended by a still-running PDF render is
   * never lost.
   */
  const runningJobRef = useRef<string | null>(null);
  const patchPage = useCallback((pageNum: number, patch: Partial<BookPage>) => {
    pagesRef.current = pagesRef.current.map((p) => (p.pageNum === pageNum ? { ...p, ...patch } : p));
    setPages((prev) => prev.map((p) => (p.pageNum === pageNum ? { ...p, ...patch } : p)));
    if (runningJobRef.current) {
      const { imageBase64: _image, sourceHtml: _html, ...light } = patch;
      emitJobEvent(runningJobRef.current, { pageNum, patch: light } satisfies PageEvent);
    }
  }, []);

  // This project's run in the queue — possibly started by an earlier visit to
  // this page and still going. Its page changes are followed here.
  const job = useJob(projectId ? translationJobId(projectId) : null);
  const backgroundRun = job && isActive(job) && runningJobRef.current !== job.id ? job : undefined;
  const backgroundId = backgroundRun?.id;
  useEffect(() => {
    if (!backgroundId) return;
    return onJobEvent<PageEvent>(backgroundId, ({ pageNum, patch }) => {
      pagesRef.current = pagesRef.current.map((p) => (p.pageNum === pageNum ? { ...p, ...patch } : p));
      setPages((prev) => prev.map((p) => (p.pageNum === pageNum ? { ...p, ...patch } : p)));
    });
  }, [backgroundId]);

  const setPageStatus = useCallback((pageNum: number, status: PageStatus) => patchPage(pageNum, { status }), [patchPage]);

  const ensureProject = useCallback(
    async (explicitTitle: string, sourceRef: string): Promise<string | null> => {
      if (projectIdRef.current) return projectIdRef.current;
      const target = storeRef.current;
      if (!target) {
        setSourceError(translateStored("translate.needs_engine", "ترجمہ کے لیے اپنی Gemini کلید لگائیں یا سائن ان کریں۔"));
        return null;
      }
      const row = {
        title: explicitTitle || "بلا عنوان کتاب",
        source_lang: sourceLanguage !== "auto" ? sourceLanguage : "ar",
        target_lang: targetLanguage,
        genre,
        status: "in_progress",
        source_ref: sourceRef,
        ...(options.folderId ? { project_id: options.folderId } : {}),
      };
      let id: string;
      try {
        id = await target.createProject({ ...row, style, glossary });
      } catch (error) {
        log.error("Failed to create translation project", { error });
        setSourceError("پراجیکٹ نہیں بن سکا۔");
        return null;
      }
      projectIdRef.current = id;
      setProjectId(id);
      options.onProjectId?.(id);
      return id;
    },
    [sourceLanguage, targetLanguage, genre, style, glossary, options],
  );

  /** Save style and glossary on the project, once it exists. */
  const saveSettings = useCallback(async (patch: { style?: TranslationStyle; glossary?: GlossaryEntry[] }) => {
    const pid = projectIdRef.current;
    if (!pid) return;
    await storeRef.current?.updateProject(pid, patch).catch((error) => log.error("Failed to save translation settings", { error }));
  }, []);

  const setStyle = useCallback((next: TranslationStyle) => {
    setStyleState(next);
    void saveSettings({ style: next });
  }, [saveSettings]);

  const setGlossary = useCallback((next: GlossaryEntry[]) => {
    const clean = cleanGlossary(next);
    setGlossaryState(clean);
    void saveSettings({ glossary: clean });
  }, [saveSettings]);

  /** Write a page's current state (read from the ref) to its chunk row. */
  const persistPage = useCallback(async (pageNum: number) => {
    const pid = projectIdRef.current;
    const page = pagesRef.current.find((p) => p.pageNum === pageNum);
    if (!pid || !page) return;
    await storeRef.current
      ?.upsertChunk({
        project_id: pid,
        chunk_index: pageNum,
        source_text: page.sourceText ?? "",
        translated_text: page.translationText || null,
        status: page.translationText ? "completed" : READ_STATUS,
        reviewed: page.reviewed ?? [],
      })
      .catch((error) => log.error("Failed to persist page translation", { pageNum, error }));
  }, []);

  // Typing in the review pane saves shortly after the last keystroke, per page.
  const saveTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const persistSoon = useCallback((pageNum: number) => {
    const timers = saveTimersRef.current;
    clearTimeout(timers.get(pageNum));
    timers.set(pageNum, setTimeout(() => {
      timers.delete(pageNum);
      void persistPage(pageNum);
    }, EDIT_SAVE_DELAY_MS));
  }, [persistPage]);
  useEffect(() => {
    const timers = saveTimersRef.current;
    return () => {
      // Leaving the page: save what is pending rather than dropping it.
      for (const [pageNum, timer] of timers) {
        clearTimeout(timer);
        void persistPage(pageNum);
      }
      timers.clear();
    };
  }, [persistPage]);

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
      const pid = await ensureProject(titleRef.current, "pdf");
      // Kept on this device so the translation can resume without asking for the file again.
      if (pid) void writeStash(pdfStashKey(pid), { file, fileName: file.name });

      const controller = new AbortController();
      loadAbortRef.current = controller;
      let count = 0;

      for await (const result of renderPdfPages(file, { dpi: 150, quality: 0.8, signal: controller.signal })) {
        const page = pageFromChunk(result.pageNum, existingChunksRef.current.get(result.pageNum), {
          imageBase64: result.imageBase64,
        });
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
          return pageFromChunk(pageNum, existingChunksRef.current.get(pageNum), {
            sourceHtml: p.text,
            sourceText: htmlToPlainText(p.text),
          });
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
        const page = pageFromChunk(result.pageNum, existingChunksRef.current.get(result.pageNum), {
          imageBase64: result.imageBase64,
        });
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
    setPages([{ pageNum: 1, sourceText: text, translationText: "", status: "pending", reviewed: [] }]);
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
      setPages([{ pageNum: 1, imageBase64: base64, mimeType: file.type || "image/jpeg", translationText: "", status: "pending", reviewed: [] }]);
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
      const target = storeRef.current;
      const project = target ? await target.getProject(existingProjectId) : null;
      if (!target || !project) throw new Error("پراجیکٹ نہیں ملا۔");

      projectIdRef.current = project.id;
      titleRef.current = project.title;
      setProjectId(project.id);
      setTitle(project.title);
      setSourceLanguage(project.source_lang);
      setTargetLanguage(project.target_lang);
      setGenre(project.genre);
      setStyleState(project.style === "literal" ? "literal" : "idiomatic");
      setGlossaryState(parseGlossary(project.glossary));

      const chunks = await target.listChunks(project.id);

      existingChunksRef.current = new Map(
        chunks.map((c) => [c.chunk_index, {
          source_text: c.source_text,
          translated_text: c.translated_text,
          status: c.status,
          reviewed: Array.isArray(c.reviewed) ? c.reviewed : [],
        }]),
      );

      if (project.source_ref?.startsWith("shamela:")) {
        const bookId = project.source_ref.slice("shamela:".length);
        setResumedShamelaBookId(bookId);
        await loadShamelaBook(bookId, project.title);
      } else {
        // 'pdf', 'text', 'image', or null — none of these can be re-fetched
        // from a stored id the way a Shamela book can. A PDF kept on this
        // device reopens on its own; otherwise "pdf" gets a re-upload prompt.
        // Text and image projects reopen from their saved pages (below);
        // only an empty one is told to start over.
        const kept = project.source_ref === "pdf" ? await readStash(pdfStashKey(project.id)) : undefined;
        if (kept?.file) {
          await loadPdf(kept.file instanceof File ? kept.file : new File([kept.file], kept.fileName ?? "book.pdf", { type: "application/pdf" }));
          return;
        }
        // Pasted text, or an image whose text was read: every page keeps its
        // source text, so the translation reopens from its saved pages for
        // review and export (SYSTEM-2026 §6).
        const saved = [...existingChunksRef.current.entries()]
          .filter(([, c]) => c.source_text.trim())
          .sort(([a], [b]) => a - b);
        if (project.source_ref !== "pdf" && saved.length > 0) {
          setSourceKind("text");
          sourceKindRef.current = "text";
          sourceMarkerRef.current = project.source_ref ?? "text";
          const restored = saved.map(([pageNum, c]) => pageFromChunk(pageNum, c, {}));
          setPages(restored);
          setTotalPages(restored.length);
          setLoadedCount(restored.length);
          setCurrentPageState(1);
          setIsLoadingSource(false);
          return;
        }
        setResumeSourceRef(project.source_ref ?? null);
        setIsLoadingSource(false);
      }
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : "پراجیکٹ لوڈ نہیں ہو سکا۔");
      setIsLoadingSource(false);
    }
  }, [loadShamelaBook, loadPdf]);

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

  const isBookMode = () => sourceKindRef.current === "pdf" || sourceKindRef.current === "shamela";

  /**
   * Translate one page, reading it first when it is only an image ("read then
   * translate"): the text OCR finds is kept as the page's source, so the page
   * is reviewed paragraph by paragraph and exports bilingual. An image OCR
   * finds no text in is sent as an image, as before.
   */
  const translatePageNow = useCallback(async (
    pageNum: number,
    signal: AbortSignal,
    onChunk?: (accumulated: string) => void,
  ): Promise<string> => {
    if (!engine) throw new Error(translateStored("translate.needs_engine", "ترجمہ کے لیے اپنی Gemini کلید لگائیں یا سائن ان کریں۔"));
    let page = pagesRef.current.find((p) => p.pageNum === pageNum);
    if (!page) throw new Error(`Page ${pageNum} is not loaded.`);

    if (!page.sourceText?.trim() && page.imageBase64) {
      setPageStatus(pageNum, "reading");
      const read = (await ocrPageImage(page.imageBase64, page.mimeType ?? "image/jpeg")).trim();
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (read) {
        patchPage(pageNum, { sourceText: read });
        void persistPage(pageNum);
        page = { ...page, sourceText: read };
      }
    }

    setPageStatus(pageNum, "translating");
    const text = page.sourceText?.trim() ? joinParagraphs(splitParagraphs(page.sourceText)) : undefined;
    return translateOnePage({
      text,
      imageBase64: text ? undefined : page.imageBase64,
      mimeType: page.mimeType,
      targetLanguage,
      sourceLanguage: sourceLanguage !== "auto" ? sourceLanguage : undefined,
      genreInstruction: composeInstruction({
        genrePrompt: GENRE_TRANSLATION_PROMPTS[genre]?.prompt,
        style,
        glossary,
        text: text ?? undefined,
        paragraphs: Boolean(text),
      }),
      bookMode: isBookMode(),
      accessToken: session?.access_token,
      signal,
      onChunk,
    });
  }, [engine, session, targetLanguage, sourceLanguage, genre, style, glossary, patchPage, persistPage, setPageStatus]);

  /** A fresh translation replaces the page's text, so its review marks no longer apply. */
  const finishPage = useCallback(async (pageNum: number, translation: string) => {
    patchPage(pageNum, { translationText: translation, status: "done", reviewed: [] });
    await persistPage(pageNum);
  }, [patchPage, persistPage]);

  const translateSinglePage = useCallback(async (pageNum: number) => {
    if (!engine) return;
    if (!pagesRef.current.some((p) => p.pageNum === pageNum)) return;

    setIsTranslatingSingle(true);
    setStreamingText("");
    const controller = new AbortController();
    singleAbortRef.current = controller;

    try {
      await ensureProject(titleRef.current, sourceMarkerRef.current);
      const result = await translatePageNow(pageNum, controller.signal, setStreamingText);
      await finishPage(pageNum, result);
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setPageStatus(pageNum, "failed");
        setSourceError(err.message);
      } else {
        setPageStatus(pageNum, "pending");
      }
    } finally {
      setIsTranslatingSingle(false);
      setStreamingText("");
    }
  }, [engine, ensureProject, translatePageNow, finishPage, setPageStatus]);

  const estimateBatch = useCallback((from: number, to: number): BatchEstimate => {
    const targets = pagesRef.current.filter(
      (p) => p.pageNum >= from && p.pageNum <= to && p.status !== "done",
    );
    const pagesToRead = targets.filter((p) => p.imageBase64 && !p.sourceText?.trim()).length;
    const perPageCost = isBookMode() ? TOKEN_COSTS.translate_book : TOKEN_COSTS.translate;
    return {
      pages: targets.length,
      pagesToRead,
      // The user's own key bills their Google account, not our tokens.
      tokenCost: ownKey ? 0 : targets.length * perPageCost + pagesToRead * TOKEN_COSTS.ocr,
      estimatedSeconds: Math.ceil(targets.length * (DISPATCH_INTERVAL_MS / 1000) + pagesToRead * OCR_SECONDS_PER_PAGE),
    };
  }, [ownKey]);

  const cancelBatch = useCallback(() => {
    batchAbortRef.current?.abort();
  }, []);

  const translateAll = useCallback(async (fromPage?: number, toPage?: number) => {
    if (!engine) return;

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
    let jobId: string | null = null;
    // Every progress update also moves the queue's entry (SYSTEM-2026 §9).
    const report = () => {
      setBatch({ ...progress });
      if (jobId) updateJob(jobId, { current: progress.done, total: progress.total });
    };
    let outOfTokens = false;
    const perPageCost = isBookMode() ? TOKEN_COSTS.translate_book : TOKEN_COSTS.translate;

    try {
      const pid = await ensureProject(titleRef.current, sourceMarkerRef.current);
      if (pid) {
        jobId = translationJobId(pid);
        runningJobRef.current = jobId;
        addJob({
          id: jobId, kind: "translate", title: titleRef.current || "Translation", status: "running",
          href: `/translate-book/${pid}`, resumable: true, current: progress.done, total: progress.total,
          meta: { projectId: pid, from, to },
        });
        registerCancel(jobId, () => controller.abort());
      }
      progress.phase = "running";

      for (const { pageNum } of pending) {
        if (controller.signal.aborted) break;
        const needsRead = (() => {
          const p = pagesRef.current.find((x) => x.pageNum === pageNum);
          return Boolean(p?.imageBase64 && !p.sourceText?.trim());
        })();
        const pageCost = ownKey ? 0 : perPageCost + (needsRead ? TOKEN_COSTS.ocr : 0);
        if (remainingTokens < pageCost) {
          outOfTokens = true;
          break;
        }

        const wait = DISPATCH_INTERVAL_MS - (Date.now() - lastDispatch);
        if (lastDispatch > 0 && wait > 0) {
          progress.throttled = true;
          report();
          await sleep(wait);
          if (controller.signal.aborted) break;
        }
        progress.throttled = false;
        progress.current += 1;
        report();
        lastDispatch = Date.now();

        let result: string | null = null;
        try {
          result = await translatePageNow(pageNum, controller.signal);
        } catch (err) {
          const isRateLimit = err instanceof Error && err.name === "RateLimitError";
          if (isRateLimit && !controller.signal.aborted) {
            progress.throttled = true;
            report();
            await sleep(RETRY_BACKOFF_MS);
            try {
              // The page's text was kept if it was read, so this does not read it again.
              result = await translatePageNow(pageNum, controller.signal);
            } catch {
              result = null;
            }
          }
        }

        if (result) {
          await finishPage(pageNum, result);
          progress.done += 1;
          progress.tokensSpent += pageCost;
          remainingTokens -= pageCost;
        } else {
          setPageStatus(pageNum, controller.signal.aborted ? "pending" : "failed");
          if (!controller.signal.aborted) progress.failed += 1;
        }
        report();
      }

      progress.phase = "finalizing";
      report();

      const finishedAll = progress.done + progress.failed >= targets.length && !controller.signal.aborted;
      const wholeBook = finishedAll && progress.failed === 0 && from <= 1 && to >= pagesRef.current.length;
      if (wholeBook && projectIdRef.current) {
        await storeRef.current?.updateProject(projectIdRef.current, { status: "completed" }).catch(() => {});
        void deleteStash(pdfStashKey(projectIdRef.current));
      }
      if (jobId) {
        if (controller.signal.aborted) updateJob(jobId, { status: "cancelled" });
        else if (progress.failed > 0 || outOfTokens) {
          updateJob(jobId, {
            status: "failed",
            error: outOfTokens
              ? translateStored("jobs.out_of_tokens", "ٹوکن ختم ہو گئے، باقی صفحات رہ گئے۔")
              : translateStored("jobs.pages_failed", "{n} صفحات کا ترجمہ نہیں ہو سکا۔").replace("{n}", String(progress.failed)),
          });
        } else updateJob(jobId, { status: "done" });
      }
    } catch (err) {
      if (jobId) updateJob(jobId, { status: "failed", error: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      setBatch(null);
      batchAbortRef.current = null;
      if (jobId) registerCancel(jobId, null);
      runningJobRef.current = null;
    }
  }, [engine, ownKey, tokenBalance.total, ensureProject, translatePageNow, finishPage, setPageStatus]);

  /** Edit a page's whole translation (the page editor, or an unaligned page in review). */
  const updateTranslation = useCallback((pageNum: number, text: string) => {
    const page = pagesRef.current.find((p) => p.pageNum === pageNum);
    if (!page || page.translationText === text) return;
    patchPage(pageNum, { translationText: text, status: text.trim() ? "done" : page.status });
    persistSoon(pageNum);
  }, [patchPage, persistSoon]);

  /** Edit one paragraph of a page's translation in place. */
  const updateParagraph = useCallback((pageNum: number, index: number, text: string) => {
    const page = pagesRef.current.find((p) => p.pageNum === pageNum);
    if (!page) return;
    const next = replaceParagraph(splitParagraphs(page.sourceText ?? ""), page.translationText, index, text);
    if (next === null) updateTranslation(pageNum, text);
    else updateTranslation(pageNum, next);
  }, [updateTranslation]);

  const toggleReviewed = useCallback((pageNum: number, index: number) => {
    const page = pagesRef.current.find((p) => p.pageNum === pageNum);
    if (!page) return;
    const current = page.reviewed ?? [];
    const reviewed = current.includes(index) ? current.filter((i) => i !== index) : [...current, index].sort((a, b) => a - b);
    patchPage(pageNum, { reviewed });
    persistSoon(pageNum);
  }, [patchPage, persistSoon]);

  /** Mark every pair on a page reviewed (or clear them all). */
  const setPageReviewed = useCallback((pageNum: number, all: boolean) => {
    const page = pagesRef.current.find((p) => p.pageNum === pageNum);
    if (!page) return;
    const { pairs } = pairParagraphs(page.sourceText, page.translationText);
    patchPage(pageNum, { reviewed: all ? pairs.map((_, i) => i) : [] });
    persistSoon(pageNum);
  }, [patchPage, persistSoon]);

  /**
   * Re-translate one paragraph with the user's request ("make it more
   * fluent"), keeping the rest of the page. Resolves true when it was replaced.
   */
  const retranslateParagraph = useCallback(async (pageNum: number, index: number, request: string): Promise<boolean> => {
    const page = pagesRef.current.find((p) => p.pageNum === pageNum);
    if (!engine || !page) return false;
    const { pairs, aligned } = pairParagraphs(page.sourceText, page.translationText);
    const pair = pairs[index];
    if (!pair?.source.trim()) return false;

    setRetranslating({ pageNum, index });
    try {
      const extra = [
        pair.translation.trim() && `Current translation, to be revised: ${pair.translation.trim()}`,
        `Request from the reviewer: ${request.trim() || "Translate this again, more accurately."}`,
        "Return only the new translation of this one paragraph.",
      ].filter(Boolean).join("\n");
      const result = (await translateOnePage({
        text: pair.source,
        targetLanguage,
        sourceLanguage: sourceLanguage !== "auto" ? sourceLanguage : undefined,
        genreInstruction: composeInstruction({
          genrePrompt: GENRE_TRANSLATION_PROMPTS[genre]?.prompt,
          style,
          glossary,
          text: pair.source,
          paragraphs: false,
          extra,
        }),
        bookMode: isBookMode(),
        accessToken: session?.access_token,
      })).trim();
      if (!result) return false;
      const latest = pagesRef.current.find((p) => p.pageNum === pageNum) ?? page;
      const next = aligned && latest.translationText.trim()
        ? replaceParagraph(splitParagraphs(latest.sourceText ?? ""), latest.translationText, index, result)
        : result;
      if (next === null) return false;
      patchPage(pageNum, {
        translationText: next,
        status: "done",
        reviewed: (latest.reviewed ?? []).filter((i) => i !== index),
      });
      await persistPage(pageNum);
      return true;
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setRetranslating(null);
    }
  }, [engine, session, targetLanguage, sourceLanguage, genre, style, glossary, patchPage, persistPage]);

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
    style,
    setStyle,
    glossary,
    setGlossary,

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
    updateParagraph,
    toggleReviewed,
    setPageReviewed,
    retranslateParagraph,
    retranslating,
    getFullTranslation,
    /** This project's run, going on from an earlier visit to the page. */
    backgroundRun,
    /** Who translates (own key / account), or null: show how to enable it. */
    engine,
    engineLoading,
    /** Where projects are kept: "account", "device", or null (none). */
    storeKind: store?.kind ?? null,
  };
}

export type UseBookTranslationReturn = ReturnType<typeof useBookTranslation>;
