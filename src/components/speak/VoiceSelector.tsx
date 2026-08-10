import { useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Volume2, User, Loader2, Upload, Mic2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Persona, VoiceMode } from "./types";
import { isCapabilityAvailable } from "@/core/capabilities/registry";

interface VoiceSelectorProps {
  personas: Persona[];
  selectedPersona: Persona;
  onSelectPersona: (p: Persona) => void;
  voiceMode: VoiceMode;
  onVoiceModeChange: (m: VoiceMode) => void;
  clonedVoiceId: string | null;
  cloneSampleName: string | null;
  isCloning: boolean;
  onCloneUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  language: string;
  t: import("@/lib/i18n").Translator;
}

const VoiceSelector = ({
  personas,
  selectedPersona,
  onSelectPersona,
  voiceMode,
  onVoiceModeChange,
  clonedVoiceId,
  cloneSampleName,
  isCloning,
  onCloneUpload,
  language,
  t,
}: VoiceSelectorProps) => {
  const cloneInputRef = useRef<HTMLInputElement>(null);
  // Voice cloning is an ElevenLabs round trip billed to our own API and backed
  // by cloud storage, so it has no desktop counterpart. With it gone the voice
  // source picker would offer a single option, so the whole block goes rather
  // than leaving a one-item dropdown next to a card that cannot do anything.
  const cloningAvailable = isCapabilityAvailable("voice.cloning");

  if (!cloningAvailable) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">{t("tts.voice_source")}</h2>
      <Select value={voiceMode} onValueChange={(v) => onVoiceModeChange(v as VoiceMode)}>
        <SelectTrigger className="w-full sm:w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="standard">
            <span className="flex items-center gap-2">
              <Volume2 className="h-4 w-4" />
              {t("tts.standard_voices")}
            </span>
          </SelectItem>
          <SelectItem value="cloned" disabled={!clonedVoiceId}>
            <span className="flex items-center gap-2">
              <Mic2 className="h-4 w-4" />
              {t("tts.my_cloned_voice")}
              {!clonedVoiceId && ` (${t("tts.not_set_up")})`}
            </span>
          </SelectItem>
        </SelectContent>
      </Select>

      {/* Clone Voice Card */}
      <Card className="border-dashed">
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center gap-2">
            <Mic2 className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-medium text-foreground">{t("tts.clone_title")}</h3>
          </div>
          <p className="text-xs text-muted-foreground">{t("tts.clone_desc")}</p>

          {clonedVoiceId && cloneSampleName && (
            <Badge variant="secondary" className="text-xs">
              ✓ {cloneSampleName}
            </Badge>
          )}

          <input
            ref={cloneInputRef}
            type="file"
            accept=".mp3,.wav,.m4a,.ogg,.webm"
            className="hidden"
            onChange={onCloneUpload}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={isCloning}
            onClick={() => cloneInputRef.current?.click()}
            className="gap-2"
          >
            {isCloning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("tts.training_voice")}
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                {clonedVoiceId ? t("tts.replace_sample") : t("tts.upload_sample")}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Persona Grid (standard mode only) */}
      {voiceMode === "standard" && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">{t("tts.select_persona")}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {personas.map((p) => (
              <Card
                key={p.id}
                className={cn(
                  "cursor-pointer transition-all hover:border-primary/50",
                  selectedPersona.id === p.id && "border-primary ring-2 ring-primary/20"
                )}
                onClick={() => onSelectPersona(p)}
              >
                <CardContent className="p-3 flex items-center gap-3">
                  <div className={cn(
                    "rounded-full p-2",
                    p.gender === "female" ? "bg-primary/10" : "bg-secondary"
                  )}>
                    <User className={cn(
                      "h-5 w-5",
                      p.gender === "female" ? "text-primary" : "text-muted-foreground"
                    )} />
                  </div>
                  <div>
                    <p className="font-medium text-sm text-foreground">
                      {language === "ur" ? p.nameUr : p.name}
                    </p>
                    <Badge variant="secondary" className="text-xs mt-0.5">
                      {p.lang.split("-")[0].toUpperCase()}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default VoiceSelector;
