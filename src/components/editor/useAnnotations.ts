import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { toast } from "sonner";
import { annotationService, type AnnotationItem } from "@/core/workspace/annotationService";

/**
 * Margin notes on the document (SPEC-M4 FR-1.3).
 *
 * Detachment is decided by looking for the note's quote in the document text,
 * not by whether its mark survived. A chunked AI run replaces whole ranges, so
 * marks inside them are dropped — but the passage may well still be there, and
 * a note that vanishes because a highlight was rewritten is exactly the data
 * loss the requirement forbids. A note is therefore never deleted implicitly:
 * it is shown as "منقطع" with its original quote intact.
 */
export function useAnnotations(editor: Editor | null, documentId?: string | null) {
  const [annotations, setAnnotations] = useState<AnnotationItem[]>([]);

  const enabled = import.meta.env.VITE_ANNOTATIONS !== "false";

  const markDetached = useCallback(
    (items: AnnotationItem[]): AnnotationItem[] => {
      if (!editor) return items;
      const text = editor.getText();
      return items.map((item) => {
        const quote = item.anchor?.quote ?? "";
        const isDetached = quote.length > 0 && !text.includes(quote);
        return { ...item, anchor: { ...item.anchor, quote, isDetached } };
      });
    },
    [editor],
  );

  const refresh = useCallback(async () => {
    if (!enabled || !documentId) {
      setAnnotations([]);
      return;
    }
    const items = await annotationService.listAnnotations(documentId);
    setAnnotations(markDetached(items));
  }, [enabled, documentId, markDetached]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Re-check attachment after the document settles, not on every keystroke. */
  useEffect(() => {
    if (!editor || !enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const onUpdate = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setAnnotations((prev) => markDetached(prev)), 1500);
    };
    editor.on("update", onUpdate);
    return () => {
      clearTimeout(timer);
      editor.off("update", onUpdate);
    };
  }, [editor, enabled, markDetached]);

  const createFromSelection = useCallback(
    async (note: string) => {
      if (!editor || !documentId) return;
      const { from, to, empty } = editor.state.selection;
      if (empty || to <= from) {
        toast.error("پہلے متن منتخب کریں، پھر نوٹ لگائیں۔");
        return;
      }

      const quote = editor.state.doc.textBetween(from, to, " ").trim();
      const created = await annotationService.createAnnotation({ documentId, quote, note });
      if (!created) {
        toast.error("نوٹ محفوظ نہ ہو سکا۔");
        return;
      }

      // The highlight is a convenience, not the source of truth — if the mark
      // fails to apply the note is still saved and still findable by quote.
      editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .setAnnotationMark({ annotationId: created.id })
        .run();

      setAnnotations((prev) => [{ ...created, anchor: { quote, isDetached: false } }, ...prev]);
      toast.success("حاشیہ نوٹ لگ گیا۔");
    },
    [editor, documentId],
  );

  const remove = useCallback(
    async (id: string) => {
      const ok = await annotationService.deleteAnnotation(id);
      if (!ok) {
        toast.error("نوٹ حذف نہ ہو سکا۔");
        return;
      }
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
      toast.success("نوٹ حذف کر دیا گیا۔");
    },
    [],
  );

  return { enabled, annotations, createFromSelection, remove, refresh };
}
