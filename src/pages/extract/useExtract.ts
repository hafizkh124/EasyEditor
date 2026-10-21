import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useCanAfford } from "@/hooks/useTokenBalance";
import { usePageSession } from "@/hooks/usePageSession";
import { isCapabilityAvailable } from "@/core/capabilities/registry";
import { isDesktop } from "@/utils/environment";
import { ACCEPTED_MEDIA, MAX_FILE_SIZE_BYTES, isVideoFile } from "@/lib/audio/formatSupport";
import {
  transcribeLongForm, resolveSttRoute, TranscribeCancelledError, MAX_DURATION_SECONDS,
  type SttRoute, type TranscribeLanguage,
} from "@/lib/audio/transcribeLongForm";
import { ACCEPTED_OCR, MAX_PDF_PAGES, getDocumentType, getMaxFileSize } from "@/lib/ocr/documentFormats";
import { renderPdfPages, getPdfPageCount } from "@/lib/ocr/pdfRenderer";
import { ocrPageImage } from "@/lib/ocr/ocrClient";
import { logActivity } from "@/lib/activityLog";
import type { TranscriptSegment } from "@/core/voice/types";
import type { TranslationKey } from "@/lib/i18n";

/**
 * One "extract text" flow (SYSTEM-2026 §5): a recording, an audio or video
 * file, an image or a PDF goes in; text comes out. The kind is read from the
 * file — the user never chooses between "transcribe" and "OCR".
 *
 * It reuses the engines the two old pages had (long-form transcription with
 * local Whisper or the cloud, PDF page rendering and per-page OCR), and saves
 * results to the same session sections, so earlier results still open.
 *
 * Unlike the old Transcribe page, a microphone recording goes through the
 * same engine as a file — local Whisper when it is installed.
 */

export type ExtractKind = "audio" | "image" | "pdf";
export type ExtractPhase = "idle" | "recording" | "running" | "done";

const AUTO_COPY_KEY = "extract-autocopy";
/** The old OCR page's switch, read once so nobody loses their setting. */
const LEGACY_AUTO_COPY_KEY = "ocr-autocopy";

const AUDIO_EXT = new Set(
  ACCEPTED_MEDIA.split(",").filter((x) => x.startsWith(".")).map((x) => x.toLowerCase()),
);

/** What kind of extraction a file needs, or null when it is neither media nor a page. */
export function detectKind(file: File): ExtractKind | null {
  const doc = getDocumentType(file);
  if (doc === "image" || doc === "pdf") return doc;
  if (file.type.startsWith("audio/") || file.type.startsWith("video/")) return "audio";
  const dot = file.name.lastIndexOf(".");
  return dot >= 0 && AUDIO_EXT.has(file.name.slice(dot).toLowerCase()) ? "audio" : null;
}

function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function readAutoCopy(): boolean {
  try {
    const v = localStorage.getItem(AUTO_COPY_KEY) ?? localStorage.getItem(LEGACY_AUTO_COPY_KEY);
    return v === "true";
  } catch {
    return false;
  }
}

interface SessionMeta extends Record<string, unknown> {
  transcript?: string;
  extractedText?: string;
  sttLanguage?: TranscribeLanguage;
}

