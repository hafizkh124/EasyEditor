import React from "react";
import { Loader2, X, Timer } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ChunkedRunProgress } from "@/lib/tasks/chunkOrchestrator";

interface ChunkProgressBarProps {
  progress: ChunkedRunProgress;
  onCancel: () => void;
}

/**
 * Live progress for a chunked run, with the running cost and a cancel button
 * (SPEC-M3 FR-5.4/FR-5.6).
 *
 * The throttle notice matters: a paced run looks like a hang otherwise, and the
 * pacing is deliberate — it is what keeps a long run under the server's
 * 30-requests-per-minute limit instead of failing partway with a 429.
 */
export const ChunkProgressBar: React.FC<ChunkProgressBarProps> = ({ progress, onCancel }) => {
  const { t } = useLanguage();
  const settled = progress.done + progress.failed;
  const percent = progress.total > 0 ? Math.round((settled / progress.total) * 100) : 0;

  return (
    <div
      className="border-t border-border bg-card px-3 py-2 space-y-1.5 text-xs"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>
            {t("library.parts_of", "{current} of {total} parts").replace("{current}", String(progress.current)).replace("{total}", String(progress.total))}
          </span>
          {progress.throttled && (
            <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
              <Timer className="h-3.5 w-3.5" />
              {t("library.throttled", "Paused due to server rate limit")}
            </span>
          )}
        </span>

        <span className="flex items-center gap-2">
          <span className="text-muted-foreground">{t("library.tokens_spent", "{count} tokens spent").replace("{count}", String(progress.tokensSpent))}</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs gap-1"
            onClick={onCancel}
            aria-label={t("library.cancel_task", "Cancel this task")}
          >
            <X className="h-3.5 w-3.5" />
            {t("common.cancel", "Cancel")}
          </Button>
        </span>
      </div>

      <Progress value={percent} className="h-1.5" />

      {(progress.failed > 0 || progress.skipped > 0) && (
        <p className="text-xs text-muted-foreground">
          {progress.failed > 0 && <span>{t("library.parts_failed", "{count} parts failed").replace("{count}", String(progress.failed))} </span>}
          {progress.skipped > 0 && <span>{t("library.parts_skipped", "{count} blocks (tables/images) kept").replace("{count}", String(progress.skipped))}</span>}
        </p>
      )}
    </div>
  );
};

export default ChunkProgressBar;
