import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle, FontFamily } from "@tiptap/extension-text-style";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { TrackChangesExtension, trackChangesPluginKey, getPendingChangeCount } from "tiptap-track-changes";
import { useState, useEffect, useCallback, useMemo } from "react";
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

type TrackMode = "edit" | "suggest" | "view";

const RichEditor = ({ initialContent, placeholder, onChange, className, editable = true }: RichEditorProps) => {
  const { session } = useAuth();
  const { t } = useLanguage();
  const [isRtl, setIsRtl] = useState(() => isRtlText(initialContent ?? ""));
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [resourceOpen, setResourceOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [brushActive, setBrushActive] = useState(false);
  const [brushMarks, setBrushMarks] = useState<Record<string, unknown> | null>(null);
  const [trackMode, setTrackMode] = useState<TrackMode>("edit");
  const [aiReview, setAiReview] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // Author identity for tracked changes, derived from the signed-in user.
  const authorConfig = useMemo(() => {
    const user = session?.user;
    const meta = (user?.user_metadata ?? {}) as { full_name?: string; name?: string };
    const name = meta.full_name || meta.name || user?.email?.split("@")[0] || "You";
    return { id: user?.id ?? "anon", name, color: "#2d5fce" };
  }, [session]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: placeholder ?? "Start writing..." }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      FontFamily,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TrackChangesExtension.configure({ author: authorConfig, mode: "edit" }),
    ],
    content: initialContent ?? "",
    editable,
    editorProps: {
      attributes: { class: EDITOR_CLASS, dir: isRtl ? "rtl" : "ltr" },
    },
    onUpdate: ({ editor: e }) => {
      onChange?.(e.getHTML(), e.getText());
      setPendingCount(getPendingChangeCount(e));
    },
  });

  // Keep the tracked-change author in sync with the signed-in user.
  useEffect(() => {
    if (editor) editor.commands.setTrackChangesAuthor(authorConfig);
  }, [editor, authorConfig]);

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

  const toggleFullscreen = useCallback(() => setIsFullscreen((prev) => !prev), []);

  // Exit fullscreen on Escape.
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setIsFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  // ── Format-brush: capture marks from selection, apply to next selection ──
  const toggleBrush = useCallback(() => {
    if (!editor) return;
    if (brushActive) {
      setBrushActive(false);
      setBrushMarks(null);
      return;
    }
    const marks: Record<string, unknown> = {
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      fontFamily: editor.getAttributes("textStyle").fontFamily ?? null,
    };
    setBrushMarks(marks);
    setBrushActive(true);
  }, [editor, brushActive]);

  // Apply captured marks when the user makes a new selection while the brush is active.
  useEffect(() => {
    if (!editor || !brushActive || !brushMarks) return;
    const apply = () => {
      const { empty } = editor.state.selection;
      if (empty) return;
      const chain = editor.chain().focus();
      brushMarks.bold ? chain.setMark("bold") : chain.unsetMark("bold");
      brushMarks.italic ? chain.setMark("italic") : chain.unsetMark("italic");
      brushMarks.underline ? chain.setMark("underline") : chain.unsetMark("underline");
      brushMarks.strike ? chain.setMark("strike") : chain.unsetMark("strike");
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

  const emitChange = useCallback(() => {
    if (editor) {
      onChange?.(editor.getHTML(), editor.getText());
      setPendingCount(getPendingChangeCount(editor));
    }
  }, [editor, onChange]);

  // ── Track-changes mode + accept/reject ──
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
    emitChange();
  }, [editor, emitChange]);

  const handleRejectAll = useCallback(() => {
    if (!editor) return;
    editor.commands.rejectAll();
    emitChange();
  }, [editor, emitChange]);

  const handleToggleAiReview = useCallback(() => setAiReview((p) => !p), []);

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

      const author = (editor.storage as { trackChanges?: { author?: typeof authorConfig } })
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
          } else if (aiReview && hasSelection) {
            // Review flow: record the AI edit as an accept/reject suggestion.
            const tracked = applyAsSuggestion(from, to, result);
            if (tracked) {
              if (trackMode === "edit") handleSetTrackMode("suggest");
              emitChange();
            } else {
              applyTextResult(result, from, to, hasSelection);
            }
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
    [editor, session, getSelectionOrAll, applyTextResult, emitChange, t, aiReview, applyAsSuggestion, trackMode, handleSetTrackMode],
  );

  const handleAddHarakat = useCallback(() => runTextAction("add_harakat", "add_harakat"), [runTextAction]);
  const handleSpellCheck = useCallback(() => runTextAction("spelling_check", "spelling_check"), [runTextAction]);
  const handleCitations = useCallback(() => runTextAction("citations", "citations"), [runTextAction]);
  const handleParaphrase = useCallback(() => runTextAction("paraphrase", "paraphrase"), [runTextAction]);
  const handleSummarize = useCallback(() => runTextAction("summarize", "summarize"), [runTextAction]);

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
    <div
      className={cn(
        isFullscreen
          ? "fixed inset-0 z-50 bg-card overflow-auto rounded-none flex flex-col"
          : "rounded-xl border border-border bg-card overflow-hidden shadow-sm",
        className,
      )}
    >
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
        onParaphrase={handleParaphrase}
        onSummarize={handleSummarize}
        onCitations={handleCitations}
        onOpenResources={() => setResourceOpen(true)}
        onSetFont={handleSetFont}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        brushActive={brushActive}
        onToggleBrush={toggleBrush}
        trackMode={trackMode}
        onSetTrackMode={handleSetTrackMode}
        aiReview={aiReview}
        onToggleAiReview={handleToggleAiReview}
        pendingCount={pendingCount}
        onAcceptAll={handleAcceptAll}
        onRejectAll={handleRejectAll}
      />
      <div className={cn(isRtl && "text-right", isFullscreen && "flex-1 overflow-auto")}>
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
