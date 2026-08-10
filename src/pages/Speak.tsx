import { useState, useRef, useEffect, useCallback } from "react";
import { useSeo } from "@/hooks/useSeo";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useCanAfford } from "@/hooks/useTokenBalance";
import { isDesktop } from "@/utils/environment";
import { getPreferredEngine } from "@/core/voice/registry";
import { LocalTtsEngine } from "@/core/voice/localEngines";
import { logger } from "@/lib/logger";

const log = logger.child("Speak");

// Max chars per single TTS request (per-request safety cap, not a tier limit)
const TTS_REQUEST_CHAR_CAP = 5000;

import TokenCostBadge from "@/components/TokenCostBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Play, Square, Download, Loader2, Coins, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import AudioWaveform from "@/components/AudioWaveform";
import { logActivity } from "@/lib/activityLog";
import { usePageSession } from "@/hooks/usePageSession";
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
  useSeo({ title: "Text to Speech — Al-Ulama Easy Editor", description: "Generate natural Urdu, Arabic and English speech from text with multiple voice personas.", path: "/speak", noindex: true });

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

  // Per-request character cap (no tier-based blocking; gating is token-based below)
  const charLimit = TTS_REQUEST_CHAR_CAP;

  // Token-based gating: check whether the user can afford the current text length.
  // Uses tts_google by default; when cloned mode is on, we also check elevenlabs cost.
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("standard");
  const ttsAction = voiceMode === "cloned" ? "tts_elevenlabs" : "tts_google";
  const ttsQuantity = Math.max(1, Math.ceil(text.length / 1000));
  const { canAfford: canAffordTts } = useCanAfford(ttsAction, ttsQuantity);

  // voiceMode declared above (needed for token cost computation)
  const [clonedVoiceId, setClonedVoiceId] = useState<string | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [cloneSampleName, setCloneSampleName] = useState<string | null>(null);
  const isDesktopEnv = isDesktop();
  const [useLocalEngine, setUseLocalEngine] = useState(false);
  const [localEngineId, setLocalEngineId] = useState('piper');

  useEffect(() => {
    if (!isDesktopEnv) { setUseLocalEngine(false); return; }
    const lang = selectedPersona.voiceLang;
    const pref = getPreferredEngine(lang);
    setUseLocalEngine(pref !== 'cloud');
    setLocalEngineId(pref);
  }, [isDesktopEnv, selectedPersona.voiceLang]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleRestoreSession = useCallback((metadata: { text?: string; personaId?: string; speed?: number; voiceMode?: VoiceMode }) => {
    if (typeof metadata.text === "string") setText(metadata.text);
    if (typeof metadata.speed === "number") setSpeed(metadata.speed);
    if (metadata.voiceMode === "standard" || metadata.voiceMode === "cloned") setVoiceMode(metadata.voiceMode);
    if (metadata.personaId) {
      const p = personas.find((x) => x.id === metadata.personaId);
      if (p) setSelectedPersona(p);
    }
  }, []);
  const { save: saveSession } = usePageSession<{ text: string; personaId: string; speed: number; voiceMode: VoiceMode }>({
    section: "speak",
    onRestore: handleRestoreSession,
  });
  const persistTTS = useCallback((spoken: string) => {
    if (!spoken.trim()) return;
    saveSession({
      title: spoken.slice(0, 80),
      metadata: { text: spoken, personaId: selectedPersona.id, speed, voiceMode },
    });
  }, [saveSession, selectedPersona.id, speed, voiceMode]);

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
        log.debug("Voice ID loaded from DB");
        setClonedVoiceId(data.cloned_voice_id);
        setCloneSampleName(localStorage.getItem(`cloned-voice-name-${user.id}`));
        return;
      }

      const savedId = localStorage.getItem(`cloned-voice-${user.id}`);
      const savedName = localStorage.getItem(`cloned-voice-name-${user.id}`);
      if (savedId) {
        log.debug("Voice ID loaded from localStorage (fallback)");
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
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("tts.clone_error"));
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
    // Desktop: use local engine when preferred engine is not cloud
    if (isDesktopEnv && useLocalEngine) {
      try {
        const lang = selectedPersona.voiceLang;
        // Honour the engine chosen in Settings ('piper' or 'edge-tts') rather than
        // always asking for Piper.
        const engine = new LocalTtsEngine(localEngineId);
        const result = await engine.synthesizeDetailed(text, lang);
        if (result.audio.byteLength === 0) {
          throw new Error('Local engine returned empty audio');
        }
        // SPEC-M5 FR-6.6: the online engine can fail and be served by Piper
        // instead — say so, rather than passing off local audio as online.
        if (result.fallbackFrom) {
          toast.warning(t("tts.online_fallback", "The online engine was unavailable, so Piper created the audio locally."));
          log.debug("Edge TTS fell back to Piper", { detail: result.fallbackReason });
        }
        return new Blob([result.audio], { type: result.mimeType });
      } catch (err) {
        log.debug("Local TTS failed, falling back to cloud", { err });
        // Fall through to cloud
      }
    }

    // Cloud TTS path
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
      log.debug("TTS API error", { detail: response.status, errData });
      throw new Error(errData.error || "TTS generation failed");
    }

    const audioBlob = new Blob([await response.arrayBuffer()], { type: "audio/wav" });
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
    if (!useLocalEngine && !canAffordTts) { toast.error(t("tts.insufficient_tokens", "Insufficient tokens")); return; }
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
      persistTTS(text);
    } catch (err) {
      log.debug("TTS error", { err });
      toast.error(t("tts.fallback_browser"));
      playWithBrowserTTS(text);
      logActivity("tts", text.slice(0, 60));
      persistTTS(text);
    }
  };

  const handleDownload = async () => {
    if (!text.trim()) return;
    if (text.length > charLimit) { toast.error(t("tts.text_too_long")); return; }
    if (!canAffordTts) { toast.error(t("tts.insufficient_tokens", "Insufficient tokens")); return; }
    setIsDownloading(true);
    try {
      const audioBlob = await callTtsApi();
      if (!audioBlob) { setIsDownloading(false); return; }
      const url = URL.createObjectURL(audioBlob);
      const a = document.createElement("a");
      a.href = url;
      // Extension must follow the actual format: the online engine returns MP3,
      // Piper and the cloud path return WAV.
      const ext = audioBlob.type === "audio/mpeg" ? "mp3" : "wav";
      a.download = `tts-${voiceMode === "cloned" ? "my-voice" : selectedPersona.name}-${Date.now()}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("tts.downloaded"));
    } catch {
      toast.error(t("tts.download_error"));
    } finally {
      setIsDownloading(false);
    }
  };

  // ── Voice Studio enabled — TTS via cloud (Google TTS) with persona selection ──
  const isRtlInput = selectedPersona.voiceLang === "ur" || selectedPersona.voiceLang === "ar";

  return (
    <AppLayout>
      <div className="p-4 md:p-8 space-y-6 max-w-4xl mx-auto">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground">{t("tts.title")}</h1>
            <p className="text-muted-foreground mt-1">{t("tts.subtitle")}</p>
          </div>
          {text && (
            <Button variant="outline" size="sm" onClick={() => { handleStop(); setText(""); }} className="gap-1.5">
              <MessageSquarePlus className="h-3.5 w-3.5" />
              {t("common.new_chat")}
            </Button>
          )}
        </div>

        {/* Token cost display (hidden for local engine) */}
        {!useLocalEngine && (
          <div className="flex items-center gap-3 flex-wrap">
            <TokenCostBadge action="tts_google" quantity={Math.max(1, Math.ceil(text.length / 1000))} />
            {voiceMode === "cloned" && (
              <TokenCostBadge action="tts_elevenlabs" quantity={Math.max(1, Math.ceil(text.length / 1000))} className="border-amber-300" />
            )}
          </div>
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

          {/* SPEC-M5 R22: the online engine gets a standing badge of its own, so the
              user always knows when their text is leaving the machine. */}
          <Badge variant="outline" className="ms-auto text-xs">
            {useLocalEngine
              ? localEngineId === 'edge-tts'
                ? t("tts.online_mode") || "Online (Microsoft)"
                : t("tts.local_mode") || "Local"
              : voiceMode === "cloned" ? t("tts.using_cloned") : selectedPersona.name}
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
