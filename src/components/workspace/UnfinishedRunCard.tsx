import React from "react";
import { AlertCircle, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const done = run.progress?.done ?? 0;
  const total = run.progress?.total ?? (run.input?.totalBatches as number) ?? 0;

  return (
    <div
      className="border-t border-amber-500/30 bg-amber-500/10 px-3 py-2 space-y-2 text-xs"
      dir="rtl"
      role="alert"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 min-w-0">
          <AlertCircle className="h-4 w-4 text-amber-700 dark:text-amber-400 shrink-0" />
          <span className="font-medium text-foreground truncate">
            نامکمل رن: {run.task_slug} ({done} از {total} مکمل)
          </span>
        </span>

        <div className="flex items-center gap-1.5 shrink-0">
          {canResume && (
            <Button
              size="sm"
              variant="default"
              className="h-6 px-2 text-[11px] gap-1 bg-amber-600 hover:bg-amber-700 text-white"
              onClick={onResume}
            >
              <Play className="h-3 w-3" />
              باقی ماندہ پر جاری رکھیں
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px] gap-1 border-amber-500/40 text-amber-700 hover:bg-amber-500/20"
            onClick={onDiscard}
          >
            <Trash2 className="h-3 w-3" />
            چھوڑ دیں
          </Button>
        </div>
      </div>
      {!canResume && (
        <p className="text-[11px] text-amber-700/80">
          دستاویز کا متن تبدیل ہو چکا ہے — سابقہ نامکمل جگہ پر جاری رکھنا ممکن نہیں۔
        </p>
      )}
    </div>
  );
};
