import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { taskRunService } from "@/core/workspace/taskRunService";
import { planDocumentChunks } from "@/lib/editor/docChunker";
import { getTaskBySlug } from "@/lib/tasks/registry";
import { canResumeRun, type StoredBatchPlan } from "@/lib/tasks/resumePlan";
import type { TaskRun } from "@/core/workspace/types";

/**
 * A run this document left unfinished — reload, crash, or a closed tab
 * (SPEC-M4 FR-1.2).
 *
 * Resume is only offered when the batches the run never reached are still
 * exactly as planned; otherwise the card offers "discard" alone, because
 * writing a result at a guessed position is worse than not writing it.
 */
export function useIncompleteRun(
  editor: Editor | null,
  documentId: string | null | undefined,
  resumeChunkedRun: (run: TaskRun) => Promise<void>,
) {
  const [incompleteRun, setIncompleteRun] = useState<TaskRun | null>(null);
  const [canResume, setCanResume] = useState(false);

  useEffect(() => {
    if (!editor || !documentId) return;
    let stale = false;

    taskRunService.findIncompleteRun(documentId).then((run) => {
      if (stale) return;
      setIncompleteRun(run);
      if (!run) {
        setCanResume(false);
        return;
      }
      // Section summaries cannot be resumed (see resumeChunkedRun).
      if (getTaskBySlug(run.task_slug)?.applyMode === "append") {
        setCanResume(false);
        return;
      }
      const plan = planDocumentChunks(editor);
      const storedPlan = run.input?.batch_plan as StoredBatchPlan[] | undefined;
      setCanResume(canResumeRun(storedPlan, run.progress?.done ?? 0, plan.batches));
    });

    return () => {
      stale = true;
    };
  }, [editor, documentId]);

  const discard = useCallback(() => {
    if (incompleteRun?.id) {
      taskRunService.updateTaskRun(incompleteRun.id, {
        status: "cancelled",
        error: "Run discarded by user",
      });
    }
    setIncompleteRun(null);
  }, [incompleteRun]);

  const resume = useCallback(() => {
    if (!incompleteRun) return;
    const run = incompleteRun;
    setIncompleteRun(null);
    void resumeChunkedRun(run);
  }, [incompleteRun, resumeChunkedRun]);

  return { incompleteRun, canResume, discard, resume };
}
