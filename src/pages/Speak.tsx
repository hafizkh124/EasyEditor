import { useState, useRef, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Play, Square, Download, Volume2, User, Loader2 } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import { cn } from "@/lib/utils";

interface Persona {
  id: string;
  name: string;
  nameUr: string;
  gender: "male" | "female";
  lang: string;
  voiceLang: string;
  elevenLabsVoiceId: string;
}

const personas: Persona[] = [
  { id: "zainab", name: "Zainab", nameUr: "زینب", gender: "female", lang: "ur-PK", voiceLang: "ur", elevenLabsVoiceId: "EXAVITQu4vr4xnSDxMaL" }, // Sarah - multilingual
  { id: "omar", name: "Omar", nameUr: "عمر", gender: "male", lang: "ar-SA", voiceLang: "ar", elevenLabsVoiceId: "onwK4e9ZLuTAKqWW03F9" }, // Daniel - multilingual
  { id: "fatima", name: "Fatima", nameUr: "فاطمہ", gender: "female", lang: "en-US", voiceLang: "en", elevenLabsVoiceId: "XrExE9yKIg1WjnnlVkGX" }, // Matilda
  { id: "hamza", name: "Hamza", nameUr: "حمزہ", gender: "male", lang: "ur-PK", voiceLang: "ur", elevenLabsVoiceId: "JBFqnCBsd6RMkjVDRZzb" }, // George - multilingual
  { id: "aisha", name: "Aisha", nameUr: "عائشہ", gender: "female", lang: "ar-SA", voiceLang: "ar", elevenLabsVoiceId: "FGY2WhTYpPnrIDTdsKH5" }, // Laura - multilingual
  { id: "yusuf", name: "Yusuf", nameUr: "یوسف", gender: "male", lang: "en-US", voiceLang: "en", elevenLabsVoiceId: "TX3LPaxmHKxFdv7VOQHJ" }, // Liam
];

