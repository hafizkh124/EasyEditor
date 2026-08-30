import React from "react";
import { Undo2, X, ShieldCheck, ExternalLink, AlertTriangle, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SourceCardList } from "./SourceCardList";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { useLanguage } from "@/contexts/LanguageContext";
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
  /** SPEC-M8 P6 — desktop only: send this run's citations to a .docx as real
   *  Word footnotes. Shown only when provided and the run has sources. */
  onExportFootnotes?: () => void;
}

/**
 * The transient record of the run that just finished (SPEC-M3 FR-4.5).
 *
 * The Trust tab is the durable log; this card is the immediate one — it appears
 * where the scholar is already looking, shows what the AI leaned on, and offers
 * one-click reversal while the change is still fresh.
 */
export const TaskRunCard: React.FC<TaskRunCardProps> = ({ summary, onUndo, onDismiss, onExportFootnotes }) => {
  const { t } = useLanguage();
  const workspace = useOptionalWorkspace();
  const percent = summary.confidence === null ? null : Math.round(summary.confidence * 100);

  const band =
    percent === null
      ? null
      : percent >= 70
        ? { label: t("library.confidence_high", "High confidence"), cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" }
        : percent >= 40
          ? { label: t("library.confidence_medium", "Medium confidence"), cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20" }
          : { label: t("library.confidence_low", "Low confidence — check"), cls: "bg-red-500/10 text-red-600 border-red-500/20" };

  const notes: string[] = [];
  if (summary.failed > 0) notes.push(t("library.parts_failed", "{count} parts failed").replace("{count}", String(summary.failed)));
  if (summary.invalidated > 0) notes.push(t("library.parts_invalidated", "{count} parts removed").replace("{count}", String(summary.invalidated)));
  if (summary.skipped > 0) notes.push(t("library.parts_skipped", "{count} blocks (tables/images) kept").replace("{count}", String(summary.skipped)));

  return (
    <div
      className="border-t border-border bg-card px-3 py-2 space-y-2 text-xs max-h-56 overflow-y-auto"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 min-w-0">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="font-medium text-foreground truncate">{summary.taskLabel}</span>
          <span className="text-muted-foreground shrink-0">
            {summary.cancelled ? t("library.cancelled_prefix", "Cancelled — ") : ""}
            {t("library.completed_of", "{applied} of {total} complete").replace("{applied}", String(summary.applied)).replace("{total}", String(summary.total))}
          </span>
          {band && (
            <Badge variant="outline" className={`text-xs shrink-0 ${band.cls}`}>
              {t("library.confidence_badge", "{label} ({percent}%)").replace("{label}", band.label).replace("{percent}", String(percent))}
            </Badge>
          )}
        </span>

        <span className="flex items-center gap-1 shrink-0">
          <span className="text-muted-foreground">{t("library.tokens", "{count} tokens").replace("{count}", String(summary.tokensSpent))}</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs gap-1"
            onClick={onUndo}
            aria-label={t("library.undo_run_aria", "Undo all changes from this run")}
          >
            <Undo2 className="h-3.5 w-3.5" />
            {t("library.undo_run", "Undo whole run")}
          </Button>
          {workspace && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={() => workspace.setWorkbenchTab("trust")}
              aria-label={t("library.open_trust", "Open in Trust tab")}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={onDismiss}
            aria-label={t("library.close_card", "Close this card")}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </span>
      </div>

      {notes.length > 0 && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          {notes.join("، ")}
        </p>
      )}

      {summary.sources.length > 0 && (
        <div className="pt-1 border-t border-border/50">
          <SourceCardList sources={summary.sources} />
        </div>
      )}

      {onExportFootnotes && summary.sources.length > 0 && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-full gap-1.5 text-xs"
          onClick={onExportFootnotes}
        >
          <Quote className="h-3.5 w-3.5" />
          {t("docbridge.cite.card_button", "Export to Word with footnotes")}
        </Button>
      )}
    </div>
  );
};

export default TaskRunCard;
