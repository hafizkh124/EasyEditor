import { useCallback, useState } from "react";
import type { Editor } from "@tiptap/react";
import { getPendingChangeCount, trackChangesPluginKey } from "tiptap-track-changes";
import type { TrackChangesAuthor } from "./editorExtensions";

export type TrackMode = "edit" | "suggest" | "view";

/**
 * Track-changes mode, accept/reject, and recording an AI edit as a suggestion.
 *
 * Split out of `RichEditor` to keep that component under the 300-line limit
 * (SPEC-M3 NFR-1); behaviour is unchanged.
 */
export function useTrackChanges(
  editor: Editor | null,
  authorConfig: TrackChangesAuthor,
  /**
   * Notify the host that the document changed. Deliberately *not* the caller's
   * full `emitChange`: that one refreshes the pending count, which lives here,
   * and the two would depend on each other.
   */
  notifyChange: () => void,
) {
  const [trackMode, setTrackMode] = useState<TrackMode>("edit");
  const [aiReview, setAiReview] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const handleSetTrackMode = useCallback(
    (mode: TrackMode) => {
      if (!editor) return;
      editor.commands.setTrackChangesMode(mode);
      setTrackMode(mode);
    },
    [editor],
  );

  const handleAcceptAll = useCallback(() => {
    if (!editor) return;
    editor.commands.acceptAll();
    setPendingCount(getPendingChangeCount(editor));
    notifyChange();
  }, [editor, notifyChange]);

  const handleRejectAll = useCallback(() => {
    if (!editor) return;
    editor.commands.rejectAll();
    setPendingCount(getPendingChangeCount(editor));
    notifyChange();
  }, [editor, notifyChange]);

  const handleToggleAiReview = useCallback(() => setAiReview((p) => !p), []);

  const refreshPendingCount = useCallback(() => {
    if (editor) setPendingCount(getPendingChangeCount(editor));
  }, [editor]);

  /**
   * Record an AI replacement of [from,to] as a tracked change: mark the old
   * inline text as a deletion and insert the new text as an insertion sharing
   * one changeId. Returns false if the range/text can't be tracked inline
   * (e.g. multi-line / block content) so the caller can fall back.
   */
  const applyAsSuggestion = useCallback(
    (from: number, to: number, newText: string): boolean => {
      if (!editor) return false;
      const { schema } = editor.state;
      const insertionType = schema.marks.insertion;
      const deletionType = schema.marks.deletion;
      if (!insertionType || !deletionType) return false;
      // schema text nodes can't hold newlines — bail to direct replace for block text.
      if (/\n/.test(newText)) return false;

      const author = (editor.storage as { trackChanges?: { author?: TrackChangesAuthor } })
        .trackChanges?.author ?? authorConfig;
      const attrs = {
        changeId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        authorId: author.id,
        authorName: author.name,
        authorColor: author.color,
        timestamp: new Date().toISOString(),
      };

      const tr = editor.state.tr;
      tr.addMark(from, to, deletionType.create(attrs));
      if (newText.length) {
        tr.insert(to, schema.text(newText, [insertionType.create(attrs)]));
      }
      tr.setMeta(trackChangesPluginKey, { handled: true });
      editor.view.dispatch(tr);
      return true;
    },
    [editor, authorConfig],
  );

  return {
    trackMode,
    aiReview,
    pendingCount,
    setPendingCount,
    refreshPendingCount,
    handleSetTrackMode,
    handleAcceptAll,
    handleRejectAll,
    handleToggleAiReview,
    applyAsSuggestion,
  };
}