const Speak = () => {
  const { user, session } = useAuth();
  const { t, language } = useLanguage();
  const [text, setText] = useState("");
  const [selectedPersona, setSelectedPersona] = useState<Persona>(personas[0]);
  const [speed, setSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [subscription, setSubscription] = useState<{
    tier: string;
    tts_characters_used: number;
    tts_character_limit: number;
  } | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const charLimit = subscription?.tier === "pro" ? 10000 : 2000;
  const charsRemaining = subscription
    ? (subscription.tier === "pro" ? 10000 : subscription.tts_character_limit) - subscription.tts_characters_used
    : 0;

  useEffect(() => {
    if (!user) return;
    supabase
      .from("subscriptions")
      .select("tier, tts_characters_used, tts_character_limit")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) setSubscription(data);
      });
  }, [user]);

  const callTtsApi = async (): Promise<Blob | null> => {
    if (!session?.access_token) {
      toast.error("Please sign in to use TTS");
      return null;
    }

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-tts`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          text,
          voiceId: selectedPersona.elevenLabsVoiceId,
          speed,
        }),
      }
    );

    if (!response.ok) {
      const errData = await response.json().catch(() => ({ error: "Unknown error" }));
      if (response.status === 429) {
        toast.error(t("tts.limit_reached"));
      } else {
        toast.error(errData.error || t("tts.error"));
      }
      return null;
    }

    // Update local subscription state
    if (subscription) {
      setSubscription((prev) =>
        prev ? { ...prev, tts_characters_used: prev.tts_characters_used + text.length } : prev
      );
    }

    return await response.blob();
  };

  const handlePlay = async () => {
    if (!text.trim()) return;
    if (text.length > charLimit) {
      toast.error(t("tts.text_too_long"));
      return;
    }

    // Stop any existing playback
    handleStop();
    setIsLoading(true);

    try {
      const audioBlob = await callTtsApi();
      if (!audioBlob) {
        setIsLoading(false);
        return;
      }

      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onplay = () => {
        setIsPlaying(true);
        setIsLoading(false);
        setPlaybackProgress(0);
        progressIntervalRef.current = setInterval(() => {
          if (audio.duration > 0) {
            setPlaybackProgress((audio.currentTime / audio.duration) * 100);
          }
        }, 100);
      };

      audio.onended = () => {
        setIsPlaying(false);
        setPlaybackProgress(100);
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        setTimeout(() => setPlaybackProgress(0), 500);
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = () => {
        setIsPlaying(false);
        setIsLoading(false);
        setPlaybackProgress(0);
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        toast.error(t("tts.error"));
        URL.revokeObjectURL(audioUrl);
      };

      await audio.play();
    } catch {
      setIsLoading(false);
      toast.error(t("tts.error"));
    }
  };

  const handleStop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setIsPlaying(false);
    setPlaybackProgress(0);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
  };

  const handleDownload = async () => {
    if (!text.trim()) return;
    if (text.length > charLimit) {
      toast.error(t("tts.text_too_long"));
      return;
    }
    setIsDownloading(true);

    try {
      const audioBlob = await callTtsApi();
      if (!audioBlob) {
        setIsDownloading(false);
        return;
      }

      const url = URL.createObjectURL(audioBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tts-${selectedPersona.name}-${Date.now()}.mp3`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("tts.downloaded"));
    } catch {
      toast.error(t("tts.download_error"));
    } finally {
      setIsDownloading(false);
    }
  };

  const isRtlInput = selectedPersona.voiceLang === "ur" || selectedPersona.voiceLang === "ar";
  const usagePercent = subscription
    ? subscription.tier === "pro"
      ? 0
      : (subscription.tts_characters_used / subscription.tts_character_limit) * 100
    : 0;

  return (
    <AppLayout>
      <div className="p-4 md:p-8 space-y-6 max-w-4xl mx-auto">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">{t("tts.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("tts.subtitle")}</p>
        </div>

        {/* Usage */}
        {subscription && subscription.tier === "free" && (
          <Card>
            <CardContent className="pt-4 space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{t("tts.chars_used")}</span>
                <span>{subscription.tts_characters_used} / {subscription.tts_character_limit}</span>
              </div>
              <Progress value={usagePercent} className="h-2" />
              {usagePercent > 80 && (
                <p className="text-xs text-destructive">{t("tts.limit_warning")}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Persona Grid */}
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
                onClick={() => setSelectedPersona(p)}
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
                    <Badge variant="secondary" className="text-[10px] mt-0.5">
                      {p.lang.split("-")[0].toUpperCase()}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

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
            onChange={(e) => setText(e.target.value.slice(0, charLimit))}
            placeholder={t("tts.placeholder")}
            dir={isRtlInput ? "rtl" : "ltr"}
            className={cn("min-h-[120px] resize-none", isRtlInput && "text-right")}
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
            onValueChange={(v) => setSpeed(v[0])}
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

        {/* Playback Progress */}
        {(isPlaying || isLoading) && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {isLoading ? (
                <Loader2 className="h-4 w-4 text-primary animate-spin" />
              ) : (
                <Volume2 className="h-4 w-4 text-primary animate-pulse" />
              )}
              <span className="text-sm text-muted-foreground">
                {isLoading ? t("tts.generating") : t("tts.playing")}
              </span>
            </div>
            <Progress value={isLoading ? undefined : playbackProgress} className="h-2" />
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3">
          {isPlaying ? (
            <Button onClick={handleStop} variant="destructive" className="flex-1 sm:flex-none">
              <Square className="h-4 w-4" />
              {t("tts.stop")}
            </Button>
          ) : (
            <Button onClick={handlePlay} disabled={!text.trim() || isLoading} className="flex-1 sm:flex-none">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {isLoading ? t("tts.generating") : t("tts.listen")}
            </Button>
          )}
          <Button
            onClick={handleDownload}
            variant="outline"
            disabled={!text.trim() || isPlaying || isLoading || isDownloading}
            className="flex-1 sm:flex-none"
          >
            {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {t("tts.download")}
          </Button>
        </div>
      </div>
    </AppLayout>
  );
};

export default Speak;
