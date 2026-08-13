import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePageSession } from "@/hooks/usePageSession";

import { toast } from "sonner";
import { logActivity } from "@/lib/activityLog";
import { useCanAfford } from "@/hooks/useTokenBalance";
import { isRtlText } from "@/utils/textUtils";
import {
  transcribeLongForm,
  resolveSttRoute,
  TranscribeCancelledError,
  MAX_DURATION_SECONDS,
  type ProgressPhase,
  type SttRoute,
} from "@/lib/audio/transcribeLongForm";
import { toSrt } from "@/lib/subtitles/toSrt";
import { toVtt } from "@/lib/subtitles/toVtt";
import type { TranscriptSegment } from "@/core/voice/types";
import { isVideoFile, MAX_FILE_SIZE_BYTES } from "@/lib/audio/formatSupport";
import { isDesktop } from "@/utils/environment";
import { STT_LANGUAGES, type SttLanguage, type RefineAction } from "./sttLanguages";

/**
 * The Transcribe page's workflow: resolve the STT route (offline Whisper vs
 * cloud), validate and run an upload through the chunked orchestrator, drive
 * live recording, then refine and export the transcript.
 *
 * Extracted from Transcribe.tsx so the page is layout only. Covered by
 * src/test/transcribePage.test.tsx, which drives it through the rendered page.
 */
