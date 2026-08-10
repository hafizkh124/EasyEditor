import React, { useEffect, useState, useCallback } from "react";
import { ShieldCheck, Cpu, Coins, CheckCircle, BarChart3, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWorkspace } from "@/core/workspace/WorkspaceContext";
import { taskRunService } from "@/core/workspace/taskRunService";
import { SourceCardList } from "./SourceCardList";
import type { TaskRun } from "@/core/workspace/types";

export const TrustTab: React.FC = () => {
  const { activeDocumentId } = useWorkspace();
  const [runs, setRuns] = useState<TaskRun[]>([]);
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

  const totalTokensSpent = runs.reduce((acc, r) => acc + (r.tokens_spent || 0), 0);
  const confidencePercent = lowestConfidence === null ? null : Math.round(lowestConfidence * 100);
  const models = Array.from(new Set(runs.map((r) => r.model).filter(Boolean)));

  return (
    <div className="flex flex-col h-full bg-background p-3 space-y-3" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <div className="flex items-center gap-1.5 font-semibold text-xs text-primary">
          <ShieldCheck className="h-4 w-4" />
          <span>اعتماد و تصدیق (Trust UI & Audit)</span>
        </div>
        <Badge variant="outline" className="text-xs bg-muted text-muted-foreground border-border">
          {runs.length} رن
        </Badge>
      </div>

      <ScrollArea className="flex-1 pe-2">
        <div className="space-y-3">
          {/* Confidence — shown only when a run actually reported one (FR-4.4) */}
          <div className="p-3 rounded-lg border border-border bg-card space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold flex items-center gap-1 text-foreground">
                <BarChart3 className="h-3.5 w-3.5 text-primary" />
                کم ترین علمی اعتماد (Confidence)
              </span>
              {confidencePercent === null ? (
                <span className="text-xs font-medium text-muted-foreground">دستیاب نہیں</span>
              ) : (
                <span
                  className={`text-xs font-bold ${
                    confidencePercent >= 70
                      ? "text-emerald-600"
                      : confidencePercent >= 40
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-red-600"
                  }`}
                >
                  {confidencePercent}%
                </span>
              )}
            </div>
            {confidencePercent !== null && <Progress value={confidencePercent} className="h-2" />}
            <p className="text-xs text-muted-foreground flex items-center gap-1 pt-1">
              <Info className="h-3 w-3 shrink-0 text-blue-500" />
              {confidencePercent === null
                ? "اعتماد کا عدد صرف حوالہ جات والے کاموں پر آتا ہے؛ املا یا حرکات پر کوئی عدد نہیں دکھایا جاتا۔"
                : "کفایت گیٹ 70% سے زائد اعتماد پر خودکار منظوری دیتا ہے۔ ایک سے زائد رن پر کم ترین عدد دکھایا جاتا ہے۔"}
            </p>
          </div>

          {/* Active Model Metadata */}
          <div className="p-3 rounded-lg border border-border bg-card space-y-2 text-xs">
            <div className="font-semibold text-foreground flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-primary" />
              <span>مصنوعی ذہانت ماڈل کا لاگ</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-border/50">
              <div className="bg-muted p-2 rounded">
                <span className="text-muted-foreground block">استعمال شدہ ماڈل</span>
                <span className="font-medium text-foreground">
                  {models.length > 0 ? models.join("، ") : "ابھی کوئی رن نہیں"}
                </span>
              </div>
              <div className="bg-muted p-2 rounded">
                <span className="text-muted-foreground block">اس دستاویز پر کل رن</span>
                <span className="font-medium text-foreground">{runs.length}</span>
              </div>
            </div>
          </div>

          {/* Token Audit Log Summary */}
          <div className="p-3 rounded-lg border border-border bg-card space-y-2 text-xs">
            <div className="flex items-center justify-between font-semibold">
              <span className="flex items-center gap-1.5 text-foreground">
                <Coins className="h-3.5 w-3.5 text-amber-500" />
                <span>ٹوکنز کا کل آڈٹ</span>
              </span>
              <span className="text-primary font-bold">{totalTokensSpent} ٹوکنز</span>
            </div>
            <div className="space-y-1 pt-1 border-t border-border/50 text-xs">
              {runs.length === 0 ? (
                <p className="text-muted-foreground py-1">
                  اس دستاویز پر ابھی کوئی AI رن نہیں ہوا۔
                </p>
              ) : (
                runs.slice(0, 5).map((r) => (
                  <div key={r.id} className="flex justify-between text-muted-foreground">
                    <span className="truncate max-w-[150px]">{r.task_slug}</span>
                    <span>
                      {r.status === "failed" ? "ناکام" : `${r.tokens_spent || 0} ٹوکنز`}
                    </span>
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
                <span>حوالہ جات کے مآخذ</span>
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
                            ? `اعتماد ${Math.round(r.confidence * 100)}%`
                            : "اعتماد درج نہیں"}
                        </span>
                      </div>
                      <SourceCardList sources={r.sources ?? []} />
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Kifayat Audit Guarantee */}
          <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 text-xs space-y-1">
            <div className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
              <CheckCircle className="h-3.5 w-3.5" />
              <span>علمی غیر جانبداری اور آڈٹ کی ضمانت</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              تمام رن کی لاگز دیتابیس میں محفوظ ہوتی ہیں۔ صارف کسی بھی وقت AI کے فراہم کردہ نتیجے کو رد یا قبول کر سکتا ہے۔
            </p>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};
