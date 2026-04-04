import { useState, useRef, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Play, Square, Download, Loader2, Coins } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import AudioWaveform from "@/components/AudioWaveform";
import { logActivity } from "@/lib/activityLog";
import VoiceSelector from "@/components/speak/VoiceSelector";
import TextInputArea from "@/components/speak/TextInputArea";
import type { Persona, VoiceMode } from "@/components/speak/types";

const personas: Persona[] = [
  { id: "zainab", name: "Zainab", nameUr: "زینب", gender: "female", lang: "ur-PK", voiceLang: "ur", geminiVoice: "Kore" },
  { id: "omar", name: "Omar", nameUr: "عمر", gender: "male", lang: "ar-SA", voiceLang: "ar", geminiVoice: "Puck" },
  { id: "fatima", name: "Fatima", nameUr: "فاطمہ", gender: "female", lang: "en-US", voiceLang: "en", geminiVoice: "Zephyr" },
  { id: "hamza", name: "Hamza", nameUr: "حمزہ", gender: "male", lang: "ur-PK", voiceLang: "ur", geminiVoice: "Charon" },
  { id: "aisha", name: "Aisha", nameUr: "عائشہ", gender: "female", lang: "ar-SA", voiceLang: "ar", geminiVoice: "Aoede" },
  { id: "yusuf", name: "Yusuf", nameUr: "یوسف", gender: "male", lang: "en-US", voiceLang: "en", geminiVoice: "Orus" },
];

