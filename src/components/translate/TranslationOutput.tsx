import { useState } from "react";
import { Sparkles, Mic, PenLine, Loader2, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { isRtlText } from "@/utils/textUtils";
import type { TranslationMode } from "@/hooks/useTranslation";

interface TranslationOutputProps {
  translationText: string;
  streamingText: string;
  isTranslating: boolean;
  onTranslateAi: () => void;
  onUpdateText: (text: string) => void;
  onVoiceResult: (text: string) => void;
  t: (k: string) => string;
}

const TranslationOutput = ({
  translationText, streamingText, isTranslating,
  onTranslateAi, onUpdateText, onVoiceResult, t,
}: TranslationOutputProps) => {
  const [activeMode, setActiveMode] = useState<TranslationMode>("ai");
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);

  const displayText = isTranslating ? streamingText : translationText;
  const isRtl = isRtlText(displayText);

  const modes = [
    { key: "ai" as TranslationMode, icon: Sparkles, label: t("translate.mode_ai") },
    { key: "voice" as TranslationMode, icon: Mic, label: t("translate.mode_voice") },
    { key: "manual" as TranslationMode, icon: PenLine, label: t("translate.mode_manual") },
  ];

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1];
          onVoiceResult(base64);
        };
        reader.readAsDataURL(blob);
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch {
      // Mic permission denied or not available
    }
  };

  const stopRecording = () => {
    mediaRecorder?.stop();
    setIsRecording(false);
    setMediaRecorder(null);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Mode tabs */}
      <div className="flex items-center gap-1 p-2 border-b border-border bg-muted/20">
        {modes.map((m) => (
          <Button
            key={m.key}
            variant={activeMode === m.key ? "default" : "ghost"}
            size="sm"
            className="gap-1.5 text-xs h-8"
            onClick={() => setActiveMode(m.key)}
          >
            <m.icon className="h-3.5 w-3.5" />
            {m.label}
          </Button>
        ))}
      </div>

      {/* Action bar based on mode */}
      <div className="p-3 border-b border-border">
        {activeMode === "ai" && (
          <Button
            onClick={onTranslateAi}
            disabled={isTranslating}
            className="w-full gap-2"
            size="sm"
          >
            {isTranslating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {isTranslating ? t("translate.translating") : t("translate.translate_btn")}
          </Button>
        )}
        {activeMode === "voice" && (
          <Button
            onClick={isRecording ? stopRecording : startRecording}
            variant={isRecording ? "destructive" : "default"}
            className="w-full gap-2"
            size="sm"
          >
            {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {isRecording ? t("translate.stop_recording") : t("translate.start_recording")}
          </Button>
        )}
        {activeMode === "manual" && (
          <p className="text-xs text-muted-foreground">{t("translate.manual_hint")}</p>
        )}
      </div>

      {/* Translation text area */}
      <div className="flex-1 p-3">
        <Textarea
          value={displayText}
          onChange={(e) => onUpdateText(e.target.value)}
          dir={isRtl ? "rtl" : "ltr"}
          className={cn(
            "h-full min-h-[200px] resize-none text-sm leading-relaxed",
            isRtl && "text-right",
          )}
          placeholder={t("translate.output_placeholder")}
          readOnly={activeMode === "ai" && isTranslating}
        />
      </div>
    </div>
  );
};

export default TranslationOutput;
