import React, { useEffect, useState, useCallback } from "react";
import { ShieldCheck, Cpu, Coins, CheckCircle, BarChart3, Info, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWorkspace } from "@/core/workspace/WorkspaceContext";
import { taskRunService } from "@/core/workspace/taskRunService";
import { SourceCardList } from "./SourceCardList";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TaskRun } from "@/core/workspace/types";

export const TrustTab: React.FC = () => {
  const { t } = useLanguage();
  const { activeDocumentId, runDocumentTask } = useWorkspace();
  const [runs, setRuns] = useState<TaskRun[]>([]);
  // A dismissed toast leaves no trace and no way to try again — the failed
  // run's own `error` (already persisted by runTask.ts/chunkOrchestrator.ts
  // on every failure) is the durable record; this only tracks which row is
  // mid-retry so its button can show a spinner and stay disabled.
  const [retryingSlug, setRetryingSlug] = useState<string | null>(null);
  /**
   * `null` means "no run has reported a confidence yet" — it is never a number
   * until the data says so. A default like 0.92 would print an invented
   * certainty on a document the AI has not touched (SPEC-M3 FR-4.4).
   */
  const [lowestConfidence, setLowestConfidence] = useState<number | null>(null);

  const fetchAuditData = useCallback(async () => {
    if (!activeDocumentId) {
      setRuns([]);
      setLowestConfidence(null);
      return;
    }
    try {
      const list = await taskRunService.listTaskRuns(activeDocumentId);
      setRuns(list);

      const scores = list
        .map((r) => r.confidence)
        .filter((c): c is number => typeof c === "number");
      // The weakest citation is the one that will embarrass the scholar, so the
      // headline number is the minimum, not the mean (FR-4.3).
      setLowestConfidence(scores.length > 0 ? Math.min(...scores) : null);
    } catch {
      /* ignore */
    }
  }, [activeDocumentId]);

  useEffect(() => {
    fetchAuditData();
  }, [fetchAuditData]);

  // Re-runs the same task over the whole document — the runner only ever
  // takes a task slug (SPEC-M3), so a run that originally targeted a
  // selection is retried at document scope, not replayed byte-for-byte. The
  // button says so rather than implying an exact re-run.
  const handleRetry = useCallback(
    async (taskSlug: string) => {
      if (!runDocumentTask) {
        toast.error(t("library.retry_no_editor", "Open the document in the Canvas first."));
        return;
      }
      setRetryingSlug(taskSlug);
      try {
        const outcome = await runDocumentTask(taskSlug);
        if (outcome.ok) {
          toast.success(t("library.retry_succeeded", "Retried successfully."));
        } else {
          toast.error(outcome.reason || t("library.retry_failed_again", "The retry failed again."));
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("library.retry_failed_again", "The retry failed again."));
      } finally {
        setRetryingSlug(null);
        fetchAuditData();
      }
    },
    [runDocumentTask, t, fetchAuditData],
  );

  const totalTokensSpent = runs.reduce((acc, r) => acc + (r.tokens_spent || 0), 0);
  const confidencePercent = lowestConfidence === null ? null : Math.round(lowestConfidence * 100);
  const models = Array.from(new Set(runs.map((r) => r.model).filter(Boolean)));

  // Same thresholds and classes as TaskRunCard's `band` — one confidence chip
  // vocabulary across the app, not two.
  const confidenceBand =
    confidencePercent === null
      ? null
      : confidencePercent >= 70
        ? { label: t("library.confidence_high", "High confidence"), cls: "bg-success/10 text-success border-success/20" }
        : confidencePercent >= 40
          ? { label: t("library.confidence_medium", "Medium confidence"), cls: "bg-warning/10 text-warning border-warning/20" }
          : { label: t("library.confidence_low", "Low confidence — check"), cls: "bg-destructive/10 text-destructive border-destructive/20" };

  return (
    <div className="flex flex-col h-full bg-background p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <div className="flex items-center gap-1.5 font-semibold text-xs text-primary">
          <ShieldCheck className="h-4 w-4" />
          <span>{t("library.trust_title", "Trust & Verification (Trust UI & Audit)")}</span>
        </div>
        <Badge variant="outline" className="text-xs bg-muted text-muted-foreground border-border">
          {t("library.runs_count", "{count} runs").replace("{count}", String(runs.length))}
        </Badge>
      </div>

      <ScrollArea className="flex-1 pe-2">
        <div className="space-y-3">
          {/* Confidence — shown only when a run actually reported one (FR-4.4).
              Same emerald/amber/red chip TaskRunCard uses for a single run's
              confidence — a bare progress bar here was the one place this
              headline number didn't get that treatment. */}
          <div className="p-3 rounded-lg border border-border bg-card space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold flex items-center gap-1 text-foreground">
                <BarChart3 className="h-3.5 w-3.5 text-primary" />
                {t("library.lowest_confidence", "Lowest scholarly confidence")}
              </span>
              {confidenceBand === null ? (
                <span className="text-xs font-medium text-muted-foreground">{t("library.not_available", "Not available")}</span>
              ) : (
                <Badge variant="outline" className={`text-xs shrink-0 ${confidenceBand.cls}`}>
                  {t("library.confidence_badge", "{label} ({percent}%)")
                    .replace("{label}", confidenceBand.label)
                    .replace("{percent}", String(confidencePercent))}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1 pt-1">
              <Info className="h-3.5 w-3.5 shrink-0 text-info" />
              {confidencePercent === null
                ? t("library.confidence_hint_na", "Confidence is only reported on citation tasks; spelling and harakat tasks show no number.")
                : t("library.confidence_hint_value", "The kifayat gate auto-approves at above 70% confidence. The lowest number across runs is shown.")}
            </p>
          </div>

          {/* Active Model Metadata */}
          <div className="p-3 rounded-lg border border-border bg-card space-y-2 text-xs">
            <div className="font-semibold text-foreground flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-primary" />
              <span>{t("library.model_log", "AI model log")}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-border/50">
              <div className="bg-muted p-2 rounded">
                <span className="text-muted-foreground block">{t("library.models_used", "Models used")}</span>
                <span className="font-medium text-foreground">
                  {models.length > 0 ? models.join("، ") : t("library.no_runs_yet", "No runs yet")}
                </span>
              </div>
              <div className="bg-muted p-2 rounded">
                <span className="text-muted-foreground block">{t("library.total_runs_on_doc", "Total runs on this document")}</span>
                <span className="font-medium text-foreground">{runs.length}</span>
              </div>
            </div>
          </div>

          {/* Token Audit Log Summary */}
          <div className="p-3 rounded-lg border border-border bg-card space-y-2 text-xs">
            <div className="flex items-center justify-between font-semibold">
              <span className="flex items-center gap-1.5 text-foreground">
                <Coins className="h-3.5 w-3.5 text-warning" />
                <span>{t("library.token_audit", "Total token audit")}</span>
              </span>
              <span className="text-primary font-bold">{t("library.token_plural", "{count} tokens").replace("{count}", String(totalTokensSpent))}</span>
            </div>
            <div className="space-y-1 pt-1 border-t border-border/50 text-xs">
              {runs.length === 0 ? (
                <p className="text-muted-foreground py-1 flex items-center gap-1">
                  <Info className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                  {t("library.no_runs_on_doc", "No AI runs have happened on this document yet.")}
                </p>
              ) : (
                runs.slice(0, 5).map((r) => (
                  <div key={r.id} className="space-y-0.5">
                    <div className="flex justify-between items-center gap-2 text-muted-foreground">
                      <span className="truncate max-w-[120px]">{r.task_slug}</span>
                      {r.status === "failed" ? (
                        <span className="flex items-center gap-1 shrink-0">
                          <span className="text-destructive font-medium">{t("library.failed", "Failed")}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 px-1.5 text-xs gap-1"
                            disabled={retryingSlug === r.task_slug}
                            onClick={() => handleRetry(r.task_slug)}
                            aria-label={t("library.retry_run_aria", "Retry {task} on the whole document").replace("{task}", r.task_slug)}
                          >
                            {retryingSlug === r.task_slug ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3 w-3" />
                            )}
                            {t("library.retry", "Retry")}
                          </Button>
                        </span>
                      ) : (
                        <span>{t("library.token_plural", "{count} tokens").replace("{count}", String(r.tokens_spent || 0))}</span>
                      )}
                    </div>
                    {r.status === "failed" && r.error && (
                      <p className="text-destructive/80 text-xs leading-snug ps-0.5" dir="auto">
                        {r.error}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Per-run detail with the sources each citation run retrieved */}
          {runs.some((r) => (r.sources?.length ?? 0) > 0) && (
            <div className="p-3 rounded-lg border border-border bg-card space-y-2 text-xs">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                <span>{t("library.citation_sources", "Citation sources")}</span>
              </div>
              <div className="space-y-3 pt-1 border-t border-border/50">
                {runs
                  .filter((r) => (r.sources?.length ?? 0) > 0)
                  .slice(0, 5)
                  .map((r) => (
                    <div key={r.id} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{r.task_slug}</span>
                        <span>
                          {typeof r.confidence === "number"
                            ? t("library.confidence_of", "Confidence {percent}%").replace("{percent}", String(Math.round(r.confidence * 100)))
                            : t("library.confidence_not_recorded", "Confidence not recorded")}
                        </span>
                      </div>
                      <SourceCardList sources={r.sources ?? []} />
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Kifayat Audit Guarantee */}
          <div className="p-3 rounded-lg border border-success/30 bg-success/5 text-xs space-y-1">
            <div className="font-semibold text-success flex items-center gap-1">
              <CheckCircle className="h-3.5 w-3.5" />
              <span>{t("library.audit_guarantee", "Scholarly neutrality and audit guarantee")}</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("library.audit_guarantee_desc", "All run logs are stored in the database. Users can reject or accept any AI-provided result at any time.")}
            </p>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};