const Speak = () => {
  const { user, session } = useAuth();
  const { t, language } = useLanguage();
  const location = useLocation();
  const { subscription } = useSubscription();

  const [text, setText] = useState("");
  const [selectedPersona, setSelectedPersona] = useState<Persona>(personas[0]);
  const [speed, setSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);

  // Tracks chars used this session for optimistic UI (resets on page reload, which is fine)
  const [sessionCharsUsed, setSessionCharsUsed] = useState(0);
  const ttsCharsUsed = (subscription?.tts_characters_used ?? 0) + sessionCharsUsed;

  const [voiceMode, setVoiceMode] = useState<VoiceMode>("standard");
  const [clonedVoiceId, setClonedVoiceId] = useState<string | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [cloneSampleName, setCloneSampleName] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const charLimit = subscription?.tier === "pro" ? 10000 : 2000;

  useEffect(() => {
    const navState = location.state as { text?: string } | null;
    if (navState?.text) setText(navState.text.slice(0, charLimit));
  }, [location.state, charLimit]);

  // Load cloned voice ID from profiles table, with localStorage fallback
  useEffect(() => {
    if (!user) return;
    const loadVoiceId = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("cloned_voice_id")
        .eq("user_id", user.id)
        .single();

      if (!error && data?.cloned_voice_id) {
        if (import.meta.env.DEV) console.log("[Speak] Voice ID loaded from DB");
        setClonedVoiceId(data.cloned_voice_id);
        setCloneSampleName(localStorage.getItem(`cloned-voice-name-${user.id}`));
        return;
      }

      const savedId = localStorage.getItem(`cloned-voice-${user.id}`);
      const savedName = localStorage.getItem(`cloned-voice-name-${user.id}`);
      if (savedId) {
        if (import.meta.env.DEV) console.log("[Speak] Voice ID loaded from localStorage (fallback)");
        setClonedVoiceId(savedId);
        setCloneSampleName(savedName);
        await supabase
          .from("profiles")
          .update({ cloned_voice_id: savedId })
          .eq("user_id", user.id);
      }
    };
    loadVoiceId();
  }, [user]);

  const handleCloneUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !session?.access_token) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error(t("tts.clone_file_too_large"));
      return;
    }

    setIsCloning(true);
    try {
      const storagePath = `${user.id}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("voice-clones")
        .upload(storagePath, file);
      if (uploadError) throw uploadError;

      toast.info(t("tts.training_voice"));

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/clone-voice`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            action: "create",
            storagePath,
            voiceName: `${user.email?.split("@")[0] || "user"}-clone`,
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Clone failed" }));
        throw new Error(err.error || "Voice cloning failed");
      }

      const data = await response.json();
      if (data.voice_id) {
        setClonedVoiceId(data.voice_id);
        setCloneSampleName(file.name);
        setVoiceMode("cloned");
        await supabase
          .from("profiles")
          .update({ cloned_voice_id: data.voice_id })
          .eq("user_id", user.id);
        localStorage.setItem(`cloned-voice-${user.id}`, data.voice_id);
        localStorage.setItem(`cloned-voice-name-${user.id}`, file.name);
        toast.success(t("tts.clone_success"));
      }
    } catch (err: any) {
      toast.error(err.message || t("tts.clone_error"));
    } finally {
      setIsCloning(false);
    }
  };

  const playWithBrowserTTS = (textToSpeak: string) => {
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.rate = speed;
    utterance.onstart = () => { setIsPlaying(true); setIsLoading(false); };
    utterance.onend = () => { setIsPlaying(false); setPlaybackProgress(0); };
    utterance.onerror = () => { setIsPlaying(false); setIsLoading(false); toast.error(t("tts.error")); };
    speechSynthesis.speak(utterance);
  };

  const callTtsApi = async (): Promise<Blob | null> => {
    if (!session?.access_token) {
      toast.error("Please sign in to use TTS");
      return null;
    }
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-tts`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ text, personaId: selectedPersona.id }),
      }
    );

    if (!response.ok) {
      const errData = await response.json().catch(() => ({ error: "Unknown error" }));
      if (response.status === 429) { toast.error(t("tts.limit_reached")); return null; }
      if (response.status === 401) { toast.error(t("tts.unauthorized")); return null; }
      if (response.status === 403) { toast.error(t("tts.subscription_required")); return null; }
      if (import.meta.env.DEV) console.error("TTS API error:", response.status, errData);
      throw new Error(errData.error || "TTS generation failed");
    }

    const audioBlob = new Blob([await response.arrayBuffer()], { type: "audio/wav" });
    setSessionCharsUsed((prev) => prev + text.length);
    return audioBlob;
  };

  const handleStop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    speechSynthesis.cancel();
    setIsPlaying(false);
    setPlaybackProgress(0);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
  };

  const handlePlay = async () => {
    if (!text.trim()) return;
    if (text.length > charLimit) { toast.error(t("tts.text_too_long")); return; }
    handleStop();
    setIsLoading(true);
    try {
      const audioBlob = await callTtsApi();
      if (!audioBlob) { setIsLoading(false); return; }

      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onplay = () => {
        setIsPlaying(true);
        setIsLoading(false);
        setPlaybackProgress(0);
        progressIntervalRef.current = setInterval(() => {
          if (audio.duration > 0) setPlaybackProgress((audio.currentTime / audio.duration) * 100);
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
      logActivity("tts", text.slice(0, 60));
    } catch (err) {
      if (import.meta.env.DEV) console.error("TTS error:", err);
      toast.error(t("tts.fallback_browser"));
      playWithBrowserTTS(text);
      logActivity("tts", text.slice(0, 60));
    }
  };

  const handleDownload = async () => {
    if (!text.trim()) return;
    if (text.length > charLimit) { toast.error(t("tts.text_too_long")); return; }
    setIsDownloading(true);
    try {
      const audioBlob = await callTtsApi();
      if (!audioBlob) { setIsDownloading(false); return; }
      const url = URL.createObjectURL(audioBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tts-${voiceMode === "cloned" ? "my-voice" : selectedPersona.name}-${Date.now()}.wav`;
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
  const usagePercent = subscription?.tier === "free"
    ? (ttsCharsUsed / (subscription?.tts_character_limit ?? 1)) * 100
    : 0;

  return (
    <AppLayout>
      <div className="p-4 md:p-8 space-y-6 max-w-4xl mx-auto">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">{t("tts.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("tts.subtitle")}</p>
        </div>

        {/* Usage meter (free tier only) */}
        {subscription?.tier === "free" && (
          <Card>
            <CardContent className="pt-4 space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{t("tts.chars_used")}</span>
                <span>{ttsCharsUsed} / {subscription.tts_character_limit}</span>
              </div>
              <Progress value={usagePercent} className="h-2" />
              {usagePercent > 80 && (
                <p className="text-xs text-destructive">{t("tts.limit_warning")}</p>
              )}
            </CardContent>
          </Card>
        )}

        <VoiceSelector
          personas={personas}
          selectedPersona={selectedPersona}
          onSelectPersona={setSelectedPersona}
          voiceMode={voiceMode}
          onVoiceModeChange={setVoiceMode}
          clonedVoiceId={clonedVoiceId}
          cloneSampleName={cloneSampleName}
          isCloning={isCloning}
          onCloneUpload={handleCloneUpload}
          language={language}
          t={t}
        />

        <TextInputArea
          text={text}
          onTextChange={setText}
          speed={speed}
          onSpeedChange={setSpeed}
          charLimit={charLimit}
          isRtlInput={isRtlInput}
          voiceMode={voiceMode}
          t={t}
        />

        {/* Audio Waveform */}
        {(isPlaying || isLoading) && (
          <Card>
            <CardContent className="py-4">
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 h-16">
                  <Loader2 className="h-5 w-5 text-primary animate-spin" />
                  <span className="text-sm text-muted-foreground">{t("tts.generating")}</span>
                </div>
              ) : (
                <AudioWaveform isPlaying={isPlaying} />
              )}
              {!isLoading && <Progress value={playbackProgress} className="h-1 mt-3" />}
            </CardContent>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3 items-center">
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

          <Badge variant="outline" className="ms-auto text-xs">
            {voiceMode === "cloned" ? t("tts.using_cloned") : selectedPersona.name}
          </Badge>

          {text.trim() && subscription && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Coins className="h-3.5 w-3.5" />
              <span>{t("tts.cost")}: {text.length} {t("tts.chars")}</span>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default Speak;
