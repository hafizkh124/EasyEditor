import { useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { toast } from "sonner";
import { callRefineText } from "@/lib/editor/aiActions";
import { applyResult } from "@/lib/editor/applyResult";
import { planDocumentChunks } from "@/lib/editor/docChunker";
import { runSingleBatchTask } from "@/lib/tasks/runTask";
import { getTaskBySlug } from "@/lib/tasks/registry";
import { calculateTaskCost } from "@/lib/tasks/cost";
import type { PendingChunkedRun } from "./useChunkedRuns";
import { translateStored } from "@/lib/i18n";

interface UseAutoFormatArgs {
  editor: Editor | null;
  accessToken?: string;
  documentId?: string;
  availableTokens?: number;
  aiReview: boolean;
  emitChange: () => void;
  setAiBusy: (key: string | null) => void;
  setPendingChunkedRun: (plan: PendingChunkedRun | null) => void;
  t: import("@/lib/i18n").Translator;
}

/**
 * Auto-format, which is the one task that rewrites structure rather than text.
 *
 * It gets its own module because it has two paths — a single call for a short
 * document, and the chunked pipeline for anything longer — and because the
 * chunked path is what let it work at all past 12,000 characters (FR-5.10).
 */
export function useAutoFormat({
  editor,
  accessToken,
  documentId,
  availableTokens,
  aiReview,
  emitChange,
  setAiBusy,
  setPendingChunkedRun,
  t,
}: UseAutoFormatArgs) {
  const handleAutoFormatChunked = useCallback(() => {
    if (!editor) return;
    const task = getTaskBySlug("auto_format");
    const plan = planDocumentChunks(editor);
    if (plan.batches.length <= 1 || !task) return false;
    if (aiReview) {
      toast.error(translateStored("toast.editor.disable_review"));
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

  return { handleAutoFormat };
}