export function useExtract() {
  const { t } = useLanguage();
  const { user } = useAuth();

  const audioAvailable = isCapabilityAvailable("transcribe");
  const pagesAvailable = isCapabilityAvailable("ocr");
  const accept = [audioAvailable && ACCEPTED_MEDIA, pagesAvailable && ACCEPTED_OCR].filter(Boolean).join(",");

  const [phase, setPhase] = useState<ExtractPhase>("idle");
  const [kind, setKind] = useState<ExtractKind | null>(null);
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [segments, setSegments] = useState<TranscriptSegment[] | null>(null);
  const [progress, setProgress] = useState<{ labelKey: TranslationKey; current: number; total: number } | null>(null);
  const [language, setLanguage] = useState<TranscribeLanguage>("auto");
  const [sttRoute, setSttRoute] = useState<SttRoute>("cloud");
  const [autoCopy, setAutoCopyState] = useState(readAutoCopy);
  const abortRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  const { canAfford: canAffordAudio } = useCanAfford("stt", 1);
  const { canAfford: canAffordPage } = useCanAfford("ocr", 1);
  // A signed-out desktop has no cloud account: only local Whisper can run.
  const audioNeedsLocalModel = isDesktop() && sttRoute === "cloud" && !user;

  useEffect(() => {
    let cancelled = false;
    resolveSttRoute()
      .then((r) => !cancelled && setSttRoute(r))
      .catch(() => !cancelled && setSttRoute("cloud"));
    return () => {
      cancelled = true;
    };
  }, []);

  // Earlier results open from Files (`?session=`), from either old section.
  const restore = useCallback((restoredKind: ExtractKind) => (meta: SessionMeta) => {
    const restoredText = meta.transcript ?? meta.extractedText ?? "";
    if (!restoredText) return;
    setText(restoredText);
    setKind(restoredKind);
    setPhase("done");
    if (meta.sttLanguage) setLanguage(meta.sttLanguage);
  }, []);
  const restoreAudio = useCallback((m: SessionMeta) => restore("audio")(m), [restore]);
  const restorePages = useCallback((m: SessionMeta) => restore("image")(m), [restore]);
  const audioSession = usePageSession<SessionMeta>({ section: "transcribe", onRestore: restoreAudio });
  const pageSession = usePageSession<SessionMeta>({ section: "ocr", onRestore: restorePages });

  const setAutoCopy = (on: boolean) => {
    setAutoCopyState(on);
    try {
      localStorage.setItem(AUTO_COPY_KEY, String(on));
    } catch { /* remembered until reload */ }
  };

  const copyAll = useCallback(async (value = text) => {
    if (!value.trim()) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("extract.copied"));
    } catch {
      toast.error(t("extract.copy_failed"));
    }
  }, [text, t]);

  const finish = useCallback(
    (result: string, resultKind: ExtractKind, resultSegments: TranscriptSegment[] | null = null) => {
      setText(result);
      setSegments(resultSegments);
      setPhase("done");
      setProgress(null);
      if (!result.trim()) {
        toast.info(t("extract.nothing_found"));
        return;
      }
      logActivity(resultKind === "audio" ? "stt" : "ocr", result.slice(0, 60));
      const session = resultKind === "audio" ? audioSession : pageSession;
      void session.save({
        title: result.slice(0, 80),
        metadata: resultKind === "audio" ? { transcript: result, originalText: "", sttLanguage: language } : { extractedText: result },
      });
      if (autoCopy) void copyAll(result);
    },
    [audioSession, pageSession, language, autoCopy, copyAll, t],
  );

  const fail = useCallback((err: unknown, controller: AbortController) => {
    setPhase(text ? "done" : "idle");
    setProgress(null);
    if (err instanceof TranscribeCancelledError || controller.signal.aborted) {
      toast.info(t("extract.cancelled"));
      return;
    }
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("minute maximum") || msg.includes(`${MAX_DURATION_SECONDS / 60}-minute`)) toast.error(t("stt.too_long"));
    else if (msg.includes("cannot decode")) toast.error(t("stt.format_unsupported"));
    else if (/429|limit/i.test(msg)) toast.error(t("extract.limit_reached"));
    else toast.error(msg || t("extract.failed"));
  }, [text, t]);

  const runAudio = useCallback(async (file: File, controller: AbortController) => {
    if (file.size > MAX_FILE_SIZE_BYTES) return toast.error(t("stt.file_too_large"));
    if (audioNeedsLocalModel) return toast.error(t("extract.needs_local_model"));
    if (sttRoute === "cloud" && !canAffordAudio) return toast.error(t("extract.limit_reached"));
    if (isVideoFile(file)) toast.info(t("stt.video_info"));
    setPhase("running");
    setProgress({ labelKey: "extract.progress_audio", current: 0, total: 0 });
    try {
      const result = await transcribeLongForm({
        file,
        language,
        route: sttRoute,
        signal: controller.signal,
        onProgress: (ev) => {
          setProgress({ labelKey: "extract.progress_audio", current: ev.current ?? 0, total: ev.total ?? 0 });
          if (ev.partialTranscript) setText(ev.partialTranscript);
        },
      });
      finish(result.text, "audio", result.segments ?? null);
    } catch (err) {
      fail(err, controller);
    }
  }, [audioNeedsLocalModel, sttRoute, canAffordAudio, language, finish, fail, t]);

  const runPages = useCallback(async (file: File, fileKind: "image" | "pdf", controller: AbortController) => {
    if (file.size > getMaxFileSize(fileKind)) return toast.error(t("extract.file_too_large"));
    if (!user) return toast.error(t("extract.sign_in_for_pages"));
    if (!canAffordPage) return toast.error(t("extract.limit_reached"));
    setPhase("running");
    try {
      if (fileKind === "image") {
        setProgress({ labelKey: "extract.progress_page", current: 1, total: 1 });
        const result = await ocrPageImage(await readBase64(file), file.type || "image/jpeg");
        finish(result, "image");
        return;
      }
      const total = await getPdfPageCount(file);
      if (total > MAX_PDF_PAGES) {
        setPhase("idle");
        setProgress(null);
        toast.error(t("extract.too_many_pages").replace("{n}", String(MAX_PDF_PAGES)));
        return;
      }
      const pages: string[] = [];
      for await (const page of renderPdfPages(file, { signal: controller.signal })) {
        if (controller.signal.aborted) throw new TranscribeCancelledError();
        setProgress({ labelKey: "extract.progress_page", current: page.pageNum, total: page.totalPages });
        const pageText = await ocrPageImage(page.imageBase64, page.mimeType);
        pages.push(total > 1 ? `--- ${t("extract.page", "صفحہ")} ${page.pageNum} ---\n${pageText}` : pageText);
        setText(pages.join("\n\n"));
      }
      finish(pages.join("\n\n"), "pdf");
    } catch (err) {
      fail(err, controller);
    }
  }, [user, canAffordPage, finish, fail, t]);

  /** Extract text from a file: the kind is read from the file itself. */
  const start = useCallback(async (file: File) => {
    const fileKind = detectKind(file);
    const allowed = fileKind === "audio" ? audioAvailable : fileKind ? pagesAvailable : false;
    if (!fileKind || !allowed) {
      toast.error(t("extract.unsupported"));
      return;
    }
    // A new extraction is a new result, not an overwrite of the last one.
    audioSession.reset();
    pageSession.reset();
    const controller = new AbortController();
    abortRef.current = controller;
    setKind(fileKind);
    setFileName(file.name);
    setText("");
    setSegments(null);
    try {
      if (fileKind === "audio") await runAudio(file, controller);
      else await runPages(file, fileKind, controller);
    } finally {
      abortRef.current = null;
    }
  }, [audioAvailable, pagesAvailable, audioSession, pageSession, runAudio, runPages, t]);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
        void start(new File([blob], `${t("extract.recording")} ${stamp}.webm`, { type: blob.type }));
      };
      recorderRef.current = recorder;
      recorder.start();
      setPhase("recording");
    } catch {
      toast.error(t("extract.mic_denied"));
    }
  }, [start, t]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }, []);

  const startOver = useCallback(() => {
    audioSession.reset();
    pageSession.reset();
    setPhase("idle");
    setKind(null);
    setFileName("");
    setText("");
    setSegments(null);
  }, [audioSession, pageSession]);

  return {
    accept, audioAvailable, pagesAvailable,
    phase, kind, fileName, text, setText, segments, progress,
    language, setLanguage, sttRoute, autoCopy, setAutoCopy,
    start, cancel, startRecording, stopRecording, startOver, copyAll,
  };
}
