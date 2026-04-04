import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { VoiceMode } from "./types";

interface TextInputAreaProps {
  text: string;
  onTextChange: (value: string) => void;
  speed: number;
  onSpeedChange: (value: number) => void;
  charLimit: number;
  isRtlInput: boolean;
  voiceMode: VoiceMode;
  t: (k: string) => string;
}

const TextInputArea = ({
  text,
  onTextChange,
  speed,
  onSpeedChange,
  charLimit,
  isRtlInput,
  voiceMode,
  t,
}: TextInputAreaProps) => {
  const effectiveRtl = isRtlInput && voiceMode === "standard";

  return (
    <>
      {/* Text Input */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <h2 className="text-sm font-medium text-muted-foreground">{t("tts.enter_text")}</h2>
          <span className="text-xs text-muted-foreground">
            {text.length} / {charLimit}
          </span>
        </div>
        <Textarea
          value={text}
          onChange={(e) => onTextChange(e.target.value.slice(0, charLimit))}
          placeholder={t("tts.placeholder")}
          dir={effectiveRtl ? "rtl" : "ltr"}
          className={cn("min-h-[120px] resize-none", effectiveRtl && "text-right")}
          maxLength={charLimit}
        />
      </div>

      {/* Speed Control */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <h2 className="text-sm font-medium text-muted-foreground">{t("tts.speed")}</h2>
          <span className="text-sm font-medium text-foreground">{speed.toFixed(1)}x</span>
        </div>
        <Slider
          value={[speed]}
          onValueChange={(v) => onSpeedChange(v[0])}
          min={0.7}
          max={1.2}
          step={0.1}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>0.7x</span>
          <span>1.2x</span>
        </div>
      </div>
    </>
  );
};

export default TextInputArea;
