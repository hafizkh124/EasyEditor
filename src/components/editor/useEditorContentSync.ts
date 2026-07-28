import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { isRtlText } from "@/utils/textUtils";
import type { DocChangePayload } from "./RichEditor";

interface ContentSyncArgs {
  editor: Editor | null;
  initialContent?: string | Record<string, unknown>;
  contentJson?: Record<string, unknown>;
  contentRevision?: number;
  editorClass: string;
  onChange?: (html: string, text: string) => void;
  onDocChange?: (payload: DocChangePayload) => void;
}

/**
 * Getting externally-supplied content into the editor without ever clobbering
 * the user's typing, plus the text direction that content implies.
 *
 * Split out of `RichEditor` for the 300-line limit (SPEC-M3 NFR-1); the three
 * rules it encodes are unchanged:
 *  1. direction is read from what the editor actually holds, not from a prop;
 *  2. late-arriving content is adopted only while the editor is still empty;
 *  3. a version restore (`contentRevision` bump) overwrites deliberately, and
 *     must emit the change by hand because `setContent` fires no `onUpdate`.
 */
export function useEditorContentSync({
  editor,
  initialContent,
  contentJson,
  contentRevision,
  editorClass,
  onChange,
  onDocChange,
}: ContentSyncArgs) {
  const initialText = typeof initialContent === "string" ? initialContent : "";
  const [isRtl, setIsRtl] = useState(() => isRtlText(initialText));

  useEffect(() => {
    if (!editor) return;
    const text = editor.getText();
    if (text.trim()) setIsRtl(isRtlText(text));
  }, [editor]);

  useEffect(() => {
    if (!editor || editor.getText().trim()) return;
    const next =
      contentJson && Object.keys(contentJson).length > 0
        ? contentJson
        : typeof initialContent === "string" && initialContent
          ? initialContent
          : null;
    if (!next) return;
    editor.commands.setContent(next as Parameters<typeof editor.commands.setContent>[0]);
    setIsRtl(isRtlText(editor.getText()));
  }, [initialContent, contentJson, editor]);

  // Seeded with the revision present on the first render, so mounting never
  // counts as a restore — only a later change does.
  const lastAppliedRevision = useRef<number | undefined>(contentRevision);
  useEffect(() => {
    if (!editor || contentRevision === undefined) return;
    if (lastAppliedRevision.current === contentRevision) return;
    lastAppliedRevision.current = contentRevision;
    if (!contentJson || Object.keys(contentJson).length === 0) return;

    editor.commands.setContent(contentJson as Parameters<typeof editor.commands.setContent>[0]);
    const html = editor.getHTML();
    const text = editor.getText();
    setIsRtl(isRtlText(text));
    onChange?.(html, text);
    onDocChange?.({ json: editor.getJSON() as Record<string, unknown>, text, html });
  }, [contentRevision, contentJson, editor, onChange, onDocChange]);

  useEffect(() => {
    if (editor) {
      editor.setOptions({
        editorProps: { attributes: { class: editorClass, dir: isRtl ? "rtl" : "ltr" } },
      });
    }
  }, [isRtl, editor, editorClass]);

  const toggleDirection = useCallback(() => setIsRtl((prev) => !prev), []);

  return { isRtl, toggleDirection };
}

/** Fullscreen toggle plus its Escape handler. */
export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = useCallback(() => setIsFullscreen((prev) => !prev), []);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  return { isFullscreen, toggleFullscreen };
}
