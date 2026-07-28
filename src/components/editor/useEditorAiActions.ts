import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import { toast } from "sonner";
import { stripHarakat } from "@/utils/arabicUtils";
import { callRefineText, type RefineTextAction } from "@/lib/editor/aiActions";
import { shouldConfirmWholeDocument } from "@/lib/editor/applyScope";
import { applyResult } from "@/lib/editor/applyResult";
import { planDocumentChunks, type TextBatch } from "@/lib/editor/docChunker";
import { trackRanges } from "@/lib/editor/positionTracker";
import { runSingleBatchTask } from "@/lib/tasks/runTask";
import { runChunkedTask, type ChunkedRunProgress } from "@/lib/tasks/chunkOrchestrator";
import { getTaskBySlug } from "@/lib/tasks/registry";
import { calculateTaskCost } from "@/lib/tasks/cost";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import type { LastRunSummary } from "@/components/workspace/TaskRunCard";
import type { TaskRunSource } from "@/core/workspace/types";

/** A chunked run that is waiting for the user's explicit go-ahead (FR-5.11). */
export interface PendingChunkedRun {
  taskSlug: string;
  taskLabel: string;
  batches: TextBatch[];
  skipped: number;
  totalCost: number;
}

export type TrackMode = "edit" | "suggest" | "view";

export interface SelectionBarActions {
  onAddHarakat: () => void;
  onRemoveHarakat: () => void;
  onSpellCheck: () => void;
  onParaphrase: () => void;
  onSummarize: () => void;
  onCitations: () => void;
  onNormalizeScript?: () => void;
  onFormalize?: () => void;
  onHumanize?: () => void;
  onShorten?: () => void;
}

interface UseEditorAiActionsArgs {
  editor: Editor | null;
  accessToken?: string;
  emitChange: () => void;
  t: (key: string) => string;
  aiReview: boolean;
  trackMode: TrackMode;
  applyAsSuggestion: (from: number, to: number, newText: string) => boolean;
  onSetTrackMode: (mode: TrackMode) => void;
}

