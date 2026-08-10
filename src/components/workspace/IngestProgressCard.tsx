import React from "react";
import { BookOpen, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  return (
    <div
      className="border border-primary/20 bg-primary/5 p-3 rounded-lg space-y-2 text-xs"
      dir="rtl"
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
          >
            <XCircle className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {progress.status === "extracting" && "متن نکالا جا رہا ہے…"}
            {progress.status === "embedding" && `ایمبیڈنگز تیار ہو رہی ہیں (${progress.inserted} از ${progress.totalChunks})`}
            {progress.status === "ready" && "کتب خانے میں محفوظ ہو گیا"}
            {progress.status === "cancelled" &&
              `منسوخ — ${progress.inserted} حصے محفوظ ہیں`}
            {progress.status === "failed" && "پروسیسنگ نامکمل"}
          </span>
          <span className="font-semibold text-primary">{progress.progressPercent}%</span>
        </div>

        <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              progress.status === "failed"
                ? "bg-destructive"
                : progress.done
                ? "bg-emerald-600"
                : "bg-primary"
            }`}
            style={{ width: `${progress.progressPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
};
