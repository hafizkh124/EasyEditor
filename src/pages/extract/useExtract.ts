import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePageSession } from "@/hooks/usePageSession";
import { isVideoFile } from "@/lib/audio/formatSupport";
import type { TranscribeLanguage } from "@/lib/audio/transcribeLongForm";
import { logActivity } from "@/lib/activityLog";
import { blockReason, describeFailure, detectKind, runExtraction, type ExtractKind, type ExtractProgress } from "@/lib/extract/engine";
import { useExtractGate } from "@/lib/extract/useExtractGate";
import { toParagraphs, type TimedParagraph } from "@/lib/extract/timedParagraphs";
import type { TranscriptSegment } from "@/core/voice/types";

export { detectKind, type ExtractKind } from "@/lib/extract/engine";

/**
 * The Extract screen's state (SYSTEM-2026 §5): a recording, an audio or video
 * file, an image or a PDF goes in; text comes out. The kind is read from the
 * file — the user never chooses between "transcribe" and "OCR". The engine
 * itself is `@/lib/extract/engine`, shared with the editor.
 *
 * Results save to the same session sections the old pages used, so earlier
 * results still open. A microphone recording goes through the same engine as
 * a file — local Whisper when it is installed.
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
  const gate = useExtractGate();

  const [phase, setPhase] = useState<ExtractPhase>("idle");
  const [kind, setKind] = useState<ExtractKind | null>(null);
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [segments, setSegments] = useState<TranscriptSegment[] | null>(null);
  // Read-along (SYSTEM-2026 §5): the recording itself, and the transcript in
  // timed paragraphs. Only for a run in this visit — a result reopened from
  // Files has no recording to play.
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [paragraphs, setParagraphs] = useState<TimedParagraph[] | null>(null);
  const [timesExact, setTimesExact] = useState(false);
  const replaceMedia = useCallback((file: File | null) => {
    setMediaUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return file ? URL.createObjectURL(file) : null;
    });
  }, []);
  useEffect(() => () => replaceMedia(null), [replaceMedia]);
  const [progress, setProgress] = useState<ExtractProgress | null>(null);
  const [language, setLanguage] = useState<TranscribeLanguage>("auto");
  const [autoCopy, setAutoCopyState] = useState(readAutoCopy);
  const abortRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  // Earlier results open from Files (`?session=`), from either old section.
  const restoreAs = useCallback((restoredKind: ExtractKind, meta: SessionMeta) => {
    const restoredText = meta.transcript ?? meta.extractedText ?? "";
    if (!restoredText) return;
    setText(restoredText);
    setKind(restoredKind);
    setPhase("done");
    if (meta.sttLanguage) setLanguage(meta.sttLanguage);
  }, []);
  const restoreAudio = useCallback((m: SessionMeta) => restoreAs("audio", m), [restoreAs]);
  const restorePages = useCallback((m: SessionMeta) => restoreAs("image", m), [restoreAs]);
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

  /** Extract text from a file: the kind is read from the file itself. */
  const start = useCallback(async (file: File) => {
    const fileKind = detectKind(file);
    const blocked = blockReason(file, fileKind, gate);
    if (blocked || !fileKind) {
      toast.error(t(blocked ?? "extract.unsupported"));
      return;
    }
    if (fileKind === "audio" && isVideoFile(file)) toast.info(t("stt.video_info"));
    // A new extraction is a new result, not an overwrite of the last one.
    audioSession.reset();
    pageSession.reset();
    const controller = new AbortController();
    abortRef.current = controller;
    setKind(fileKind);
    setFileName(file.name);
    setText("");
    setSegments(null);
    setParagraphs(null);
    replaceMedia(fileKind === "audio" ? file : null);
    setPhase("running");
    try {
      const result = await runExtraction({
        file,
        kind: fileKind,
        language,
        sttRoute: gate.sttRoute,
        signal: controller.signal,
        pageLabel: t("extract.page", "صفحہ"),
        onProgress: (p) => {
          setProgress(p);
          if (p.partial) setText(p.partial);
        },
      });
      setText(result.text);
      setSegments(result.segments);
      setParagraphs(result.timing ? toParagraphs(result.timing.segments) : null);
      setTimesExact(Boolean(result.timing?.exact));
      setPhase("done");
      if (!result.text.trim()) {
        toast.info(t("extract.nothing_found"));
        return;
      }
      logActivity(fileKind === "audio" ? "stt" : "ocr", result.text.slice(0, 60));
      void (fileKind === "audio" ? audioSession : pageSession).save({
        title: result.text.slice(0, 80),
        metadata: fileKind === "audio"
          ? { transcript: result.text, originalText: "", sttLanguage: language }
          : { extractedText: result.text },
      });
      if (autoCopy) void copyAll(result.text);
    } catch (err) {
      setPhase((p) => (p === "running" && text ? "done" : "idle"));
      const failure = describeFailure(err, controller.signal);
      if (!failure) toast.info(t("extract.cancelled"));
      else if ("message" in failure) toast.error(failure.message);
      else toast.error(failure.replace ? t(failure.key).replace(...failure.replace) : t(failure.key));
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  }, [gate, language, audioSession, pageSession, autoCopy, copyAll, text, t, replaceMedia]);

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
    setParagraphs(null);
    replaceMedia(null);
  }, [audioSession, pageSession, replaceMedia]);

  return {
    accept: gate.accept, audioAvailable: gate.audioAvailable, pagesAvailable: gate.pagesAvailable,
    phase, kind, fileName, text, setText, segments, progress, mediaUrl, paragraphs, timesExact,
    language, setLanguage, sttRoute: gate.sttRoute, autoCopy, setAutoCopy,
    start, cancel, startRecording, stopRecording, startOver, copyAll,
  };
}
