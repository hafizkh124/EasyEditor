import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { isRtlText } from "@/utils/textUtils";
import type { DocChangePayload } from "./RichEditor";

export type StoredTextDirection = "rtl" | "ltr" | null | undefined;

interface ContentSyncArgs {
  editor: Editor | null;
  initialContent?: string | Record<string, unknown>;
  contentJson?: Record<string, unknown>;
  contentRevision?: number;
  editorClass: string;
  /** Persisted direction for this document; null/undefined = not decided yet. */
  storedDirection?: StoredTextDirection;
  /** Called when the user deliberately flips direction, so it can be saved. */
  onDirectionChange?: (dir: "rtl" | "ltr") => void;
  onChange?: (html: string, text: string) => void;
  onDocChange?: (payload: DocChangePayload) => void;
}

/**
 * Getting externally-supplied content into the editor without ever clobbering
 * the user's typing, plus the text direction that content implies.
 *
 * Split out of `RichEditor` for the 300-line limit (SPEC-M3 NFR-1); the rules
 * it encodes:
 *  1. a persisted direction always wins — it is a decision, not a guess;
 *  2. otherwise direction is detected from what the editor actually holds, and
 *     re-detected when the content arrives late or the document changes;
 *  3. late-arriving content is adopted only while the editor is still empty;
 *  4. a version restore (`contentRevision` bump) overwrites deliberately, and
 *     must emit the change by hand because `setContent` fires no `onUpdate`.
 */
export function useEditorContentSync({
  editor,
  initialContent,
  contentJson,
  contentRevision,
  editorClass,
  storedDirection,
  onDirectionChange,
  onChange,
  onDocChange,
}: ContentSyncArgs) {
  const initialText = typeof initialContent === "string" ? initialContent : "";
  const [isRtl, setIsRtl] = useState(() =>
    storedDirection ? storedDirection === "rtl" : isRtlText(initialText),
  );

  // True once the direction for the currently-open document is settled, either
  // from a stored value or from real content. Until then detection keeps
  // re-running, so a guess made against an empty editor is never permanent.
  const resolved = useRef<boolean>(Boolean(storedDirection));

  useEffect(() => {
    if (storedDirection) {
      resolved.current = true;
      setIsRtl(storedDirection === "rtl");
    } else {
      resolved.current = false;
    }
  }, [storedDirection]);

  useEffect(() => {
    if (!editor || resolved.current) return;
    const text = editor.getText();
    if (!text.trim()) return;
    resolved.current = true;
    setIsRtl(isRtlText(text));
  }, [editor, contentJson, initialContent, contentRevision]);

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
    if (!resolved.current) {
      const text = editor.getText();
      if (text.trim()) {
        resolved.current = true;
        setIsRtl(isRtlText(text));
      }
    }
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
    if (!editor) return;
    const dir = isRtl ? "rtl" : "ltr";
    editor.setOptions({
      editorProps: { attributes: { class: editorClass, dir } },
    });
    // `setOptions` alone does not reliably reach the live ProseMirror DOM node
    // for `dir` specifically — the contenteditable root can be left stuck on
    // whatever `dir` it had at view creation. Since `dir` (not just CSS
    // `text-align`) is what the browser uses to decide cursor movement,
    // Home/End, and selection-extension direction, a stuck `dir="ltr"` is
    // exactly what makes RTL documents feel broken to edit even though the
    // text visually renders right-aligned. Set it directly as a guarantee.
    if (editor.view?.dom) editor.view.dom.setAttribute("dir", dir);
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