export function useTranscribeWorkflow() {
  const { session, user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [originalText, setOriginalText] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [activeAction, setActiveAction] = useState<RefineAction | null>(null);
  const [showCompare, setShowCompare] = useState(false);
  const [sttLanguage, setSttLanguage] = useState<SttLanguage>("auto");
  const { canAfford: canAffordStt } = useCanAfford("stt", 1);
  // SPEC-M5 FR-6.2/FR-6.8: local transcription costs us nothing, so it must not
  // be gated on the token balance. The route is resolved up front (it depends on
  // whether a Whisper model is downloaded) and drives both the gate and the run.
  const [sttRoute, setSttRoute] = useState<SttRoute>("cloud");
  // A desktop user who has not signed in has no cloud route at all, so when no
  // Whisper model is downloaded the blocker is the missing model — not the
  // token balance. Saying "insufficient tokens" to someone with no account is
  // exactly the kind of dead end FR-2.5 exists to prevent.
  const needsLocalModel = isDesktop() && sttRoute === "cloud" && !user;
  const limitReached = needsLocalModel || (!canAffordStt && sttRoute === "cloud");
  const [segments, setSegments] = useState<TranscriptSegment[] | null>(null);
  const hasTimestamps = !!segments && segments.length > 0;
  const [isUploading, setIsUploading] = useState(false);
  const [progressPhase, setProgressPhase] = useState<ProgressPhase | null>(null);
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [longFormStartedAt, setLongFormStartedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveSttRoute()
      .then((r) => { if (!cancelled) setSttRoute(r); })
      .catch(() => { if (!cancelled) setSttRoute("cloud"); });
    return () => { cancelled = true; };
  }, []);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const rtlText = isRtlText(transcript);
  const sttDir = rtlText ? "rtl" : "ltr";

  // Session persistence
  const handleRestoreSession = useCallback((metadata: { transcript?: string; originalText?: string; sttLanguage?: SttLanguage }) => {
    if (typeof metadata.transcript === "string") setTranscript(metadata.transcript);
    if (typeof metadata.originalText === "string") setOriginalText(metadata.originalText);
    if (metadata.sttLanguage && STT_LANGUAGES.some((l) => l.code === metadata.sttLanguage)) setSttLanguage(metadata.sttLanguage);
  }, []);
  const { save: saveSession } = usePageSession<{ transcript: string; originalText: string; sttLanguage: SttLanguage }>({
    section: "transcribe",
    onRestore: handleRestoreSession,
  });
  const persistTranscript = useCallback((text: string, original: string = originalText) => {
    if (!text.trim()) return;
    saveSession({ title: text.slice(0, 80), metadata: { transcript: text, originalText: original, sttLanguage } });
  }, [saveSession, sttLanguage, originalText]);

  // --- Audio file upload handler (FR-3: long-form chunked transcription) ---
  const resetProgress = useCallback(() => {
    setProgressPhase(null);
    setProgressCurrent(0);
    setProgressTotal(0);
    setLongFormStartedAt(null);
  }, []);

  const handleCancelTranscribe = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset the input early so the same file can be re-selected after a cancel.
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (limitReached) {
      toast.error(t("stt.limit_reached"));
      return;
    }

    // File-size guard — reject files above 1 GB before attempting decode.
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error(t("stt.file_too_large"));
      return;
    }

    // Show info toast when uploading a video file.
    if (isVideoFile(file)) {
      toast.info(t("stt.video_info"));
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsUploading(true);
    setIsProcessing(true);
    setLongFormStartedAt(Date.now());

    try {
      // FR-3.7: persist the partial transcript after each chunk completes so a
      // page reload mid-transcription preserves the completed chunks. Track
      // the last persisted text to avoid duplicate writes when the orchestrator
      // emits both pre- and post-chunk events with the same partial.
      const priorTranscript = transcript;
      const compose = (partial: string) => (priorTranscript ? priorTranscript + "\n" + partial : partial);
      let lastPersisted = "";
      const { text, chunkCount, segments: newSegments } = await transcribeLongForm({
        file,
        language: sttLanguage,
        route: sttRoute,
        signal: controller.signal,
        onProgress: (ev) => {
          setProgressPhase(ev.phase);
          if (typeof ev.current === "number") setProgressCurrent(ev.current);
          if (typeof ev.total === "number") setProgressTotal(ev.total);
          if (typeof ev.partialTranscript === "string" && ev.partialTranscript) {
            const composed = compose(ev.partialTranscript);
            setTranscript(composed);
            if (composed !== lastPersisted) {
              persistTranscript(composed, "");
              lastPersisted = composed;
            }
          }
        },
      });

      if (text) {
        const newText = transcript ? transcript + "\n" + text : text;
        setTranscript(newText);
        setOriginalText("");
        setSegments(newSegments ?? null);
        logActivity("stt", text.slice(0, 60));
        persistTranscript(newText, "");
        toast.success(
          chunkCount > 1
            ? t("stt.upload_success_chunked").replace("{n}", String(chunkCount))
            : t("stt.upload_success"),
        );
      }
    } catch (err: unknown) {
      if (err instanceof TranscribeCancelledError || controller.signal.aborted) {
        toast.info(t("stt.cancelled"));
      } else {
        const msg = err instanceof Error ? err.message : t("stt.upload_error");
        const friendly = msg.includes("minute maximum") || msg.includes(`${MAX_DURATION_SECONDS / 60}-minute`)
          ? t("stt.too_long")
          : msg.includes("too large") || msg.includes("max 1 GB")
          ? t("stt.file_too_large")
          : msg.includes("cannot decode")
          ? t("stt.format_unsupported")
          : msg;
        toast.error(friendly);
      }
    } finally {
      abortRef.current = null;
      setIsProcessing(false);
      setIsUploading(false);
      resetProgress();
    }
    // `sttRoute` is resolved asynchronously on mount, so it MUST be a
    // dependency: without it this callback keeps the initial "cloud" value and
    // a desktop user with a downloaded Whisper model is silently routed to the
    // cloud — billed for a transcription that FR-6.2/FR-6.8 promise is free
    // and offline. Nothing else in this list changes when the route resolves.
  }, [sttLanguage, sttRoute, limitReached, t, transcript, persistTranscript, resetProgress]);

  const startRecording = useCallback(async () => {
    if (limitReached) {
      toast.error(t("stt.limit_reached"));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      startTimeRef.current = Date.now();

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const duration = Math.round((Date.now() - startTimeRef.current) / 1000);
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });

        setIsProcessing(true);
        try {
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });

          const { data, error } = await supabase.functions.invoke("transcribe", {
            body: { audio: base64, language: sttLanguage, duration },
          });

          if (error) throw error;
          if (data?.text) {
            const newText = transcript ? transcript + "\n" + data.text : data.text;
            setTranscript(newText);
            setOriginalText("");
            logActivity("stt", data.text.slice(0, 60));
            persistTranscript(newText, "");
          }
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : "Transcription failed");
        }
        setIsProcessing(false);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch {
      toast.error("Microphone access denied");
    }
    // Same reasoning as the upload handler: `persistTranscript` closes over
    // `originalText`, so leaving it out saves the session with a stale value.
  }, [sttLanguage, limitReached, t, transcript, persistTranscript]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  const handleRefine = async (action: RefineAction) => {
    if (!transcript.trim() || !session?.access_token) return;
    setIsRefining(true);
    setActiveAction(action);
    setShowCompare(false);

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
          body: JSON.stringify({ text: transcript, action }),
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Unknown error" }));
        toast.error(errData.error || t("stt.refine_error"));
        return;
      }

      const data = await response.json();
      if (data.text) {
        setOriginalText(transcript);
        setTranscript(data.text);
        persistTranscript(data.text, transcript);
        toast.success(t(`stt.${action}_done` as import("@/lib/i18n").TranslationKey));
      }
    } catch {
      toast.error(t("stt.refine_error"));
    } finally {
      setIsRefining(false);
      setActiveAction(null);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(transcript);
    toast.success(t("stt.copied"));
  };

  const handleNewSession = () => {
    setTranscript("");
    setOriginalText("");
    setShowCompare(false);
    setSegments(null);
  };

  /**
   * SPEC-M5 FR-6.3: subtitles come from the engine's own timestamps. The buttons
   * are hidden unless timestamps exist, so an empty file can never be written.
   */
  const handleSubtitleDownload = (format: "srt" | "vtt") => {
    if (!segments || segments.length === 0) return;
    const content = format === "srt" ? toSrt(segments) : toVtt(segments);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcript-${Date.now()}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("stt.subtitles_downloaded", `${format.toUpperCase()} downloaded.`));
  };

  const handleRevert = () => {
    if (originalText) {
      setTranscript(originalText);
      setOriginalText("");
      setShowCompare(false);
      toast.info(t("stt.reverted"));
    }
  };


  return {
    // recording
    isRecording, startRecording, stopRecording,
    // upload / long-form run
    isUploading, isProcessing, handleFileUpload, handleCancelTranscribe,
    progressPhase, progressCurrent, progressTotal, longFormStartedAt,
    // transcript
    transcript, setTranscript, originalText, showCompare, setShowCompare,
    segments, hasTimestamps, handleSubtitleDownload, handleRevert, handleNewSession,
    // refine
    isRefining, activeAction, handleRefine,
    // language + gating
    sttLanguage, setSttLanguage, sttRoute, limitReached, needsLocalModel,
    // misc
    handleCopy, rtlText, sttDir, fileInputRef, navigate, t,
  };
}
