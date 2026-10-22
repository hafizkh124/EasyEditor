import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { usePageSession } from "@/hooks/usePageSession";
import { isVideoFile } from "@/lib/audio/formatSupport";
import type { TranscribeLanguage } from "@/lib/audio/transcribeLongForm";
import { blockReason, detectKind, type ExtractKind, type ExtractProgress } from "@/lib/extract/engine";
import { useExtractGate } from "@/lib/extract/useExtractGate";
import { toParagraphs, type TimedParagraph } from "@/lib/extract/timedParagraphs";
import type { TranscriptSegment } from "@/core/voice/types";
import { cancelJob, canResume, resumeJob, useJob } from "@/lib/jobs/jobStore";
import { startExtractJob, useExtractLive } from "@/lib/jobs/extractJob";
import { askJobNotificationPermission } from "@/lib/jobs/notificationPermission";

export { detectKind, type ExtractKind } from "@/lib/extract/engine";

/**
 * The Extract screen's state (SYSTEM-2026 §5): a recording, an audio or video
 * file, an image or a PDF goes in; text comes out. The kind is read from the
 * file — the user never chooses between "transcribe" and "OCR".
 *
 * The run itself is a queued job (`@/lib/jobs/extractJob`, §9): this screen
 * starts it and attaches to it by `?job=`, so leaving the page does not stop
 * it, and coming back — from the jobs strip or the finish notice — shows it
 * again. The job saves its result to the same session sections the old pages
 * used; `?session=` opens one from Files.
 */

export type ExtractPhase = "idle" | "recording" | "running" | "done";

