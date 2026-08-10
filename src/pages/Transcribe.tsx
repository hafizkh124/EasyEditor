import { useState, useRef, useCallback, useEffect } from "react";
import { useSeo } from "@/hooks/useSeo";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePageSession } from "@/hooks/usePageSession";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mic, MicOff, Copy, Loader2, GraduationCap, Heart, Scissors, BookOpen, ArrowLeftRight, Upload, X, SpellCheck, Languages, MessageSquarePlus, FileText } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { logActivity } from "@/lib/activityLog";
import { useCanAfford } from "@/hooks/useTokenBalance";
import TokenCostBadge from "@/components/TokenCostBadge";
import { Badge } from "@/components/ui/badge";
import { isRtlText } from "@/utils/textUtils";
import {
  transcribeLongForm,
  resolveSttRoute,
  TranscribeCancelledError,
  MAX_DURATION_SECONDS,
  type ProgressPhase,
  type TranscribeLanguage,
  type SttRoute,
} from "@/lib/audio/transcribeLongForm";
import { toSrt } from "@/lib/subtitles/toSrt";
import { toVtt } from "@/lib/subtitles/toVtt";
import type { TranscriptSegment } from "@/core/voice/types";
import { ACCEPTED_MEDIA, isVideoFile, MAX_FILE_SIZE_BYTES } from "@/lib/audio/formatSupport";
import { SaveToLibraryButton } from "@/components/workspace/SaveToLibraryButton";
import { editorRoute } from "@/lib/routes";
import { isDesktop } from "@/utils/environment";

type SttLanguage = TranscribeLanguage;
type RefineAction = "formalize" | "humanize" | "shorten" | "citations" | "spelling_check" | "normalize_script";

const refineActions: { action: RefineAction; icon: typeof GraduationCap; labelKey: string }[] = [
  { action: "spelling_check", icon: SpellCheck, labelKey: "stt.spelling_check" },
  { action: "normalize_script", icon: Languages, labelKey: "stt.normalize_script" },
  { action: "formalize", icon: GraduationCap, labelKey: "stt.formalize" },
  { action: "humanize", icon: Heart, labelKey: "stt.humanize" },
  { action: "shorten", icon: Scissors, labelKey: "stt.shorten" },
  { action: "citations", icon: BookOpen, labelKey: "stt.citations" },
];

/** Language options for the transcription selector. */
const STT_LANGUAGES: { code: SttLanguage; labelKey: string }[] = [
  { code: "auto", labelKey: "stt.lang_auto" },
  { code: "ur-PK", labelKey: "stt.lang_ur" },
  { code: "ar", labelKey: "stt.lang_ar" },
  { code: "en-US", labelKey: "stt.lang_en" },
  { code: "pa", labelKey: "stt.lang_pa" },
  { code: "ps", labelKey: "stt.lang_ps" },
  { code: "fa", labelKey: "stt.lang_fa" },
  { code: "sd", labelKey: "stt.lang_sd" },
  { code: "bal", labelKey: "stt.lang_bal" },
];

