import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePageSession } from "@/hooks/usePageSession";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mic, MicOff, Copy, Download, Loader2, GraduationCap, Heart, Scissors, BookOpen, ArrowLeftRight, Upload } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { logActivity } from "@/lib/activityLog";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useLimitReached } from "@/hooks/useLimitReached";
import { isRtlText } from "@/utils/textUtils";

type SttLanguage = "en-US" | "ur-PK";
type RefineAction = "formalize" | "humanize" | "shorten" | "citations";

const refineActions: { action: RefineAction; icon: typeof GraduationCap; labelKey: string }[] = [
  { action: "formalize", icon: GraduationCap, labelKey: "stt.formalize" },
  { action: "humanize", icon: Heart, labelKey: "stt.humanize" },
  { action: "shorten", icon: Scissors, labelKey: "stt.shorten" },
  { action: "citations", icon: BookOpen, labelKey: "stt.citations" },
];

const ACCEPTED_AUDIO = ".mp3,.wav,.m4a,.ogg,.webm,.flac,.aac";

const Transcribe = () => {
  const { session } = useAuth();
  const { t } = useLanguage();
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [originalText, setOriginalText] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [activeAction, setActiveAction] = useState<RefineAction | null>(null);
  const [showCompare, setShowCompare] = useState(false);
  const [sttLanguage, setSttLanguage] = useState<SttLanguage>("en-US");
  const { subscription } = useSubscription();
  const [secondsUsed, setSecondsUsed] = useState(0);
  // Optimistic delta over the persisted value so local increments count.
  const optimisticDelta = Math.max(0, secondsUsed - (subscription?.transcription_seconds_used ?? 0));
  const { limit: limitRaw, reached: limitReached } = useLimitReached("transcription", optimisticDelta);
  const limit = limitRaw || 300; // fallback for display when tier has no explicit limit
  const [isUploading, setIsUploading] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sttDir = sttLanguage === "ur-PK" ? "rtl" : "ltr";
  const rtlText = isRtlText(transcript);

  // Session persistence
  const handleRestoreSession = useCallback((metadata: { transcript?: string; originalText?: string; sttLanguage?: SttLanguage }) => {
    if (typeof metadata.transcript === "string") setTranscript(metadata.transcript);
    if (typeof metadata.originalText === "string") setOriginalText(metadata.originalText);
    if (metadata.sttLanguage === "en-US" || metadata.sttLanguage === "ur-PK") setSttLanguage(metadata.sttLanguage);
  }, []);
  const { save: saveSession } = usePageSession<{ transcript: string; originalText: string; sttLanguage: SttLanguage }>({
    section: "transcribe",
    onRestore: handleRestoreSession,
  });
  const persistTranscript = useCallback((text: string, original: string = originalText) => {
    if (!text.trim()) return;
    saveSession({ title: text.slice(0, 80), metadata: { transcript: text, originalText: original, sttLanguage } });
  }, [saveSession, sttLanguage, originalText]);

  // Seed local secondsUsed from context once it loads (keeps optimistic increments working)
  useEffect(() => {
    if (subscription) {
      setSecondsUsed(subscription.transcription_seconds_used);
    }
  }, [subscription]);

  // --- Audio file upload handler ---
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSize = 25 * 1024 * 1024; // 25MB
    if (file.size > maxSize) {
      toast.error(t("stt.file_too_large"));
      return;
    }

    if (limitReached) {
      toast.error(t("stt.limit_reached"));
      return;
    }

    setIsUploading(true);
    setIsProcessing(true);

    try {
      // Estimate duration from file size (rough: ~16KB/s for compressed audio)
      const estimatedDuration = Math.max(1, Math.round(file.size / 16000));

      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const { data, error } = await supabase.functions.invoke("transcribe", {
        body: { audio: base64, language: sttLanguage, duration: estimatedDuration },
      });

      if (error) throw error;
      if (data?.text) {
        const newText = transcript ? transcript + "\n" + data.text : data.text;
        setTranscript(newText);
        setOriginalText("");
        setSecondsUsed((prev) => prev + estimatedDuration);
        logActivity("stt", data.text.slice(0, 60));
        persistTranscript(newText, "");
        toast.success(t("stt.upload_success"));
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("stt.upload_error"));
    } finally {
      setIsProcessing(false);
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [sttLanguage, limitReached, t, transcript]);

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
            setSecondsUsed((prev) => prev + duration);
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
        toast.success(t(`stt.${action}_done`));
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

  const handleDownload = () => {
    const blob = new Blob([transcript], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "transcript.txt";
    a.click();
    URL.revokeObjectURL(url);
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
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t("stt.language")}:</span>
            <Select value={sttLanguage} onValueChange={(v) => setSttLanguage(v as SttLanguage)}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en-US">English</SelectItem>
                <SelectItem value="ur-PK">اردو (Urdu)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Usage Badge */}
        {limit > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={limitReached ? "destructive" : "secondary"}>
              {secondsUsed}s / {limit}s
            </Badge>
            {limitReached && <span className="text-sm text-destructive">{t("stt.limit_reached")}</span>}
          </div>
        )}

        {/* Mic + Upload Buttons */}
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="flex items-center gap-6">
            <button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isProcessing || limitReached}
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
                accept={ACCEPTED_AUDIO}
                className="hidden"
                onChange={handleFileUpload}
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
                <Button variant="ghost" size="icon" onClick={handleCopy}>
                  <Copy className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={handleDownload}>
                  <Download className="h-4 w-4" />
                </Button>
                {originalText && (
                  <Button
                    variant="ghost"
                    size="icon"
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
                      {t(labelKey)}
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
