import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";

/**
 * Format brush: capture the marks at the current selection, then stamp them
 * onto the next selection the user makes.
 *
 * Split out of `RichEditor` for the 300-line limit (SPEC-M3 NFR-1);
 * behaviour is unchanged.
 */
export function useFormatBrush(editor: Editor | null, emitChange: () => void) {
  const [brushActive, setBrushActive] = useState(false);
  const [brushMarks, setBrushMarks] = useState<Record<string, unknown> | null>(null);

  const toggleBrush = useCallback(() => {
    if (!editor) return;
    if (brushActive) {
      setBrushActive(false);
      setBrushMarks(null);
      return;
    }
    setBrushMarks({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      fontFamily: editor.getAttributes("textStyle").fontFamily ?? null,
    });
    setBrushActive(true);
  }, [editor, brushActive]);

  useEffect(() => {
    if (!editor || !brushActive || !brushMarks) return;
    const apply = () => {
      const { empty } = editor.state.selection;
      if (empty) return;
      const chain = editor.chain().focus();
      if (brushMarks.bold) chain.setMark("bold"); else chain.unsetMark("bold");
      if (brushMarks.italic) chain.setMark("italic"); else chain.unsetMark("italic");
      if (brushMarks.underline) chain.setMark("underline"); else chain.unsetMark("underline");
      if (brushMarks.strike) chain.setMark("strike"); else chain.unsetMark("strike");
      if (brushMarks.fontFamily) chain.setFontFamily(brushMarks.fontFamily as string);
      else chain.unsetFontFamily();
      chain.run();
      emitChange();
      setBrushActive(false);
      setBrushMarks(null);
    };
    editor.on("selectionUpdate", apply);
    return () => { editor.off("selectionUpdate", apply); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, brushActive, brushMarks]);

  return { brushActive, toggleBrush };
}
