import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, Copy, Download } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import { cn } from "@/lib/utils";

type SttLanguage = "en-US" | "ur-PK";

const Transcribe = () => {
  const { user } = useAuth();
  const { t, direction } = useLanguage();
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [sttLanguage, setSttLanguage] = useState<SttLanguage>("en-US");
  const [secondsUsed, setSecondsUsed] = useState(0);
  const [limit, setLimit] = useState(300);
  const [tier, setTier] = useState("free");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);

  const sttDir = sttLanguage === "ur-PK" ? "rtl" : "ltr";

  useEffect(() => {
    if (!user) return;
    supabase.from("subscriptions")
      .select("tier, transcription_seconds_used, transcription_limit")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setSecondsUsed(data.transcription_seconds_used);
          setLimit(data.transcription_limit);
          setTier(data.tier);
        }
      });
  }, [user]);

  const limitReached = tier === "free" && secondsUsed >= limit;

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
          // Convert blob to base64
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve) => {
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });

          const { data, error } = await supabase.functions.invoke("transcribe", {
            body: { audio: base64, language: sttLanguage, duration },
          });

          if (error) throw error;
          if (data?.text) {
            setTranscript((prev) => (prev ? prev + "\n" + data.text : data.text));
            setSecondsUsed((prev) => prev + duration);
          }
        } catch (err: any) {
          toast.error(err.message || "Transcription failed");
        }
        setIsProcessing(false);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch {
      toast.error("Microphone access denied");
    }
  }, [sttLanguage, limitReached, t]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(transcript);
    toast.success(t("stt.copy") + " ✓");
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
        {tier === "free" && (
          <div className="flex items-center gap-2">
            <Badge variant={limitReached ? "destructive" : "secondary"}>
              {secondsUsed}s / {limit}s
            </Badge>
            {limitReached && <span className="text-sm text-destructive">{t("stt.limit_reached")}</span>}
          </div>
        )}

        {/* Mic Button */}
        <div className="flex justify-center py-8">
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
        </div>

        <p className="text-center text-sm text-muted-foreground">
          {isRecording ? t("stt.recording") : isProcessing ? t("stt.processing") : t("stt.start")}
        </p>

        {/* Transcript */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg">{t("stt.transcript")}</CardTitle>
            {transcript && (
              <div className="flex gap-2">
                <Button variant="ghost" size="icon" onClick={handleCopy}>
                  <Copy className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={handleDownload}>
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            <div
              dir={sttDir}
              className={cn(
                "min-h-[200px] rounded-md border border-input bg-background p-4 text-sm whitespace-pre-wrap",
                !transcript && "text-muted-foreground"
              )}
            >
              {transcript || t("stt.no_transcript")}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default Transcribe;
