import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle, FontFamily } from "@tiptap/extension-text-style";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { isRtlText } from "@/utils/textUtils";
import { stripHarakat } from "@/utils/arabicUtils";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { callRefineText, type RefineTextAction } from "@/lib/editor/aiActions";
import EditorToolbar from "./EditorToolbar";
import ResourceSearchDialog from "./ResourceSearchDialog";

interface RichEditorProps {
  initialContent?: string;
  placeholder?: string;
  onChange?: (html: string, text: string) => void;
  className?: string;
  editable?: boolean;
}

const EDITOR_CLASS =
  "prose prose-sm dark:prose-invert max-w-none min-h-[400px] focus:outline-none px-6 py-5 leading-relaxed";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Convert plain text (with line breaks) into paragraph HTML for setContent. */
function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

const RichEditor = ({ initialContent, placeholder, onChange, className, editable = true }: RichEditorProps) => {
  const { session } = useAuth();
  const { t } = useLanguage();
  const [isRtl, setIsRtl] = useState(() => isRtlText(initialContent ?? ""));
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [resourceOpen, setResourceOpen] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: placeholder ?? "Start writing..." }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      FontFamily,
    ],
    content: initialContent ?? "",
    editable,
    editorProps: {
      attributes: { class: EDITOR_CLASS, dir: isRtl ? "rtl" : "ltr" },
    },
    onUpdate: ({ editor: e }) => onChange?.(e.getHTML(), e.getText()),
  });

  useEffect(() => {
    if (editor && initialContent && !editor.getText().trim()) {
      editor.commands.setContent(initialContent);
      setIsRtl(isRtlText(initialContent));
    }
  }, [initialContent, editor]);

  useEffect(() => {
    if (editor) {
      editor.setOptions({
        editorProps: { attributes: { class: EDITOR_CLASS, dir: isRtl ? "rtl" : "ltr" } },
      });
    }
  }, [isRtl, editor]);

  const toggleDirection = useCallback(() => setIsRtl((prev) => !prev), []);

  const emitChange = useCallback(() => {
    if (editor) onChange?.(editor.getHTML(), editor.getText());
  }, [editor, onChange]);

  /** Returns the current selection text + range, or the whole document if nothing is selected. */
  const getSelectionOrAll = useCallback(() => {
    if (!editor) return { text: "", from: 0, to: 0, hasSelection: false };
    const { from, to, empty } = editor.state.selection;
    const hasSelection = !empty && to > from;
    const text = hasSelection ? editor.state.doc.textBetween(from, to, "\n") : editor.getText();
    return { text, from, to, hasSelection };
  }, [editor]);

  /** Replace selected range (or whole doc) with new plain text. */
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

  // ── AI: actions that return plain text (harakat, spelling, citations) ──
  const runTextAction = useCallback(
    async (action: RefineTextAction, busyKey: string) => {
      if (!editor || !session?.access_token) return;
      const { text, from, to, hasSelection } = getSelectionOrAll();
      if (!text.trim()) return;
      setAiBusy(busyKey);
      try {
        const result = await callRefineText(text, action, session.access_token);
        if (result) {
          // Citations appends a sources section → always replace whole content.
          if (action === "citations") {
            editor.commands.setContent(textToHtml(result));
            emitChange();
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
    [editor, session, getSelectionOrAll, applyTextResult, emitChange, t],
  );

  const handleAddHarakat = useCallback(() => runTextAction("add_harakat", "add_harakat"), [runTextAction]);
  const handleSpellCheck = useCallback(() => runTextAction("spelling_check", "spelling_check"), [runTextAction]);
  const handleCitations = useCallback(() => runTextAction("citations", "citations"), [runTextAction]);

  // ── Remove harakat (client-side, instant) ──
  const handleRemoveHarakat = useCallback(() => {
    if (!editor) return;
    const { text, from, to, hasSelection } = getSelectionOrAll();
    if (!text.trim()) return;
    applyTextResult(stripHarakat(text), from, to, hasSelection);
    toast.success(t("editor.ai_done"));
  }, [editor, getSelectionOrAll, applyTextResult, t]);

  // ── AI: auto-format → returns HTML, always replaces whole document ──
  const handleAutoFormat = useCallback(async () => {
    if (!editor || !session?.access_token) return;
    const text = editor.getText();
    if (!text.trim()) return;
    setAiBusy("auto_format");
    try {
      const html = await callRefineText(text, "auto_format", session.access_token);
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
  }, [editor, session, emitChange, t]);

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

  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden shadow-sm", className)}>
      <EditorToolbar
        editor={editor}
        isRtl={isRtl}
        onToggleDirection={toggleDirection}
        t={t}
        aiBusy={aiBusy}
        onAddHarakat={handleAddHarakat}
        onRemoveHarakat={handleRemoveHarakat}
        onSpellCheck={handleSpellCheck}
        onAutoFormat={handleAutoFormat}
        onCitations={handleCitations}
        onOpenResources={() => setResourceOpen(true)}
        onSetFont={handleSetFont}
      />
      <div className={cn(isRtl && "text-right")}>
        <EditorContent editor={editor} />
      </div>
      <ResourceSearchDialog
        open={resourceOpen}
        onOpenChange={setResourceOpen}
        onInsert={handleInsertResource}
        t={t}
      />
    </div>
  );
};

export default RichEditor;
export { type RichEditorProps };
