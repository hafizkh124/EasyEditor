import { useEffect, useRef, useState } from "react";
import { Cog, BookOpen, AlertTriangle, Clock } from "lucide-react";
import type { RunStats } from "~shared/agent/runStats";
import type { Translator } from "@/lib/i18n";

/**
 * M11 Phase 2 — the live "⚙️ 3 tools · 2 sources · 01:24" row at the top of an
 * agent run. `stats` is derived from progress lines (no IPC change); the timer
 * starts fresh each run and freezes when it finishes.
 */
export function RunStatsBar({
  stats,
  running,
  t,
}: {
  stats: RunStats;
  running: boolean;
  t: Translator;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!running) {
      startRef.current = null;
      return undefined;
    }
    // A run always starts cold (progress is cleared on send) — start from 0.
    startRef.current = Date.now();
    setElapsedMs(0);
    const id = setInterval(() => {
      if (startRef.current != null) setElapsedMs(Date.now() - startRef.current);
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  if (!running && stats.steps === 0) return null;

  const secs = Math.floor(elapsedMs / 1000);
  const mmss = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        <Cog className={running ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
        {t("agent.stats_tools", "{n} tools").replace("{n}", String(stats.toolsRun))}
      </span>
      {stats.sourcesRead > 0 && (
        <span className="flex items-center gap-1">
          <BookOpen className="h-3.5 w-3.5" />
          {t("agent.stats_sources", "{n} sources").replace("{n}", String(stats.sourcesRead))}
        </span>
      )}
      {stats.toolsFailed > 0 && (
        <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          {t("agent.stats_failed", "{n} failed").replace("{n}", String(stats.toolsFailed))}
        </span>
      )}
      <span className="flex items-center gap-1 tabular-nums">
        <Clock className="h-3.5 w-3.5" />
        {mmss}
      </span>
    </div>
  );
}
