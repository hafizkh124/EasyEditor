import { useState } from "react";
import { Sparkles, Mic, PenLine, Loader2, MicOff, SpellCheck, ChevronDown, Type, Search, RefreshCw, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { isRtlText } from "@/utils/textUtils";
import { stripHarakat } from "@/utils/arabicUtils";
import { useAuth } from "@/contexts/AuthContext";
import { callRefineText, type RefineTextAction } from "@/lib/editor/aiActions";
import ResourceSearchDialog from "@/components/editor/ResourceSearchDialog";

export type TranslationMode = "ai" | "voice" | "manual";

interface TranslationOutputProps {
  translationText: string;
  streamingText: string;
  isTranslating: boolean;
  onTranslateAi: () => void;
  onUpdateText: (text: string) => void;
  onVoiceResult: (text: string) => void;
  t: import("@/lib/i18n").Translator;
}

const TranslationOutput = ({
  translationText, streamingText, isTranslating,
  onTranslateAi, onUpdateText, onVoiceResult, t,
}: TranslationOutputProps) => {
  const { session } = useAuth();
  const [activeMode, setActiveMode] = useState<TranslationMode>("ai");
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [resourceOpen, setResourceOpen] = useState(false);

  const displayText = isTranslating ? streamingText : translationText;
  const isRtl = isRtlText(displayText);

  // ── AI actions on the output text (add harakat / spell check) ──
  const runTextAction = async (action: RefineTextAction, busyKey: string) => {
    if (!session?.access_token || !displayText.trim() || aiBusy) return;
    setAiBusy(busyKey);
    try {
      const result = await callRefineText(displayText, action, session.access_token);
      if (result) {
        onUpdateText(result);
        toast.success(t("editor.ai_done"));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("editor.ai_error"));
    } finally {
      setAiBusy(null);
    }
  };

  const handleRemoveHarakat = () => {
    if (!displayText.trim()) return;
    onUpdateText(stripHarakat(displayText));
    toast.success(t("editor.ai_done"));
  };

  const handleInsertResource = (text: string, citation: string) => {
    const block = `${text}\n[${citation}]`;
    onUpdateText(displayText.trim() ? `${displayText}\n\n${block}` : block);
    toast.success(t("editor.reference_inserted"));
  };

  const handleInsertResources = (items: Array<{ text: string; citation: string }>) => {
    if (items.length === 0) return;
    const combined = items.map((it) => `${it.text}\n[${it.citation}]`).join("\n\n");
    onUpdateText(displayText.trim() ? `${displayText}\n\n${combined}` : combined);
  };


  const aiDisabled = aiBusy !== null || !displayText.trim();

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
      <div className="flex items-center gap-1 p-2 border-b border-border bg-muted/60">
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

      {/* AI tools on output text */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border flex-wrap">
        {/* اعراب dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" disabled={aiDisabled}>
              {aiBusy === "add_harakat" ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="text-sm leading-none">اِعراب</span>}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => runTextAction("add_harakat", "add_harakat")} disabled={aiDisabled} className="cursor-pointer gap-2">
              <Sparkles className="h-4 w-4" />
              {t("editor.add_harakat")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleRemoveHarakat} disabled={!displayText.trim()} className="cursor-pointer gap-2">
              <Type className="h-4 w-4" />
              {t("editor.remove_harakat")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Resource search (حوالہ) */}
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={() => setResourceOpen(true)} disabled={aiBusy !== null}>
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">{t("editor.search_resources")}</span>
        </Button>

        {/* Spell check */}
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={() => runTextAction("spelling_check", "spelling_check")} disabled={aiDisabled}>
          {aiBusy === "spelling_check" ? <Loader2 className="h-4 w-4 animate-spin" /> : <SpellCheck className="h-4 w-4" />}
          <span className="hidden sm:inline">{t("editor.spell_check")}</span>
        </Button>

        {/* Paraphrase */}
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={() => runTextAction("paraphrase", "paraphrase")} disabled={aiDisabled}>
          {aiBusy === "paraphrase" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="hidden sm:inline">{t("editor.paraphrase")}</span>
        </Button>

        {/* Summarize */}
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={() => runTextAction("summarize", "summarize")} disabled={aiDisabled}>
          {aiBusy === "summarize" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          <span className="hidden sm:inline">{t("editor.summarize")}</span>
        </Button>
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

      <ResourceSearchDialog
        open={resourceOpen}
        onOpenChange={setResourceOpen}
        onInsert={handleInsertResource}
        onInsertMany={handleInsertResources}

        t={t}
      />
    </div>
  );
};

export default TranslationOutput;
