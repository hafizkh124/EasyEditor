import { useSeo } from "@/hooks/useSeo";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mic, MicOff, Copy, Loader2, GraduationCap, Heart, Scissors, BookOpen, ArrowLeftRight, Upload, X, SpellCheck, Languages, MessageSquarePlus, FileText } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import TokenCostBadge from "@/components/TokenCostBadge";
import { Badge } from "@/components/ui/badge";
import { ACCEPTED_MEDIA } from "@/lib/audio/formatSupport";
import { SaveToLibraryButton } from "@/components/workspace/SaveToLibraryButton";
import { editorRoute } from "@/lib/routes";
import { STT_LANGUAGES, type SttLanguage } from "./transcribe/sttLanguages";
import { useTranscribeWorkflow } from "./transcribe/useTranscribeWorkflow";
import type { RefineAction } from "./transcribe/sttLanguages";

const refineActions: { action: RefineAction; icon: typeof GraduationCap; labelKey: string }[] = [
  { action: "spelling_check", icon: SpellCheck, labelKey: "stt.spelling_check" },
  { action: "normalize_script", icon: Languages, labelKey: "stt.normalize_script" },
  { action: "formalize", icon: GraduationCap, labelKey: "stt.formalize" },
  { action: "humanize", icon: Heart, labelKey: "stt.humanize" },
  { action: "shorten", icon: Scissors, labelKey: "stt.shorten" },
  { action: "citations", icon: BookOpen, labelKey: "stt.citations" },
];

const Transcribe = () => {
  useSeo({ title: "Transcribe — Al-Ulama Easy Editor", description: "Speech-to-text in Urdu, Arabic and English with smart AI editing for scholars and students.", path: "/transcribe", noindex: true });

  const { t } = useLanguage();
  const {
    isRecording, startRecording, stopRecording,
    isUploading, isProcessing, handleFileUpload, handleCancelTranscribe,
    progressPhase, progressCurrent, progressTotal, longFormStartedAt,
    transcript, originalText, showCompare, setShowCompare,
    hasTimestamps, handleSubtitleDownload, handleRevert, handleNewSession,
    isRefining, activeAction, handleRefine,
    sttLanguage, setSttLanguage, sttRoute, limitReached, needsLocalModel,
    handleCopy, rtlText, sttDir, fileInputRef, navigate,
  } = useTranscribeWorkflow();

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
                {t("stt.local_mode", "مقامی Whisper — مفت")}
              </Badge>
              {/* FR-6.10: state the known quality limits before the user relies on it. */}
              <span className="text-xs text-muted-foreground">
                {t("stt.local_quality_note", "نتیجہ ایک مسودہ ہے — اردو میں تقریباً 10–15% الفاظ کی غلطی متوقع ہے، اور اردو‑انگریزی ملے جلے کلام میں اس سے زیادہ۔")}
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
                        : t("stt.no_timestamps", "اس انجن سے وقت کے نشانات نہیں ملے — سب ٹائٹل کے لیے Settings سے مقامی Whisper منتخب کریں۔")
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
