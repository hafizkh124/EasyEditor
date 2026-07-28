import { useCallback, useEffect, useState, type RefObject } from "react";
import type { Editor } from "@tiptap/react";

export interface SelectionUi {
  text: string;
  top: number;
  left: number;
  below: boolean;
}

/**
 * Where the floating selection bar should sit, if anywhere.
 *
 * Coordinates are measured against the editor's own container so the bar
 * travels with it inside a resizable panel. When the selection starts too
 * close to the top the bar flips below it, otherwise `overflow-hidden` clips
 * it. Split out of `RichEditor` for the 300-line limit (SPEC-M3 NFR-1).
 */
export function useSelectionOverlay(
  editor: Editor | null,
  containerRef: RefObject<HTMLElement>,
  enabled: boolean,
) {
  const [selectionUi, setSelectionUi] = useState<SelectionUi | null>(null);

  const updateSelectionUi = useCallback(() => {
    if (!editor || !enabled) return;
    const { from, to, empty } = editor.state.selection;
    const container = containerRef.current;
    if (empty || to <= from || !container) {
      setSelectionUi(null);
      return;
    }
    const text = editor.state.doc.textBetween(from, to, "\n");
    if (!text.trim()) {
      setSelectionUi(null);
      return;
    }
    const rect = container.getBoundingClientRect();
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);
    const above = Math.min(start.top, end.top) - rect.top - 10;
    const below = above < 48;
    setSelectionUi({
      text,
      top: below ? Math.max(start.bottom, end.bottom) - rect.top + 10 : above,
      left: (start.left + end.left) / 2 - rect.left,
      below,
    });
  }, [editor, containerRef, enabled]);

  useEffect(() => {
    if (!editor || !enabled) return;
    editor.on("selectionUpdate", updateSelectionUi);
    editor.on("transaction", updateSelectionUi);
    return () => {
      editor.off("selectionUpdate", updateSelectionUi);
      editor.off("transaction", updateSelectionUi);
    };
  }, [editor, enabled, updateSelectionUi]);

  return selectionUi;
}
