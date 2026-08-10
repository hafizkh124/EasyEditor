import React from "react";
import { Undo2, X, ShieldCheck, ExternalLink, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SourceCardList } from "./SourceCardList";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import type { TaskRunSource } from "@/core/workspace/types";

export interface LastRunSummary {
  runId?: string;
  taskLabel: string;
  applied: number;
  total: number;
  failed: number;
  skipped: number;
  invalidated: number;
  tokensSpent: number;
  sources: TaskRunSource[];
  confidence: number | null;
  cancelled: boolean;
}

interface TaskRunCardProps {
  summary: LastRunSummary;
  onUndo: () => void;
  onDismiss: () => void;
}

/**
 * The transient record of the run that just finished (SPEC-M3 FR-4.5).
 *
 * The Trust tab is the durable log; this card is the immediate one — it appears
 * where the scholar is already looking, shows what the AI leaned on, and offers
 * one-click reversal while the change is still fresh.
 */
export const TaskRunCard: React.FC<TaskRunCardProps> = ({ summary, onUndo, onDismiss }) => {
  const workspace = useOptionalWorkspace();
  const percent = summary.confidence === null ? null : Math.round(summary.confidence * 100);

  const band =
    percent === null
      ? null
      : percent >= 70
        ? { label: "اعلیٰ اعتماد", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" }
        : percent >= 40
          ? { label: "متوسط اعتماد", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20" }
          : { label: "کم اعتماد — جانچ لیں", cls: "bg-red-500/10 text-red-600 border-red-500/20" };

  const notes: string[] = [];
  if (summary.failed > 0) notes.push(`${summary.failed} حصے ناکام`);
  if (summary.invalidated > 0) notes.push(`${summary.invalidated} حصے حذف شدہ`);
  if (summary.skipped > 0) notes.push(`${summary.skipped} بلاک (جدول/تصاویر) محفوظ رکھے گئے`);

  return (
    <div
      className="border-t border-border bg-card px-3 py-2 space-y-2 text-xs max-h-56 overflow-y-auto"
      dir="rtl"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 min-w-0">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="font-medium text-foreground truncate">{summary.taskLabel}</span>
          <span className="text-muted-foreground shrink-0">
            {summary.cancelled ? "منسوخ — " : ""}
            {summary.applied} از {summary.total} مکمل
          </span>
          {band && (
            <Badge variant="outline" className={`text-xs shrink-0 ${band.cls}`}>
              {band.label} ({percent}%)
            </Badge>
          )}
        </span>

        <span className="flex items-center gap-1 shrink-0">
          <span className="text-muted-foreground">{summary.tokensSpent} ٹوکن</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs gap-1"
            onClick={onUndo}
            aria-label="اس پورے رن کی تبدیلیاں واپس لیں"
          >
            <Undo2 className="h-3 w-3" />
            پورا رن واپس لیں
          </Button>
          {workspace && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={() => workspace.setWorkbenchTab("trust")}
              aria-label="Trust ٹیب میں کھولیں"
            >
              <ExternalLink className="h-3 w-3" />
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={onDismiss}
            aria-label="یہ کارڈ بند کریں"
          >
            <X className="h-3 w-3" />
          </Button>
        </span>
      </div>

      {notes.length > 0 && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
          {notes.join("، ")}
        </p>
      )}

      {summary.sources.length > 0 && (
        <div className="pt-1 border-t border-border/50">
          <SourceCardList sources={summary.sources} />
        </div>
      )}
    </div>
  );
};

export default TaskRunCard;
