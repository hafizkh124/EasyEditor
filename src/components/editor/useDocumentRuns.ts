import { useCallback, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { toast } from "sonner";
import { planDocumentChunks } from "@/lib/editor/docChunker";
import { canResumeRun, type StoredBatchPlan } from "@/lib/tasks/resumePlan";
import { getTaskBySlug } from "@/lib/tasks/registry";
import { calculateTaskCost } from "@/lib/tasks/cost";
import { taskRunService } from "@/core/workspace/taskRunService";
import type { DocumentTaskOutcome, DocumentTaskRunner } from "@/core/workspace/WorkspaceContext";
import type { TaskRun } from "@/core/workspace/types";
import type { ExecuteChunkedRun } from "./useChunkedRuns";
import { translateStored, translateStoredFormat } from "@/lib/i18n";

interface UseDocumentRunsArgs {
  editor: Editor | null;
  aiReview: boolean;
  executeChunkedRun: ExecuteChunkedRun;
  registerDocumentTaskRunner?: (runner: DocumentTaskRunner | null) => void;
}

/**
 * Whole-document runs that no one confirms in a dialog: the runner Recipes
 * drive, and picking up a run a reload interrupted.
 *
 * Both sit on top of `executeChunkedRun` rather than beside it — a second
 * apply path would be a second place for position mapping and the wallet
 * ledger to go wrong. Split out for the 300-line limit (SPEC-M3 NFR-1).
 */
export function useDocumentRuns({
  editor,
  aiReview,
  executeChunkedRun,
  registerDocumentTaskRunner,
}: UseDocumentRunsArgs) {
  /**
   * Run one registered task over the whole document and report what happened.
   *
   * This is the seam Recipes execute through (SPEC-M4 FR-4.5): every step gets
   * the real chunked pipeline — throttle, per-batch apply, wallet ledger,
   * cancel — instead of a second, weaker code path. No confirmation dialog
   * here: the recipe already confirmed the total cost of all its steps once.
   */
  const runDocumentTask = useCallback(
    async (taskSlug: string): Promise<DocumentTaskOutcome> => {
      const empty = { applied: 0, total: 0, tokensSpent: 0 };
      if (!editor) return { ok: false, ...empty, reason: "ایڈیٹر دستیاب نہیں۔" };

      const task = getTaskBySlug(taskSlug);
      if (!task) return { ok: false, ...empty, reason: `ٹاسک '${taskSlug}' دستیاب نہیں۔` };
      if (aiReview) {
        return { ok: false, ...empty, reason: "AI Review (Track Changes) آن ہے۔" };
      }

      const plan = planDocumentChunks(editor);
      if (plan.batches.length === 0) {
        return { ok: false, ...empty, reason: "دستاویز میں چلانے کے لیے کوئی متن نہیں۔" };
      }

      const totalCost = plan.batches.reduce((sum, b) => sum + calculateTaskCost(task, b.charCount), 0);

      try {
        const result = await executeChunkedRun(
          {
            taskSlug,
            taskLabel: task.defaultLabel ?? taskSlug,
            batches: plan.batches,
            skipped: plan.skipped,
            totalCost,
          },
          { silent: true },
        );

        if (!result) return { ok: false, ...empty, reason: "رن شروع نہ ہو سکا۔" };

        return {
          // A cancelled or wholly-failed step must not let the recipe continue
          // into a step that would build on text that was never produced.
          ok: !result.cancelled && result.applied > 0,
          applied: result.applied,
          total: plan.batches.length,
          tokensSpent: result.tokensSpent,
          reason: result.cancelled ? "صارف نے منسوخ کر دیا۔" : undefined,
        };
      } catch (e) {
        return { ok: false, ...empty, reason: e instanceof Error ? e.message : "نامعلوم خرابی" };
      }
    },
    [editor, aiReview, executeChunkedRun],
  );

  // Published while this editor is mounted, so panels outside the Canvas (the
  // Recipes tab) can drive real runs. Registered here rather than in the
  // component because this is where the runner is built.
  useEffect(() => {
    if (!registerDocumentTaskRunner) return;
    registerDocumentTaskRunner(editor ? runDocumentTask : null);
    return () => registerDocumentTaskRunner(null);
  }, [registerDocumentTaskRunner, editor, runDocumentTask]);

  /**
   * Continue a run that a reload (or a crash) interrupted — SPEC-M4 FR-1.2.
   *
   * The document is re-chunked from its current state rather than trusting the
   * old ranges: everything the first run applied is already saved, so only the
   * untouched tail is re-planned, and `canResumeRun` refuses if that tail moved.
   */
  const resumeChunkedRun = useCallback(
    async (run: TaskRun) => {
      if (!editor) return;

      const task = getTaskBySlug(run.task_slug);
      if (!task) {
        toast.error(translateStoredFormat("toast.run.task_unavailable", { task: run.task_slug }));
        return;
      }
      if (aiReview) {
        toast.error(translateStored("toast.run.review_active"));
        return;
      }

      const plan = planDocumentChunks(editor);
      const done = run.progress?.done ?? 0;
      const storedPlan = run.input?.batch_plan as StoredBatchPlan[] | undefined;

      if (!canResumeRun(storedPlan, done, plan.batches)) {
        toast.error(translateStored("toast.run.document_changed"));
        return;
      }

      // The old row leaves `running` either way, so a resumed run can never
      // resurface as "unfinished" a second time.
      if (run.id) {
        await taskRunService.updateTaskRun(run.id, {
          status: "cancelled",
          error: "Superseded by a resumed run",
        });
      }

      const totalCost = plan.batches
        .slice(done)
        .reduce((sum, b) => sum + calculateTaskCost(task, b.charCount), 0);

      await executeChunkedRun(
        {
          taskSlug: run.task_slug,
          taskLabel: task.defaultLabel ?? run.task_slug,
          batches: plan.batches,
          skipped: plan.skipped,
          totalCost,
        },
        { startIndex: done, fromRunId: run.id },
      );
    },
    [editor, aiReview, executeChunkedRun],
  );

  return { runDocumentTask, resumeChunkedRun };
}
