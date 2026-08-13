import { useCallback, useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import { toast } from "sonner";
import { stripHarakat } from "@/utils/arabicUtils";
import { callRefineText, type RefineTextAction } from "@/lib/editor/aiActions";
import { shouldConfirmWholeDocument } from "@/lib/editor/applyScope";
import { applyResult } from "@/lib/editor/applyResult";
import { planDocumentChunks } from "@/lib/editor/docChunker";
import { runSingleBatchTask } from "@/lib/tasks/runTask";
import { getTaskBySlug } from "@/lib/tasks/registry";
import { calculateTaskCost } from "@/lib/tasks/cost";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { useChunkedRuns, type PendingChunkedRun } from "./useChunkedRuns";
import { useDocumentRuns } from "./useDocumentRuns";
import { useAutoFormat } from "./useAutoFormat";
import type { TaskRunSource } from "@/core/workspace/types";

export type { PendingChunkedRun };

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
  t: import("@/lib/i18n").Translator;
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

  const {
    pendingChunkedRun,
    setPendingChunkedRun,
    confirmChunkedRun,
    dismissChunkedRun,
    chunkProgress,
    cancelChunkedRun,
    executeChunkedRun,
    lastRun,
    setLastRun,
    preRunDocRef,
    undoLastRun,
    dismissLastRun,
  } = useChunkedRuns({
    editor,
    accessToken,
    documentId,
    availableTokens,
    emitChange,
    setAiBusy,
    t,
  });

  const { runDocumentTask, resumeChunkedRun } = useDocumentRuns({
    editor,
    aiReview,
    executeChunkedRun,
    registerDocumentTaskRunner: workspace?.registerDocumentTaskRunner,
  });

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
            toast.error(t("toast.editor.review_track_warning"));
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
      preRunDocRef, setLastRun, setPendingChunkedRun,
    ],
  );


  const { handleAutoFormat } = useAutoFormat({
    editor,
    accessToken,
    documentId,
    availableTokens,
    aiReview,
    emitChange,
    setAiBusy,
    setPendingChunkedRun,
    t,
  });

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


  const actions = useMemo<SelectionBarActions>(
    () => ({
      onAddHarakat, onRemoveHarakat, onSpellCheck, onParaphrase, onSummarize,
      onCitations, onNormalizeScript, onFormalize, onHumanize, onShorten,
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
    dismissChunkedRun,
    chunkProgress,
    cancelChunkedRun,
    /** Continue a run an earlier session left unfinished (FR-1.2). */
    resumeChunkedRun,
    /** Run one task over the whole document — the seam Recipes use (FR-4.5). */
    runDocumentTask,
    availableTokens,
    /** The finished run's provenance card and its one-click reversal. */
    lastRun,
    undoLastRun,
    dismissLastRun,
  };
}