const AUTO_COPY_KEY = "extract-autocopy";
/** The old OCR page's switch, read once so nobody loses their setting. */
const LEGACY_AUTO_COPY_KEY = "ocr-autocopy";

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
  const gate = useExtractGate();
  const [searchParams, setSearchParams] = useSearchParams();
  const jobId = searchParams.get("job");
  const job = useJob(jobId);
  const liveJob = useExtractLive(jobId);

  const [recording, setRecording] = useState(false);
  const [restored, setRestored] = useState<{ kind: ExtractKind; text: string } | null>(null);
  const [text, setText] = useState("");
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [language, setLanguage] = useState<TranscribeLanguage>("auto");
  const [autoCopy, setAutoCopyState] = useState(readAutoCopy);
  const recorderRef = useRef<MediaRecorder | null>(null);

  // Earlier results open from Files (`?session=`), from either old section.
  const restoreAs = useCallback((restoredKind: ExtractKind, meta: SessionMeta) => {
    const restoredText = meta.transcript ?? meta.extractedText ?? "";
    if (!restoredText) return;
    setRestored({ kind: restoredKind, text: restoredText });
    setText(restoredText);
    if (meta.sttLanguage) setLanguage(meta.sttLanguage);
  }, []);
  const restoreAudio = useCallback((m: SessionMeta) => restoreAs("audio", m), [restoreAs]);
  const restorePages = useCallback((m: SessionMeta) => restoreAs("image", m), [restoreAs]);
  usePageSession<SessionMeta>({ section: "transcribe", onRestore: restoreAudio });
  usePageSession<SessionMeta>({ section: "ocr", onRestore: restorePages });

  // A finished job from an earlier visit has no live state left — open its saved result.
  const savedSessionId = job?.meta?.sessionId as string | undefined;
  useEffect(() => {
    if (jobId && !liveJob && job?.status === "done" && savedSessionId) {
      const next = new URLSearchParams(searchParams);
      next.delete("job");
      next.set("session", savedSessionId);
      setSearchParams(next, { replace: true });
    }
  }, [jobId, liveJob, job?.status, savedSessionId, searchParams, setSearchParams]);

  // The job's text, as it grows and once it is done. Edits are local after that.
  const liveStatus = liveJob?.status;
  const liveText = liveJob?.text ?? "";
  useEffect(() => {
    if (liveStatus) setText(liveText);
  }, [liveStatus, liveText]);

  // The recording, for the read-along.
  const mediaFile = liveJob?.mediaFile ?? null;
  useEffect(() => {
    if (!mediaFile) {
      setMediaUrl(null);
      return;
    }
    const url = URL.createObjectURL(mediaFile);
    setMediaUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [mediaFile]);

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

  // Copy on finishing, when the switch is on and this screen saw it finish.
  const sawRunning = useRef(false);
  useEffect(() => {
    if (liveStatus === "running") {
      sawRunning.current = true;
      return;
    }
    if (!sawRunning.current) return;
    sawRunning.current = false;
    if (liveStatus === "done") {
      const result = liveJob?.result?.text ?? "";
      if (!result.trim()) toast.info(t("extract.nothing_found"));
      else if (autoCopy) void copyAll(result);
    }
    if (liveStatus === "cancelled") toast.info(t("extract.cancelled"));
    if (liveStatus === "failed" && liveJob?.error) toast.error(liveJob.error);
  }, [liveStatus, liveJob?.result, liveJob?.error, autoCopy, copyAll, t]);

  const openJob = useCallback((id: string | null) => {
    const next = new URLSearchParams(searchParams);
    next.delete("session");
    next.delete("shared");
    if (id) next.set("job", id);
    else next.delete("job");
    setSearchParams(next, { replace: !id });
  }, [searchParams, setSearchParams]);

  /** Extract text from a file: the kind is read from the file itself. */
  const start = useCallback(async (file: File) => {
    const fileKind = detectKind(file);
    const blocked = blockReason(file, fileKind, gate);
    if (blocked || !fileKind) {
      toast.error(t(blocked ?? "extract.unsupported"));
      return;
    }
    if (fileKind === "audio" && isVideoFile(file)) toast.info(t("stt.video_info"));
    askJobNotificationPermission();
    setRestored(null);
    setText("");
    const { id } = startExtractJob({ file, kind: fileKind, language, sttRoute: gate.sttRoute, userId: user?.id ?? null, pageLabel: t("extract.page", "صفحہ") });
    openJob(id);
  }, [gate, language, user, openJob, t]);

  const cancel = useCallback(() => {
    if (jobId) cancelJob(jobId);
  }, [jobId]);

  const resume = useCallback(() => {
    if (jobId) void resumeJob(jobId);
  }, [jobId]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
        void start(new File([blob], `${t("extract.recording")} ${stamp}.webm`, { type: blob.type }));
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      toast.error(t("extract.mic_denied"));
    }
  }, [start, t]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }, []);

  const startOver = useCallback(() => {
    setRestored(null);
    setText("");
    const next = new URLSearchParams(searchParams);
    next.delete("job");
    next.delete("session");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // What the screen shows, from the job (this visit), a restored result, or nothing.
  const result = liveJob?.result ?? null;
  const phase: ExtractPhase = recording
    ? "recording"
    : liveStatus === "running"
      ? "running"
      : liveStatus === "done" || restored
        ? "done"
        : liveStatus === "failed" && text
          ? "done"
          : "idle";
  const kind: ExtractKind | null = liveJob?.kind ?? restored?.kind ?? null;
  const segments: TranscriptSegment[] | null = result?.segments ?? null;
  const timing = result?.timing;
  const paragraphs: TimedParagraph[] | null = useMemo(() => (timing ? toParagraphs(timing.segments) : null), [timing]);
  const progress: ExtractProgress | null = liveJob?.progress ?? null;
  /** A job the app closed on (or that failed) and can pick up again. */
  const resumable = !liveJob && job && canResume(job) ? job : null;

  return {
    accept: gate.accept, audioAvailable: gate.audioAvailable, pagesAvailable: gate.pagesAvailable, pageEngine: gate.pageEngine,
    phase, kind, fileName: liveJob?.fileName ?? "", text, setText, segments, progress, mediaUrl, paragraphs,
    timesExact: Boolean(result?.timing?.exact), pageImages: result?.pageImages ?? null,
    language, setLanguage, sttRoute: gate.sttRoute, autoCopy, setAutoCopy,
    start, cancel, startRecording, stopRecording, startOver, copyAll,
    resumable, resume,
  };
}