const Transcribe = () => {
  useSeo({ title: "Transcribe — Al-Ulama Easy Editor", description: "Speech-to-text in Urdu, Arabic and English with smart AI editing for scholars and students.", path: "/transcribe", noindex: true });

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
  }, [sttLanguage, limitReached, t, transcript, persistTranscript, resetProgress]);

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
  }, [sttLanguage, limitReached, t, transcript]);

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

  return (
    <AppLayout>
      <div className="p-4 md:p-8 space-y-6 max-w-3xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <h1 className="text-2xl font-bold text-foreground">{t("stt.title")}</h1>
        </div>

        {/* Usage Badge — FR-6.8: the local route is free, so no cost is shown for it. */}
        <div className="flex items-center gap-2 flex-wrap">
          {sttRoute === "local" ? (
            <>
              <Badge variant="outline" className="text-xs">
                {t("stt.local_mode") || "مقامی Whisper — مفت"}
              </Badge>
              {/* FR-6.10: state the known quality limits before the user relies on it. */}
              <span className="text-xs text-muted-foreground">
                {t("stt.local_quality_note") ||
                  "نتیجہ ایک مسودہ ہے — اردو میں تقریباً 10–15% الفاظ کی غلطی متوقع ہے، اور اردو‑انگریزی ملے جلے کلام میں اس سے زیادہ۔"}
              </span>
            </>
          ) : (
            <>
              {!needsLocalModel && <TokenCostBadge action="stt" quantity={1} />}
              {limitReached && (
                <span className="text-sm text-destructive">
                  {needsLocalModel ? t("stt.needs_local_model") : t("stt.limit_reached")}
                </span>
              )}
            </>
          )}
        </div>

        {/* Long-form Progress (FR-3.3, FR-3.4) */}
        {progressPhase && (
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">
                  {progressPhase === "extracting" && t("stt.extracting_audio")}
                  {progressPhase === "decoding" && t("stt.progress.decoding")}
                  {progressPhase === "preparing" && t("stt.progress.preparing")}
                  {progressPhase === "transcribing" && t("stt.progress.transcribing")
                    .replace("{current}", String(progressCurrent))
                    .replace("{total}", String(progressTotal))}
                  {progressPhase === "finalizing" && t("stt.progress.finalizing")}
                </span>
                {longFormStartedAt && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {(() => {
                      const elapsed = Math.floor((Date.now() - longFormStartedAt) / 1000);
                      const m = Math.floor(elapsed / 60);
                      const s = elapsed % 60;
                      return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
                    })()}
                  </span>
                )}
              </div>
              <Progress
                value={
                  progressPhase === "extracting"
                    ? 3
                    : progressPhase === "decoding"
                    ? 5
                    : progressPhase === "preparing"
                    ? 10
                    : progressPhase === "transcribing" && progressTotal > 0
                    ? 10 + (progressCurrent / progressTotal) * 85
                    : 100
                }
                className="h-2"
              />
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancelTranscribe}
                  className="gap-1.5"
                >
                  <X className="h-3.5 w-3.5" />
                  {t("stt.cancel")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Mic + Upload Buttons */}
        <div className="flex flex-col items-center gap-4 py-6 sm:py-8">
          <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
            <button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isProcessing || limitReached}
              aria-label={isRecording ? t("stt.stop") : t("stt.start")}
              className={cn(
                "relative flex h-24 w-24 items-center justify-center rounded-full transition-all",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isRecording
                  ? "bg-destructive text-destructive-foreground animate-pulse"
                  : "bg-primary text-primary-foreground hover:bg-primary/90",
                (isProcessing || limitReached) && "opacity-50 cursor-not-allowed"
              )}
            >
              {isRecording ? <MicOff className="h-10 w-10" /> : <Mic className="h-10 w-10" />}
            </button>

            <div className="flex flex-col items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_MEDIA}
                className="hidden"
                onChange={handleFileUpload}
                aria-label={t("stt.upload_file")}
              />
              <Button
                variant="outline"
                size="lg"
                disabled={isProcessing || limitReached || isUploading}
                onClick={() => fileInputRef.current?.click()}
                className="gap-2 h-16 px-6"
              >
                {isUploading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Upload className="h-5 w-5" />
                )}
                {isUploading ? t("stt.transcribing") : t("stt.upload_file")}
              </Button>
              <span className="text-xs text-muted-foreground">{t("stt.upload_hint")}</span>
            </div>
          </div>

          {/* Language Selector */}
          <div className="w-full max-w-xs mx-auto">
            <Select value={sttLanguage} onValueChange={(v) => setSttLanguage(v as SttLanguage)}>
              <SelectTrigger className="w-full" aria-label={t("stt.language")}>
                <SelectValue placeholder={t("stt.language")} />
              </SelectTrigger>
              <SelectContent>
                {STT_LANGUAGES.map(({ code, labelKey }) => (
                  <SelectItem key={code} value={code}>
                    {t(labelKey as import("@/lib/i18n").TranslationKey)}
                    {(code === "sd" || code === "bal") ? " ⚠️" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(sttLanguage === "sd" || sttLanguage === "bal") && (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 text-center">
                {t("stt.low_accuracy_warning")}
              </p>
            )}
          </div>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          {isRecording ? t("stt.recording") : isProcessing ? (isUploading ? t("stt.transcribing") : t("stt.processing")) : t("stt.start")}
        </p>

        {/* Transcript Card */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg">{t("stt.transcript")}</CardTitle>
            {transcript && (
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" aria-label={t("stt.copy")} onClick={handleCopy}>
                  <Copy className="h-4 w-4" />
                </Button>
                {/* FR-6.3: shown always, but disabled without timestamps — and it
                    says why, so the capability is discoverable rather than absent.
                    Disabled means no empty file can ever be written. */}
                {(["srt", "vtt"] as const).map((format) => (
                  <Button
                    key={format}
                    variant="ghost"
                    size="sm"
                    disabled={!hasTimestamps}
                    aria-label={t(`stt.download_${format}` as import("@/lib/i18n").TranslationKey) || `${format.toUpperCase()} ڈاؤن لوڈ کریں`}
                    title={
                      hasTimestamps
                        ? t(`stt.download_${format}` as import("@/lib/i18n").TranslationKey) || `${format.toUpperCase()} ڈاؤن لوڈ کریں`
                        : t("stt.no_timestamps") ||
                          "اس انجن سے وقت کے نشانات نہیں ملے — سب ٹائٹل کے لیے Settings سے مقامی Whisper منتخب کریں۔"
                    }
                    onClick={() => handleSubtitleDownload(format)}
                  >
                    {format.toUpperCase()}
                  </Button>
                ))}
                <Button variant="ghost" size="icon" aria-label={t("editor.open_in_editor")} title={t("editor.open_in_editor")} onClick={() => navigate(editorRoute(), { state: { content: transcript, source: "transcribe" } })}>
                  <FileText className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label={t("common.new_chat")} title={t("common.new_chat")} onClick={handleNewSession}>
                  <MessageSquarePlus className="h-4 w-4" />
                </Button>
                {/* SPEC-M4 FR-2.8: the transcript joins the searchable corpus. */}
                <SaveToLibraryButton
                  text={transcript}
                  title={transcript.slice(0, 60)}
                  kind="audio"
                  className="h-9 px-2 text-xs"
                />
                {originalText && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={showCompare ? t("stt.refined") : t("stt.original")}
                    aria-pressed={showCompare}
                    onClick={() => setShowCompare(!showCompare)}
                    className={cn(showCompare && "text-primary")}
                  >
                    <ArrowLeftRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Compare View */}
            {showCompare && originalText ? (
              <Tabs defaultValue="refined" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="refined">{t("stt.refined")}</TabsTrigger>
                  <TabsTrigger value="original">{t("stt.original")}</TabsTrigger>
                </TabsList>
                <TabsContent value="refined">
                  <div
                    dir={rtlText ? "rtl" : "ltr"}
                    className={cn(
                      "min-h-[200px] rounded-md border border-input bg-background p-4 text-sm whitespace-pre-wrap",
                      rtlText && "text-right"
                    )}
                  >
                    {transcript}
                  </div>
                </TabsContent>
                <TabsContent value="original">
                  <div
                    dir={rtlText ? "rtl" : "ltr"}
                    className={cn(
                      "min-h-[200px] rounded-md border border-input bg-background p-4 text-sm whitespace-pre-wrap",
                      rtlText && "text-right"
                    )}
                  >
                    {originalText}
                  </div>
                </TabsContent>
              </Tabs>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div
                  key={transcript}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25 }}
                  dir={sttDir}
                  className={cn(
                    "min-h-[200px] rounded-md border border-input bg-background p-4 text-sm whitespace-pre-wrap",
                    !transcript && "text-muted-foreground"
                  )}
                >
                  {transcript || t("stt.no_transcript")}
                </motion.div>
              </AnimatePresence>
            )}

            {/* AI Refinement Toolbar */}
            {transcript && (
              <div className="space-y-3">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t("stt.ai_tools")}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {refineActions.map(({ action, icon: Icon, labelKey }) => (
                    <Button
                      key={action}
                      variant="outline"
                      size="sm"
                      disabled={isRefining}
                      onClick={() => handleRefine(action)}
                      className="gap-1.5"
                    >
                      {isRefining && activeAction === action ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Icon className="h-3.5 w-3.5" />
                      )}
                      {t(labelKey as import("@/lib/i18n").TranslationKey)}
                    </Button>
                  ))}

                  {originalText && (
                    <Button variant="ghost" size="sm" onClick={handleRevert} className="text-destructive">
                      {t("stt.revert")}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default Transcribe;
