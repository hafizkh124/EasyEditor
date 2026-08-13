import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import { toast } from "sonner";
import { applyResult } from "@/lib/editor/applyResult";
import { type TextBatch } from "@/lib/editor/docChunker";
import { trackRanges } from "@/lib/editor/positionTracker";
import {
  runChunkedTask,
  type ChunkedRunProgress,
  type ChunkedRunResult,
} from "@/lib/tasks/chunkOrchestrator";
import { announceRunResult, describeRunResult, toLastRunSummary } from "./chunkedRunReport";
import type { LastRunSummary } from "@/components/workspace/TaskRunCard";
import { translateStored } from "@/lib/i18n";

/** A chunked run that is waiting for the user's explicit go-ahead (FR-5.11). */
export interface PendingChunkedRun {
  taskSlug: string;
  taskLabel: string;
  batches: TextBatch[];
  skipped: number;
  totalCost: number;
}

/**
 * Run a confirmed plan. `resume.silent` suppresses the toasts so a recipe can
 * report its own per-step outcome instead.
 */
export type ExecuteChunkedRun = (
  plan: PendingChunkedRun,
  resume?: { startIndex?: number; fromRunId?: string; silent?: boolean },
) => Promise<ChunkedRunResult | null>;

interface UseChunkedRunsArgs {
  editor: Editor | null;
  accessToken?: string;
  documentId?: string;
  availableTokens?: number;
  emitChange: () => void;
  setAiBusy: (key: string | null) => void;
  t: import("@/lib/i18n").Translator;
}

/**
 * Running a confirmed plan across a whole document: live progress,
 * cancellation, and the finished-run card with its one-step undo.
 *
 * Split out of `useEditorAiActions` for the 300-line limit (SPEC-M3 NFR-1).
 */
export function useChunkedRuns({
  editor,
  accessToken,
  documentId,
  availableTokens,
  emitChange,
  setAiBusy,
  t,
}: UseChunkedRunsArgs) {
  // Chunked-run state: the plan awaiting confirmation, live progress, and the
  // controller the Cancel button aborts.
  const [pendingChunkedRun, setPendingChunkedRun] = useState<PendingChunkedRun | null>(null);
  const [chunkProgress, setChunkProgress] = useState<ChunkedRunProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // The finished run's card, and the document as it stood before that run.
  const [lastRun, setLastRun] = useState<LastRunSummary | null>(null);
  const preRunDocRef = useRef<JSONContent | null>(null);

  const cancelChunkedRun = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const dismissLastRun = useCallback(() => {
    setLastRun(null);
    preRunDocRef.current = null;
  }, []);

  /**
   * Reverse an entire run in one step (SPEC-M3 FR-5.9).
   *
   * Restoring the pre-run snapshot rather than replaying N undo steps: a batch
   * apply is not guaranteed to be exactly one history entry, so counting steps
   * would undo too little or too much. The card is dismissed on the first edit
   * after a run, so there is never later work for the snapshot to clobber, and
   * the restore is itself a normal transaction — Ctrl+Z brings the run back.
   */
  const undoLastRun = useCallback(() => {
    if (!editor || !preRunDocRef.current) return;
    editor.commands.setContent(preRunDocRef.current);
    emitChange();
    toast.success(translateStored("toast.run.reverted"));
    dismissLastRun();
  }, [editor, emitChange, dismissLastRun]);

  // Any edit of the user's own retires the card — its Undo is only meaningful
  // while the run is still the most recent change to the document.
  useEffect(() => {
    if (!editor || !lastRun) return;
    const onUpdate = () => dismissLastRun();
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor, lastRun, dismissLastRun]);

  /**
   * Execute a confirmed chunked run (SPEC-M3 FR-5.3–FR-5.7).
   *
   * Each batch is written back into its own tracked range the moment it
   * returns, so cancelling keeps every batch already applied and the editor's
   * autosave persists them without extra work.
   */
  const executeChunkedRun = useCallback(
    async (
      plan: PendingChunkedRun,
      resume?: { startIndex?: number; fromRunId?: string; silent?: boolean },
    ): Promise<ChunkedRunResult | null> => {
      if (!editor) return null;
      const controller = new AbortController();
      abortRef.current = controller;
      const tracker = trackRanges(editor, plan.batches);

      // Captured before the first batch lands, so "undo the whole run" has an
      // exact target no matter how many transactions the run produces.
      setLastRun(null);
      preRunDocRef.current = editor.getJSON();

      setAiBusy(plan.taskSlug);
      try {
        const result = await runChunkedTask({
          taskSlug: plan.taskSlug,
          batches: plan.batches,
          accessToken: accessToken || "",
          documentId,
          availableTokens,
          skipped: plan.skipped,
          startIndex: resume?.startIndex ?? 0,
          resumedFromRunId: resume?.fromRunId,
          signal: controller.signal,
          onProgress: setChunkProgress,
          applyBatch: (batchIndex, output) => {
            const range = tracker.ranges[batchIndex];
            const batch = plan.batches[batchIndex];
            // The user deleted this passage mid-run: drop the result rather
            // than writing it at a guessed position (FR-5.2).
            if (!range || range.invalidated) return false;
            applyResult(editor, output, {
              from: range.from,
              to: range.to,
              hasSelection: true,
              // A structural batch keeps its node, so its result must be
              // inserted as inline text and never re-parsed into blocks.
              isHtml: batch.mode === "block" ? undefined : false,
            });
            emitChange();
            return true;
          },
        });

        // A recipe reports its own per-step outcome; a toast per step would
        // bury the one message that matters.
        if (!resume?.silent) {
          announceRunResult(result, describeRunResult(result, plan.batches.length));
        }

        if (result.applied > 0) {
          setLastRun(toLastRunSummary(result, plan.taskLabel, plan.batches.length));
        }

        return result;
      } catch (e) {
        // Inside a recipe the caller decides how a failed step is reported.
        if (resume?.silent) throw e;
        toast.error(e instanceof Error ? e.message : t("editor.ai_error"));
        return null;
      } finally {
        tracker.dispose();
        abortRef.current = null;
        setChunkProgress(null);
        setAiBusy(null);
      }
    },
    [editor, accessToken, documentId, availableTokens, emitChange, t, setAiBusy],
  );

  const confirmChunkedRun = useCallback(() => {
    const plan = pendingChunkedRun;
    setPendingChunkedRun(null);
    if (plan) void executeChunkedRun(plan);
  }, [pendingChunkedRun, executeChunkedRun]);


  return {
    pendingChunkedRun,
    setPendingChunkedRun,
    confirmChunkedRun,
    dismissChunkedRun: () => setPendingChunkedRun(null),
    chunkProgress,
    cancelChunkedRun,
    executeChunkedRun,
    lastRun,
    setLastRun,
    preRunDocRef,
    undoLastRun,
    dismissLastRun,
  };
}
