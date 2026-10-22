import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useOptionalWorkspace, type OutlineHeading } from "@/core/workspace/WorkspaceContext";

/**
 * The open document's outline for the folder index (SYSTEM-2026 §3), and the
 * index's "go to heading". Both walk the same heading nodes in the same
 * order, so the nth entry published is the nth heading jumped to.
 */

function headingsOf(doc: PMNode): { outline: OutlineHeading[]; positions: number[] } {
  const outline: OutlineHeading[] = [];
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      outline.push({ text: node.textContent.trim(), level: Number(node.attrs.level) || 1 });
      positions.push(pos);
      return false;
    }
    return true;
  });
  return { outline, positions };
}

export function useHeadingJump(editor: Editor | null) {
  const ws = useOptionalWorkspace();
  const setDocumentOutline = ws?.setDocumentOutline;
  const jump = ws?.headingJump ?? null;

  // Published on every document change, the initial load included (content
  // set programmatically fires no `update`).
  useEffect(() => {
    if (!editor || !setDocumentOutline) return;
    const publish = () => {
      if (!editor.isDestroyed) setDocumentOutline(headingsOf(editor.state.doc).outline);
    };
    publish();
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) publish();
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
      setDocumentOutline([]);
    };
  }, [editor, setDocumentOutline]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !jump) return;
    const target = headingsOf(editor.state.doc).positions[jump.index];
    if (target === undefined) return;
    editor.chain().focus().setTextSelection(target + 1).run();
    const dom = editor.view.nodeDOM(target);
    if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "start", behavior: "smooth" });
    // Only a new request moves the caret, not a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, jump?.nonce]);
}
