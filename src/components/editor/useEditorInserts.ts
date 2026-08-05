import { useCallback, useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { isRtlText } from "@/utils/textUtils";
import { escapeHtml } from "@/lib/editor/htmlText";
import { registerExternalInsertHandler } from "@/lib/editor/insertBus";

interface EditorInsertsArgs {
  editor: Editor | null;
  emitChange: () => void;
  /** HTML handed over from the Workbench (SPEC-M2 FR-4.5). */
  pendingInsertHtml?: string | null;
  onInsertHandled?: () => void;
}

/**
 * The three ways content or formatting arrives from outside the typing flow:
 * the font picker, an inserted research resource, and the Workbench→Canvas
 * hand-off.
 *
 * Split out of `RichEditor` for the 300-line limit (SPEC-M3 NFR-1).
 */
export function useEditorInserts({
  editor,
  emitChange,
  pendingInsertHtml,
  onInsertHandled,
}: EditorInsertsArgs) {
  const handleSetFont = useCallback(
    (fontFamily: string) => {
      if (!editor) return;
      const { empty } = editor.state.selection;
      const chain = editor.chain().focus();
      if (empty) chain.selectAll();
      if (fontFamily) chain.setFontFamily(fontFamily).run();
      else chain.unsetFontFamily().run();
      emitChange();
    },
    [editor, emitChange],
  );

  const handleInsertResource = useCallback(
    (text: string, citation: string) => {
      if (!editor) return;
      const rtl = isRtlText(text);
      const html =
        `<blockquote dir="${rtl ? "rtl" : "ltr"}"><p>${escapeHtml(text)}</p>` +
        `<p><em>[${escapeHtml(citation)}]</em></p></blockquote><p></p>`;
      editor.chain().focus().insertContent(html).run();
      emitChange();
    },
    [editor, emitChange],
  );

  // The ref makes this idempotent: the same signal is never inserted twice, no
  // matter how often the effect is re-run.
  const insertedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editor || !pendingInsertHtml) {
      if (!pendingInsertHtml) insertedRef.current = null;
      return;
    }
    if (insertedRef.current === pendingInsertHtml) return;
    insertedRef.current = pendingInsertHtml;
    editor.chain().focus().insertContent(pendingInsertHtml).run();
    emitChange();
    onInsertHandled?.();
  }, [editor, pendingInsertHtml, emitChange, onInsertHandled]);

  // SPEC-TAFSIR §FR-5.3: while an editor is mounted it exposes itself to the
  // external insert bus so dialogs on other routes (e.g. Tafsir search) can
  // insert at the cursor. Registration is scoped to this editor's lifetime.
  useEffect(() => {
    if (!editor) return;
    return registerExternalInsertHandler((html) => {
      editor.chain().focus().insertContent(html).run();
      emitChange();
    });
  }, [editor, emitChange]);

  return { handleSetFont, handleInsertResource };
}
