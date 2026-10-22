import React from "react";
import { BookOpen, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import type { IngestProgress } from "@/lib/corpus/ingestOrchestrator";

interface IngestProgressCardProps {
  title: string;
  progress: IngestProgress;
  onCancel?: () => void;
}

export const IngestProgressCard: React.FC<IngestProgressCardProps> = ({
  title,
  progress,
  onCancel,
}) => {
  const { t } = useLanguage();
  return (
    <div
      className="border border-primary/20 bg-primary/5 p-3 rounded-lg space-y-2 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium text-foreground truncate min-w-0">
          <BookOpen className="h-4 w-4 text-primary shrink-0" />
          <span className="truncate">{title}</span>
        </span>

        {onCancel && !progress.done && (
          <Button
            size="sm"
            variant="ghost"
            className="h-5 p-0 text-xs text-muted-foreground hover:text-destructive shrink-0"
            onClick={onCancel}
            aria-label={t("common.cancel", "Cancel")}
          >
            <XCircle className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {progress.status === "extracting" && t("library.status_extracting", "Extracting text…")}
            {progress.status === "embedding" && t("library.status_embedding", "Preparing embeddings ({inserted} of {total})").replace("{inserted}", String(progress.inserted)).replace("{total}", String(progress.totalChunks))}
            {progress.status === "ready" && t("library.status_ready", "Saved to library")}
            {progress.status === "cancelled" &&
              t("library.status_cancelled", "Cancelled — {count} parts saved").replace("{count}", String(progress.inserted))}
            {progress.status === "failed" && t("library.status_failed", "Processing incomplete")}
          </span>
          <span className="font-semibold text-primary">{progress.progressPercent}%</span>
        </div>

        {progress.status === "failed" && progress.error && (
          <p role="alert" className="text-xs text-destructive break-words">{progress.error}</p>
        )}

        <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              progress.status === "failed"
                ? "bg-destructive"
                : progress.done
                ? "bg-success"
                : "bg-primary"
            }`}
            style={{ width: `${progress.progressPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
};
