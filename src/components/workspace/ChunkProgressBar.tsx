import React from "react";
import { Loader2, X, Timer } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
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
  const settled = progress.done + progress.failed;
  const percent = progress.total > 0 ? Math.round((settled / progress.total) * 100) : 0;

  return (
    <div
      className="border-t border-border bg-card px-3 py-2 space-y-1.5 text-xs"
      dir="rtl"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>
            {progress.current} از {progress.total} حصے
          </span>
          {progress.throttled && (
            <span className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
              <Timer className="h-3 w-3" />
              سرور کی حد کے سبب وقفہ
            </span>
          )}
        </span>

        <span className="flex items-center gap-2">
          <span className="text-muted-foreground">{progress.tokensSpent} ٹوکن خرچ</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs gap-1"
            onClick={onCancel}
            aria-label="یہ کام منسوخ کریں"
          >
            <X className="h-3 w-3" />
            منسوخ
          </Button>
        </span>
      </div>

      <Progress value={percent} className="h-1.5" />

      {(progress.failed > 0 || progress.skipped > 0) && (
        <p className="text-[11px] text-muted-foreground">
          {progress.failed > 0 && <span>{progress.failed} حصے ناکام۔ </span>}
          {progress.skipped > 0 && <span>{progress.skipped} بلاک (جدول/تصاویر) محفوظ رکھے گئے۔</span>}
        </p>
      )}
    </div>
  );
};

export default ChunkProgressBar;