export function useEditorAiActions({
  editor,
  accessToken,
  emitChange,
  t,
  aiReview,
  trackMode,
  applyAsSuggestion,
  onSetTrackMode,
}: UseEditorAiActionsArgs) {
  const [aiBusy, setAiBusy] = useState<string | null>(null);

  // Real wallet balance and the document being edited. Both are needed so the
  // pre-flight check measures against actual tokens (FR-2.6) and every task_run
  // is attached to its document, which is what the Trust tab lists (FR-4.5).
  const { total: availableTokens } = useTokenBalance();
  const workspace = useOptionalWorkspace();
  const documentId = workspace?.activeDocumentId ?? undefined;

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
    toast.success("رن کی تمام تبدیلیاں واپس لے لی گئیں۔");
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

  /** The current selection text + range, or the whole document if nothing is selected. */
  const getSelectionOrAll = useCallback(() => {
    if (!editor) return { text: "", from: 0, to: 0, hasSelection: false };
    const { from, to, empty } = editor.state.selection;
    const hasSelection = !empty && to > from;
    const text = hasSelection ? editor.state.doc.textBetween(from, to, "\n") : editor.getText();
    return { text, from, to, hasSelection };
  }, [editor]);

  /** Replace the selected range (or the whole doc) with new text safely (FR-1.1). */
  const applyTextResult = useCallback(
    (result: string, from: number, to: number, hasSelection: boolean) => {
      if (!editor) return;
      applyResult(editor, result, { from, to, hasSelection });
      emitChange();
    },
    [editor, emitChange],
  );

  /**
   * Execute a confirmed chunked run (SPEC-M3 FR-5.3–FR-5.7).
   *
   * Each batch is written back into its own tracked range the moment it
   * returns, so cancelling keeps every batch already applied and the editor's
   * autosave persists them without extra work.
   */
  const executeChunkedRun = useCallback(
    async (plan: PendingChunkedRun) => {
      if (!editor) return;
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

        const parts = [`${result.applied} از ${plan.batches.length} حصے مکمل`];
        if (result.failed > 0) parts.push(`${result.failed} ناکام`);
        if (result.invalidated > 0) parts.push(`${result.invalidated} حذف شدہ`);
        if (result.skipped > 0) parts.push(`${result.skipped} بلاک محفوظ رکھے گئے`);
        const summary = parts.join("، ");

        if (result.cancelled) {
          toast.info(`منسوخ — ${summary}۔ مکمل شدہ حصے محفوظ ہیں۔`);
        } else if (result.applied === 0) {
          toast.error("کوئی حصہ مکمل نہ ہو سکا۔");
        } else {
          toast.success(summary);
        }

        if (result.applied > 0) {
          setLastRun({
            runId: result.runId,
            taskLabel: plan.taskLabel,
            applied: result.applied,
            total: plan.batches.length,
            failed: result.failed,
            skipped: result.skipped,
            invalidated: result.invalidated,
            tokensSpent: result.tokensSpent,
            sources: result.sources,
            confidence: result.confidence,
            cancelled: result.cancelled,
          });
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("editor.ai_error"));
      } finally {
        tracker.dispose();
        abortRef.current = null;
        setChunkProgress(null);
        setAiBusy(null);
      }
    },
    [editor, accessToken, documentId, availableTokens, emitChange, t],
  );

  const confirmChunkedRun = useCallback(() => {
    const plan = pendingChunkedRun;
    setPendingChunkedRun(null);
    if (plan) void executeChunkedRun(plan);
  }, [pendingChunkedRun, executeChunkedRun]);

  // ── Actions that return plain text (harakat, spelling, citations, …) ──
  const runTextAction = useCallback(
    async (taskSlug: string, busyKey: string) => {
      if (!editor) return;
      const { text, from, to, hasSelection } = getSelectionOrAll();
      if (!text.trim()) return;

      const task = getTaskBySlug(taskSlug);
      const chunkingEnabled = import.meta.env.VITE_TASK_CHUNKING !== "false";

      // Whole-document runs go through the chunker, which is what preserves
      // headings, quotes and lists and leaves tables alone (FR-5.1).
      if (!hasSelection && chunkingEnabled && task?.chunkable) {
        const plan = planDocumentChunks(editor);
        if (plan.batches.length > 1) {
          // Track Changes cannot represent a multi-line replacement, so a
          // chunked run would silently bypass review (FR-5.8).
          if (aiReview) {
            toast.error(
              "AI Review (Track Changes) آن ہے — پوری دستاویز پر چلنے والا کام تبدیلیاں track نہیں کر سکتا۔ پہلے Review بند کریں، یا متن منتخب کریں۔",
            );
            return;
          }
          const totalCost = plan.batches.reduce(
            (sum, b) => sum + (task ? calculateTaskCost(task, b.charCount) : 0),
            0,
          );
          // Never start a paid multi-batch run unprompted (FR-5.11).
          setPendingChunkedRun({
            taskSlug,
            taskLabel: task?.defaultLabel ?? taskSlug,
            batches: plan.batches,
            skipped: plan.skipped,
            totalCost,
          });
          return;
        }
      }

      if (shouldConfirmWholeDocument(hasSelection, editor.getJSON())) {
        const proceed = window.confirm(
          t("editor.confirm_whole_document") ||
            "یہ عمل پوری دستاویز پر چلے گا اور اس کی فارمیٹنگ ختم ہو جائے گی۔ بہتر ہے پہلے متن منتخب کر لیں۔ کیا پھر بھی جاری رکھیں؟",
        );
        if (!proceed) return;
      }

      setAiBusy(busyKey);
      setLastRun(null);
      preRunDocRef.current = editor.getJSON();
      try {
        let resultText = "";
        let runSources: TaskRunSource[] = [];
        let runConfidence: number | null = null;
        let runTokens = 0;
        let runId: string | undefined;

        if (import.meta.env.VITE_TASK_LIBRARY !== "false") {
          const runRes = await runSingleBatchTask({
            taskSlug,
            text,
            accessToken: accessToken || "",
            documentId,
            availableTokens,
          });
          resultText = runRes.text || runRes.html || "";
          runSources = runRes.sources ?? [];
          runConfidence = runRes.confidence ?? null;
          runTokens = runRes.tokensSpent ?? 0;
          runId = runRes.runId;
        } else {
          resultText = await callRefineText(text, taskSlug as RefineTextAction, accessToken || "");
        }

        if (resultText) {
          if (aiReview && hasSelection) {
            const tracked = applyAsSuggestion(from, to, resultText);
            if (tracked) {
              if (trackMode === "edit") onSetTrackMode("suggest");
              emitChange();
            } else {
              applyTextResult(resultText, from, to, hasSelection);
            }
          } else {
            applyTextResult(resultText, from, to, hasSelection);
          }
          toast.success(t("editor.ai_done"));

          // Show the provenance card for runs that retrieved sources — for a
          // spell-check there is nothing to show and nothing to justify.
          if (runSources.length > 0) {
            setLastRun({
              runId,
              taskLabel: task?.defaultLabel ?? taskSlug,
              applied: 1,
              total: 1,
              failed: 0,
              skipped: 0,
              invalidated: 0,
              tokensSpent: runTokens,
              sources: runSources,
              confidence: runConfidence,
              cancelled: false,
            });
          }
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("editor.ai_error"));
      } finally {
        setAiBusy(null);
      }
    },
    [
      editor, accessToken, getSelectionOrAll, applyTextResult, emitChange, t,
      aiReview, applyAsSuggestion, trackMode, onSetTrackMode,
      documentId, availableTokens,
    ],
  );

  const handleAutoFormatChunked = useCallback(() => {
    if (!editor) return;
    const task = getTaskBySlug("auto_format");
    const plan = planDocumentChunks(editor);
    if (plan.batches.length <= 1 || !task) return false;
    if (aiReview) {
      toast.error("AI Review آن ہے — پوری دستاویز پر چلنے والا کام پہلے Review بند کرنے کا تقاضا کرتا ہے۔");
      return true;
    }
    // auto_format used to send the whole document and overwrite it wholesale,
    // so it simply could not run past 12,000 characters. Routed through the
    // chunker it now works block by block (FR-5.10).
    setPendingChunkedRun({
      taskSlug: "auto_format",
      taskLabel: task.defaultLabel,
      batches: plan.batches,
      skipped: plan.skipped,
      totalCost: plan.batches.reduce((sum, b) => sum + calculateTaskCost(task, b.charCount), 0),
    });
    return true;
  }, [editor, aiReview]);

  const onAddHarakat = useCallback(() => runTextAction("add_harakat", "add_harakat"), [runTextAction]);
  const onSpellCheck = useCallback(() => runTextAction("spelling_check", "spelling_check"), [runTextAction]);
  const onCitations = useCallback(() => runTextAction("citations", "citations"), [runTextAction]);
  const onParaphrase = useCallback(() => runTextAction("paraphrase", "paraphrase"), [runTextAction]);
  const onSummarize = useCallback(() => runTextAction("summarize", "summarize"), [runTextAction]);
  const onNormalizeScript = useCallback(() => runTextAction("normalize_script", "normalize_script"), [runTextAction]);
  const onFormalize = useCallback(() => runTextAction("formalize", "formalize"), [runTextAction]);
  const onHumanize = useCallback(() => runTextAction("humanize", "humanize"), [runTextAction]);
  const onShorten = useCallback(() => runTextAction("shorten", "shorten"), [runTextAction]);

  // ── Remove harakat (client-side, instant — no request) ──
  const onRemoveHarakat = useCallback(() => {
    if (!editor) return;
    const { text, from, to, hasSelection } = getSelectionOrAll();
    if (!text.trim()) return;
    applyTextResult(stripHarakat(text), from, to, hasSelection);
    toast.success(t("editor.ai_done"));
  }, [editor, getSelectionOrAll, applyTextResult, t]);

  const handleAutoFormat = useCallback(async () => {
    if (!editor) return;
    const text = editor.getText();
    if (!text.trim()) return;

    if (import.meta.env.VITE_TASK_CHUNKING !== "false" && handleAutoFormatChunked()) return;

    setAiBusy("auto_format");
    try {
      let html = "";
      if (import.meta.env.VITE_TASK_LIBRARY !== "false") {
        const runRes = await runSingleBatchTask({
          taskSlug: "auto_format",
          text,
          accessToken: accessToken || "",
          documentId,
          availableTokens,
        });
        html = runRes.html || runRes.text || "";
      } else {
        html = await callRefineText(text, "auto_format", accessToken || "");
      }

      if (html) {
        applyResult(editor, html, { isHtml: true });
        emitChange();
        toast.success(t("editor.ai_done"));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("editor.ai_error"));
    } finally {
      setAiBusy(null);
    }
  }, [editor, accessToken, emitChange, t, documentId, availableTokens, handleAutoFormatChunked]);

  const actions = useMemo<SelectionBarActions>(
    () => ({
      onAddHarakat,
      onRemoveHarakat,
      onSpellCheck,
      onParaphrase,
      onSummarize,
      onCitations,
      onNormalizeScript,
      onFormalize,
      onHumanize,
      onShorten,
    }),
    [
      onAddHarakat, onRemoveHarakat, onSpellCheck, onParaphrase, onSummarize, onCitations,
      onNormalizeScript, onFormalize, onHumanize, onShorten,
    ],
  );

  return {
    aiBusy,
    actions,
    handleAutoFormat,
    /** Chunked-run surface: confirmation plan, live progress, cancel. */
    pendingChunkedRun,
    confirmChunkedRun,
    dismissChunkedRun: () => setPendingChunkedRun(null),
    chunkProgress,
    cancelChunkedRun,
    availableTokens,
    /** The finished run's provenance card and its one-click reversal. */
    lastRun,
    undoLastRun,
    dismissLastRun,
  };
}
