import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatClock, paragraphAt, type TimedParagraph } from "@/lib/extract/timedParagraphs";

/**
 * An audio transcript read along with its recording (SYSTEM-2026 §5): each
 * paragraph carries its time; a tap plays from there; the paragraph being
 * spoken is highlighted and kept in view. The player sits at the bottom with
 * the speed choices a scholar checking a lecture actually uses.
 */

const SPEEDS = [0.75, 1, 1.25, 1.5] as const;

export function AudioReadAlong({
  src,
  paragraphs,
  exact,
  dir,
}: {
  src: string;
  paragraphs: TimedParagraph[];
  /** False when the times are estimated (the cloud engine gives none inside a chunk). */
  exact: boolean;
  dir: "rtl" | "ltr";
}) {
  const { t } = useLanguage();
  const audioRef = useRef<HTMLAudioElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);

  const active = useMemo(() => paragraphAt(paragraphs, time), [paragraphs, time]);

  // Keep the spoken paragraph in view while playing — not while the user is
  // reading elsewhere with the audio paused.
  useEffect(() => {
    if (playing && active >= 0) itemRefs.current[active]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, playing]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  const seek = (to: number, play = true) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(to, duration || to));
    setTime(audio.currentTime);
    if (play) void audio.play();
  };

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      {!exact && (
        <p className="border-b border-border bg-muted/60 px-4 py-2 text-xs text-muted-foreground">
          {t("extract.times_approx", "وقت اندازاً ہیں: یہ انجن ہر چند منٹ کا وقت دیتا ہے، ہر جملے کا نہیں۔")}
        </p>
      )}
      <ol dir={dir} aria-label={t("extract.read_along", "آڈیو کے ساتھ متن")} className="max-h-[60vh] space-y-1 overflow-y-auto p-2">
        {paragraphs.map((p, i) => (
          <li key={`${p.start}-${i}`}>
            <button
              ref={(el) => (itemRefs.current[i] = el)}
              type="button"
              onClick={() => seek(p.start)}
              aria-current={i === active ? "true" : undefined}
              className={cn(
                "flex w-full gap-3 rounded-lg px-3 py-2 text-start leading-loose transition-colors",
                i === active ? "bg-primary/10 text-foreground" : "text-foreground/90 hover:bg-muted",
              )}
            >
              <span dir="ltr" className={cn("mt-1 shrink-0 font-mono text-xs tabular-nums", i === active ? "text-primary" : "text-muted-foreground")}>
                {exact ? "" : "~"}{formatClock(p.start)}
              </span>
              <span className="min-w-0 flex-1">{p.text}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-background/95 px-3 py-2">
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
          onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => seek(time - 10, playing)} aria-label={t("extract.back_10", "10 سیکنڈ پیچھے")}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button size="icon" className="h-10 w-10 rounded-full" onClick={toggle} aria-label={playing ? t("extract.pause", "روکیں") : t("extract.play", "چلائیں")}>
          {playing ? <Pause className="h-5 w-5" aria-hidden="true" /> : <Play className="h-5 w-5" aria-hidden="true" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => seek(time + 10, playing)} aria-label={t("extract.forward_10", "10 سیکنڈ آگے")}>
          <RotateCw className="h-4 w-4" aria-hidden="true" />
        </Button>
        <div dir="ltr" className="flex min-w-[10rem] flex-1 items-center gap-2">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatClock(time)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(time, duration || 0)}
            onChange={(e) => seek(Number(e.target.value), playing)}
            aria-label={t("extract.position", "آڈیو میں جگہ")}
            className="h-1.5 flex-1 cursor-pointer accent-primary"
          />
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatClock(duration)}</span>
        </div>
        <div role="group" dir="ltr" aria-label={t("extract.speed", "رفتار")} className="flex items-center gap-0.5">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              aria-pressed={speed === s}
              className={cn(
                "min-h-touch rounded-md px-2 text-xs tabular-nums transition-colors",
                speed === s ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
