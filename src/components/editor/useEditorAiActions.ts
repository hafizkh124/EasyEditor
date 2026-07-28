import { useCallback, useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import { toast } from "sonner";
import { stripHarakat } from "@/utils/arabicUtils";
import { callRefineText, type RefineTextAction } from "@/lib/editor/aiActions";
import { shouldConfirmWholeDocument } from "@/lib/editor/applyScope";
import { textToHtml } from "@/lib/editor/htmlText";

export type TrackMode = "edit" | "suggest" | "view";

/**
 * The AI actions that operate on the current selection. The toolbar and the
 * floating selection bar are two entry points to this one set — never two
 * implementations (SPEC-M2 FR-3.3.2).
 */
export interface SelectionBarActions {
  onAddHarakat: () => void;
  onRemoveHarakat: () => void;
  onSpellCheck: () => void;
  onParaphrase: () => void;
  onSummarize: () => void;
  onCitations: () => void;
}

interface UseEditorAiActionsArgs {
  editor: Editor | null;
  accessToken?: string;
  /** Push the current content out to the host (autosave, word counts). */
  emitChange: () => void;
  t: (key: string) => string;
  /** Track-changes review flow: record the AI edit as an accept/reject suggestion. */
  aiReview: boolean;
  trackMode: TrackMode;
  applyAsSuggestion: (from: number, to: number, newText: string) => boolean;
  onSetTrackMode: (mode: TrackMode) => void;
}

/**
 * Every AI action the editor offers, and the rules about *where* each one is
 * allowed to write. Split out of RichEditor because the component had grown
 * past the point where the AI logic could be read on its own.
 */
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

  /** The current selection text + range, or the whole document if nothing is selected. */
  const getSelectionOrAll = useCallback(() => {
    if (!editor) return { text: "", from: 0, to: 0, hasSelection: false };
    const { from, to, empty } = editor.state.selection;
    const hasSelection = !empty && to > from;
    const text = hasSelection ? editor.state.doc.textBetween(from, to, "\n") : editor.getText();
    return { text, from, to, hasSelection };
  }, [editor]);

  /** Replace the selected range (or the whole doc) with new plain text. */
  const applyTextResult = useCallback(
    (result: string, from: number, to: number, hasSelection: boolean) => {
      if (!editor) return;
      if (hasSelection) {
        editor.chain().focus().insertContentAt({ from, to }, result).run();
      } else {
        editor.commands.setContent(textToHtml(result));
      }
      emitChange();
    },
    [editor, emitChange],
  );

  // ── Actions that return plain text (harakat, spelling, citations, …) ──
  const runTextAction = useCallback(
    async (action: RefineTextAction, busyKey: string) => {
      if (!editor || !accessToken) return;
      const { text, from, to, hasSelection } = getSelectionOrAll();
      if (!text.trim()) return;

      // Running with no selection rewrites the whole document from plain text,
      // which flattens headings, quotes, lists and tables. Ask first when there
      // is formatting to lose — the scholar authorizes, we don't (Constitution §1.6).
      if (shouldConfirmWholeDocument(hasSelection, editor.getJSON())) {
        const proceed = window.confirm(
          t("editor.confirm_whole_document") ||
            "یہ عمل پوری دستاویز پر چلے گا اور اس کی فارمیٹنگ (عنوانات، فہرستیں، اقتباسات، جدول) ختم ہو جائے گی۔ بہتر ہے پہلے متن منتخب کر لیں۔ کیا پھر بھی جاری رکھیں؟",
        );
        if (!proceed) return;
      }

      setAiBusy(busyKey);
      try {
        const result = await callRefineText(text, action, accessToken);
        if (result) {
          // Every action writes back to exactly the range it read from.
          //
          // `citations` used to be special-cased into
          // `setContent(textToHtml(result))` because its output appends a
          // sources block. But the request only ever contained the *selection*,
          // so replacing the whole document threw away everything the user had
          // not selected — select one paragraph, run citations, lose the chapter.
          // The sources block now lands after the selection instead, which is
          // untidy at worst and recoverable with undo.
          if (aiReview && hasSelection) {
            // Multi-line output (citations) can't be tracked inline, so
            // applyAsSuggestion returns false and we fall through.
            const tracked = applyAsSuggestion(from, to, result);
            if (tracked) {
              if (trackMode === "edit") onSetTrackMode("suggest");
              emitChange();
            } else {
              applyTextResult(result, from, to, hasSelection);
            }
          } else {
            applyTextResult(result, from, to, hasSelection);
          }
          toast.success(t("editor.ai_done"));
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
    ],
  );

  const onAddHarakat = useCallback(() => runTextAction("add_harakat", "add_harakat"), [runTextAction]);
  const onSpellCheck = useCallback(() => runTextAction("spelling_check", "spelling_check"), [runTextAction]);
  const onCitations = useCallback(() => runTextAction("citations", "citations"), [runTextAction]);
  const onParaphrase = useCallback(() => runTextAction("paraphrase", "paraphrase"), [runTextAction]);
  const onSummarize = useCallback(() => runTextAction("summarize", "summarize"), [runTextAction]);

  // ── Remove harakat (client-side, instant — no request) ──
  const onRemoveHarakat = useCallback(() => {
    if (!editor) return;
    const { text, from, to, hasSelection } = getSelectionOrAll();
    if (!text.trim()) return;
    applyTextResult(stripHarakat(text), from, to, hasSelection);
    toast.success(t("editor.ai_done"));
  }, [editor, getSelectionOrAll, applyTextResult, t]);

  /**
   * Auto-format is deliberately *not* one of the selection actions: it returns
   * HTML for the whole document and always replaces it, so offering it from a
   * selection bar would mislead (SPEC-M2 §10, 2026-07-28).
   */
  const handleAutoFormat = useCallback(async () => {
    if (!editor || !accessToken) return;
    const text = editor.getText();
    if (!text.trim()) return;
    setAiBusy("auto_format");
    try {
      const html = await callRefineText(text, "auto_format", accessToken);
      if (html) {
        editor.commands.setContent(html);
        emitChange();
        toast.success(t("editor.ai_done"));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("editor.ai_error"));
    } finally {
      setAiBusy(null);
    }
  }, [editor, accessToken, emitChange, t]);

  const actions = useMemo<SelectionBarActions>(
    () => ({ onAddHarakat, onRemoveHarakat, onSpellCheck, onParaphrase, onSummarize, onCitations }),
    [onAddHarakat, onRemoveHarakat, onSpellCheck, onParaphrase, onSummarize, onCitations],
  );

  return { aiBusy, actions, handleAutoFormat };
}
