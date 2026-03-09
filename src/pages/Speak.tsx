import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Play, Square, Download, Volume2, User } from "lucide-react";
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
}

const personas: Persona[] = [
  { id: "zainab", name: "Zainab", nameUr: "زینب", gender: "female", lang: "ur-PK", voiceLang: "ur" },
  { id: "omar", name: "Omar", nameUr: "عمر", gender: "male", lang: "ar-SA", voiceLang: "ar" },
  { id: "fatima", name: "Fatima", nameUr: "فاطمہ", gender: "female", lang: "en-US", voiceLang: "en" },
  { id: "hamza", name: "Hamza", nameUr: "حمزہ", gender: "male", lang: "ur-PK", voiceLang: "ur" },
  { id: "aisha", name: "Aisha", nameUr: "عائشہ", gender: "female", lang: "ar-SA", voiceLang: "ar" },
  { id: "yusuf", name: "Yusuf", nameUr: "یوسف", gender: "male", lang: "en-US", voiceLang: "en" },
];

const Speak = () => {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [text, setText] = useState("");
  const [selectedPersona, setSelectedPersona] = useState<Persona>(personas[0]);
  const [speed, setSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [subscription, setSubscription] = useState<{
    tier: string;
    tts_characters_used: number;
    tts_character_limit: number;
  } | null>(null);

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

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

  const findBestVoice = useCallback((persona: Persona): SpeechSynthesisVoice | null => {
    const voices = speechSynthesis.getVoices();
    // Try exact lang match with gender preference
    const langMatch = voices.filter((v) => v.lang.startsWith(persona.voiceLang));
    if (langMatch.length > 0) {
      // Try to pick a voice that might match gender by name heuristics
      const genderHint = persona.gender === "female" ? /female|woman|zira|samira|hoda/i : /male|man|david|naayf/i;
      const genderMatch = langMatch.find((v) => genderHint.test(v.name));
      return genderMatch || langMatch[0];
    }
    // Fallback to default
    return voices.find((v) => v.default) || voices[0] || null;
  }, []);

  const trackUsage = async (charCount: number) => {
    if (!user || !subscription) return false;
    const newUsed = subscription.tts_characters_used + charCount;
    const limit = subscription.tier === "pro" ? 999999 : subscription.tts_character_limit;
    if (newUsed > limit && subscription.tier === "free") {
      toast.error(t("tts.limit_reached"));
      return false;
    }
    const { error } = await supabase
      .from("subscriptions")
      .update({ tts_characters_used: newUsed })
      .eq("user_id", user.id);
    if (!error) {
      setSubscription((prev) => prev ? { ...prev, tts_characters_used: newUsed } : prev);
    }
    return !error;
  };

  const handlePlay = async () => {
    if (!text.trim()) return;
    if (text.length > charLimit) {
      toast.error(t("tts.text_too_long"));
      return;
    }
    const ok = await trackUsage(text.length);
    if (!ok) return;

    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = speed;
    utterance.lang = selectedPersona.lang;

    const voice = findBestVoice(selectedPersona);
    if (voice) utterance.voice = voice;

    utterance.onstart = () => {
      setIsPlaying(true);
      setPlaybackProgress(0);
      let elapsed = 0;
      const estimatedDuration = (text.length / 15) * (1 / speed); // rough estimate
      progressIntervalRef.current = setInterval(() => {
        elapsed += 0.1;
        setPlaybackProgress(Math.min((elapsed / estimatedDuration) * 100, 95));
      }, 100);
    };

    utterance.onend = () => {
      setIsPlaying(false);
      setPlaybackProgress(100);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      setTimeout(() => setPlaybackProgress(0), 500);
    };

    utterance.onerror = () => {
      setIsPlaying(false);
      setPlaybackProgress(0);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      toast.error(t("tts.error"));
    };

    utteranceRef.current = utterance;
    speechSynthesis.speak(utterance);
  };

  const handleStop = () => {
    speechSynthesis.cancel();
    setIsPlaying(false);
    setPlaybackProgress(0);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
  };

  const handleDownload = async () => {
    if (!text.trim()) return;
    try {
      // Use AudioContext + SpeechSynthesis to record audio
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = speed;
      utterance.lang = selectedPersona.lang;
      const voice = findBestVoice(selectedPersona);
      if (voice) utterance.voice = voice;

      // Try using MediaRecorder with audio destination
      const audioContext = new AudioContext();
      const dest = audioContext.createMediaStreamDestination();
      const mediaRecorder = new MediaRecorder(dest.stream, { mimeType: "audio/webm" });
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `tts-${selectedPersona.name}-${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        audioContext.close();
        toast.success(t("tts.downloaded"));
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;

      utterance.onend = () => {
        setTimeout(() => mediaRecorder.stop(), 500);
      };

      utterance.onerror = () => {
        mediaRecorder.stop();
        toast.error(t("tts.download_error"));
      };

      speechSynthesis.speak(utterance);
    } catch {
      toast.error(t("tts.download_error"));
    }
  };

  // Ensure voices are loaded
  useEffect(() => {
    speechSynthesis.getVoices();
    const onVoicesChanged = () => speechSynthesis.getVoices();
    speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
    return () => speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
  }, []);

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
            min={0.5}
            max={2}
            step={0.1}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0.5x</span>
            <span>2.0x</span>
          </div>
        </div>

        {/* Playback Progress */}
        {isPlaying && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-primary animate-pulse" />
              <span className="text-sm text-muted-foreground">{t("tts.playing")}</span>
            </div>
            <Progress value={playbackProgress} className="h-2" />
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
            <Button onClick={handlePlay} disabled={!text.trim()} className="flex-1 sm:flex-none">
              <Play className="h-4 w-4" />
              {t("tts.listen")}
            </Button>
          )}
          <Button
            onClick={handleDownload}
            variant="outline"
            disabled={!text.trim() || isPlaying}
            className="flex-1 sm:flex-none"
          >
            <Download className="h-4 w-4" />
            {t("tts.download")}
          </Button>
        </div>
      </div>
    </AppLayout>
  );
};

export default Speak;
