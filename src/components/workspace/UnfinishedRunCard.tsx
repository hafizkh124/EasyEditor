import React from "react";
import { AlertCircle, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TaskRun } from "@/core/workspace/types";

interface UnfinishedRunCardProps {
  run: TaskRun;
  canResume: boolean;
  onResume: () => void;
  onDiscard: () => void;
}

export const UnfinishedRunCard: React.FC<UnfinishedRunCardProps> = ({
  run,
  canResume,
  onResume,
  onDiscard,
}) => {
  const { t } = useLanguage();
  const done = run.progress?.done ?? 0;
  const total = run.progress?.total ?? (run.input?.totalBatches as number) ?? 0;

  return (
    <div
      className="border-t border-amber-500/30 bg-amber-500/10 px-3 py-2 space-y-2 text-xs"
      role="alert"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 min-w-0">
          <AlertCircle className="h-4 w-4 text-amber-700 dark:text-amber-400 shrink-0" />
          <span className="font-medium text-foreground truncate">
            {t("library.unfinished_run", "Unfinished run: {slug} ({done} of {total} complete)")
              .replace("{slug}", run.task_slug)
              .replace("{done}", String(done))
              .replace("{total}", String(total))}
          </span>
        </span>

        <div className="flex items-center gap-1.5 shrink-0">
          {canResume && (
            <Button
              size="sm"
              variant="default"
              className="h-6 px-2 text-xs gap-1 bg-amber-600 hover:bg-amber-700 text-white"
              onClick={onResume}
            >
              <Play className="h-3.5 w-3.5" />
              {t("library.resume_remaining", "Resume remaining")}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs gap-1 border-amber-500/40 text-amber-700 hover:bg-amber-500/20"
            onClick={onDiscard}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("library.discard_run", "Discard")}
          </Button>
        </div>
      </div>
      {!canResume && (
        <p className="text-xs text-amber-700/80">
          {t("library.cannot_resume", "The document text has changed — resuming at the previous position is not possible.")}
        </p>
      )}
    </div>
  );
};
