import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { isRtlText } from "@/utils/textUtils";
import type { DocChangePayload } from "./RichEditor";

export type TextDirection = "rtl" | "ltr";

interface ContentSyncArgs {
  editor: Editor | null;
  initialContent?: string | Record<string, unknown>;
  contentJson?: Record<string, unknown>;
  contentRevision?: number;
  editorClass: string;
  onChange?: (html: string, text: string) => void;
  onDocChange?: (payload: DocChangePayload) => void;
  /**
   * The document's stored direction. `null`/undefined means undecided, in
   * which case it is detected from content as before. A stored value always
   * wins: it is a decision the author made, and re-deriving it from text would
   * throw that away every time the document is reopened.
   */
  direction?: TextDirection | null;
  /** Fired when the author toggles direction, so it can be persisted. */
  onDirectionChange?: (direction: TextDirection) => void;
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
  direction,
  onDirectionChange,
}: ContentSyncArgs) {
  const initialText = typeof initialContent === "string" ? initialContent : "";
  const [isRtl, setIsRtl] = useState(() =>
    direction ? direction === "rtl" : isRtlText(initialText),
  );

  // A stored direction is authoritative and must also win when the *document*
  // changes under a reused editor instance — switching from an Urdu document to
  // an English one has to flip, not inherit.
  useEffect(() => {
    if (direction) setIsRtl(direction === "rtl");
  }, [direction]);

  useEffect(() => {
    if (!editor || direction) return;
    const text = editor.getText();
    if (text.trim()) setIsRtl(isRtlText(text));
  }, [editor, direction]);

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
    // Detection has to happen *after* the content lands, and only while the
    // direction is still undecided. Previously this was the sole place a
    // direction was ever derived, and it ran behind an "editor is empty" guard
    // — so whatever it concluded on the first load was permanent, and a
    // document whose text arrived late (or into an editor that already held the
    // previous document) kept an direction that its own content contradicted.
    if (!direction) setIsRtl(isRtlText(editor.getText()));
  }, [initialContent, contentJson, editor, direction]);

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

  // An explicit toggle is the strongest signal there is about a document's
  // direction, so it is reported upward to be stored — that is what stops the
  // next open from re-deriving (and possibly contradicting) the author's choice.
  const toggleDirection = useCallback(() => {
    setIsRtl((prev) => {
      const next = !prev;
      onDirectionChange?.(next ? "rtl" : "ltr");
      return next;
    });
  }, [onDirectionChange]);

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
