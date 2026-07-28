import { useEditor, EditorContent } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { trackChangesPluginKey, getPendingChangeCount } from "tiptap-track-changes";
import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { buildEditorExtensions } from "./editorExtensions";
import { cn } from "@/lib/utils";
import { isRtlText } from "@/utils/textUtils";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { escapeHtml } from "@/lib/editor/htmlText";
import {
  useEditorAiActions,
  type SelectionBarActions,
  type TrackMode,
} from "./useEditorAiActions";
import EditorToolbar from "./EditorToolbar";
import ResourceSearchDialog from "./ResourceSearchDialog";
import { FloatingBubbleMenu } from "./FloatingBubbleMenu";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { SolvencyDialog } from "@/components/workspace/SolvencyDialog";
import { ChunkProgressBar } from "@/components/workspace/ChunkProgressBar";
import { TaskRunCard } from "@/components/workspace/TaskRunCard";
import { MobileTaskSheet } from "./MobileTaskSheet";
import { useIsMobile } from "@/hooks/use-mobile";

export interface DocChangePayload {
  json: Record<string, unknown>;
  text: string;
  html: string;
}

export type { SelectionBarActions, TrackMode };

export interface SelectionBarRenderArgs {
  selectedText: string;
  isBusy: boolean;
  actions: SelectionBarActions;
}

interface RichEditorProps {
  initialContent?: string | Record<string, unknown>;
  contentJson?: Record<string, unknown>;
  /**
   * Bump this to force `contentJson` into the editor even when the user has
   * already typed — the one case where overwriting their text is the intent
   * (restoring a version). Leave it alone and content is only ever adopted
   * into an empty editor.
   */
  contentRevision?: number;
  placeholder?: string;
  onChange?: (html: string, text: string) => void;
  onDocChange?: (payload: DocChangePayload) => void;
  className?: string;
  editable?: boolean;
  /**
   * Render a floating bar over the current selection. The editor owns *when*
   * and *where* it appears; the caller owns what it looks like. Leave it out
   * and nothing changes for existing callers.
   */
  selectionBar?: (args: SelectionBarRenderArgs) => ReactNode;
  /**
   * HTML to drop in at the cursor. Set it to a new value to insert; the editor
   * calls `onInsertHandled` once it has, so the caller can clear its signal.
   */
  pendingInsertHtml?: string | null;
  onInsertHandled?: () => void;
}

const EDITOR_CLASS =
  "prose prose-sm dark:prose-invert max-w-none min-h-[400px] focus:outline-none px-6 py-5 leading-relaxed";

const RichEditor = ({
  initialContent,
  contentJson,
  contentRevision,
  placeholder,
  onChange,
  onDocChange,
  className,
  editable = true,
  selectionBar,
  pendingInsertHtml,
  onInsertHandled,
}: RichEditorProps) => {
  const { session } = useAuth();
  const { t } = useLanguage();
  const initialText = typeof initialContent === "string" ? initialContent : "";
  const [isRtl, setIsRtl] = useState(() => isRtlText(initialText));
  const [resourceOpen, setResourceOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [brushActive, setBrushActive] = useState(false);
  const [brushMarks, setBrushMarks] = useState<Record<string, unknown> | null>(null);
  const [trackMode, setTrackMode] = useState<TrackMode>("edit");
  const [aiReview, setAiReview] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectionUi, setSelectionUi] = useState<{
    text: string;
    top: number;
    left: number;
    below: boolean;
  } | null>(null);

  // M3 Pillar B menus. When off, the editor falls back to the M2 selection bar.
  const menusEnabled = import.meta.env.VITE_EDITOR_MENUS !== "false";
  const isMobile = useIsMobile();
  const [mobileSheetText, setMobileSheetText] = useState<string | null>(null);

  // Author identity for tracked changes, derived from the signed-in user.
  const authorConfig = useMemo(() => {
    const user = session?.user;
    const meta = (user?.user_metadata ?? {}) as { full_name?: string; name?: string };
    const name = meta.full_name || meta.name || user?.email?.split("@")[0] || "You";
    return { id: user?.id ?? "anon", name, color: "#2d5fce" };
  }, [session]);

  const effectiveContent = contentJson && Object.keys(contentJson).length > 0
    ? contentJson
    : (initialContent ?? "");

  const editor = useEditor({
    extensions: [
      ...buildEditorExtensions(authorConfig),
      Placeholder.configure({ placeholder: placeholder ?? "Start writing..." }),
    ],
    content: effectiveContent,
    editable,
    editorProps: {
      attributes: { class: EDITOR_CLASS, dir: isRtl ? "rtl" : "ltr" },
    },
    onUpdate: ({ editor: e }) => {
      const html = e.getHTML();
      const text = e.getText();
      const json = e.getJSON() as Record<string, unknown>;

      onChange?.(html, text);
      onDocChange?.({ json, text, html });
      setPendingCount(getPendingChangeCount(e));
    },
  });

  // Keep the tracked-change author in sync with the signed-in user.
  useEffect(() => {
    if (editor) editor.commands.setTrackChangesAuthor(authorConfig);
  }, [editor, authorConfig]);

  // Direction comes from what the editor actually holds, not from the prop:
  // `contentJson` is a Tiptap node tree, so `isRtlText` can't read it directly.
  // Runs once the editor exists — covers the mount-with-content case, which is
  // the normal path for a saved document (Editor.tsx only mounts us after load).
  useEffect(() => {
    if (!editor) return;
    const text = editor.getText();
    if (text.trim()) setIsRtl(isRtlText(text));
  }, [editor]);

  // Late-arriving content: push it in only while the editor is still empty, so
  // we never clobber something the user has already typed.
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

  // Forced replacement (version restore). The ref is seeded with the revision
  // present on the first render, so mounting never counts as a restore — only a
  // later change does. `setContent` does not fire `onUpdate`, so the payload is
  // emitted by hand; otherwise the restore would show on screen but never save.
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

  // Every AI action, and the rules about where each one may write, live in the
  // hook — see useEditorAiActions.
  const {
    aiBusy,
    actions: aiActions,
    handleAutoFormat,
    pendingChunkedRun,
    confirmChunkedRun,
    dismissChunkedRun,
    chunkProgress,
    cancelChunkedRun,
    availableTokens,
    lastRun,
    undoLastRun,
    dismissLastRun,
  } = useEditorAiActions({
    editor,
    accessToken: session?.access_token,
    emitChange,
    t,
    aiReview,
    trackMode,
    applyAsSuggestion,
    onSetTrackMode: handleSetTrackMode,
  });

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

  // ── Selection bar: where the floating bar should sit, if anywhere ──
  //
  // Coordinates are measured against our own container so the bar travels with
  // the editor inside a resizable panel. When the selection starts too close to
  // the top the bar flips below it, otherwise `overflow-hidden` clips it.
  const updateSelectionUi = useCallback(() => {
    if (!editor || !selectionBar) return;
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
  }, [editor, selectionBar]);

  useEffect(() => {
    if (!editor || !selectionBar) return;
    editor.on("selectionUpdate", updateSelectionUi);
    editor.on("transaction", updateSelectionUi);
    return () => {
      editor.off("selectionUpdate", updateSelectionUi);
      editor.off("transaction", updateSelectionUi);
    };
  }, [editor, selectionBar, updateSelectionUi]);

  // ── Insert content handed to us from outside (Workbench → Canvas, FR-4.5) ──
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

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative",
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
        onAddHarakat={aiActions.onAddHarakat}
        onRemoveHarakat={aiActions.onRemoveHarakat}
        onSpellCheck={aiActions.onSpellCheck}
        onAutoFormat={handleAutoFormat}
        onParaphrase={aiActions.onParaphrase}
        onSummarize={aiActions.onSummarize}
        onCitations={aiActions.onCitations}
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

      {menusEnabled && (
        <>
          <FloatingBubbleMenu
            editor={editor}
            actions={aiActions}
            aiBusy={aiBusy}
            isMobile={isMobile}
            onOpenMobileSheet={setMobileSheetText}
          />
          {/* The floating slash list is desktop-only; on touch the same tasks
              are reachable from the sheet, where the keyboard cannot cover them. */}
          {!isMobile && (
            <SlashCommandMenu editor={editor} actions={aiActions} onAutoFormat={handleAutoFormat} />
          )}
          <MobileTaskSheet
            open={mobileSheetText !== null}
            onOpenChange={(open) => !open && setMobileSheetText(null)}
            selectedText={mobileSheetText ?? ""}
            aiBusy={aiBusy}
            getHandler={(slug) => {
              const map: Record<string, (() => void) | undefined> = {
                add_harakat: aiActions.onAddHarakat,
                remove_harakat: aiActions.onRemoveHarakat,
                spelling_check: aiActions.onSpellCheck,
                paraphrase: aiActions.onParaphrase,
                summarize: aiActions.onSummarize,
                citations: aiActions.onCitations,
                normalize_script: aiActions.onNormalizeScript,
                formalize: aiActions.onFormalize,
                humanize: aiActions.onHumanize,
                shorten: aiActions.onShorten,
              };
              return map[slug];
            }}
          />
        </>
      )}

      {/* The M2 hand-rolled bar is the fallback for `VITE_EDITOR_MENUS=false`.
          Rendering it alongside FloatingBubbleMenu would stack two toolbars over
          the same selection, so the two are mutually exclusive (SPEC-M3 FR-3.1). */}
      {!menusEnabled && selectionBar && selectionUi && (
        <div
          className="absolute z-40"
          style={{
            top: selectionUi.top,
            left: selectionUi.left,
            transform: `translate(-50%, ${selectionUi.below ? "0" : "-100%"})`,
          }}
          // Keep the ProseMirror selection intact while a bar button is pressed.
          onMouseDown={(e) => e.preventDefault()}
        >
          {selectionBar({
            selectedText: selectionUi.text,
            isBusy: aiBusy !== null,
            actions: aiActions,
          })}
        </div>
      )}
      {/* A multi-batch run never starts without an explicit go-ahead that names
          the batch count, the cost, and the balance (SPEC-M3 FR-5.11). */}
      {pendingChunkedRun && (
        <SolvencyDialog
          open
          onOpenChange={(open) => {
            if (!open) dismissChunkedRun();
          }}
          taskLabel={pendingChunkedRun.taskLabel}
          totalChunks={pendingChunkedRun.batches.length}
          totalCost={pendingChunkedRun.totalCost}
          availableTokens={availableTokens}
          onConfirm={confirmChunkedRun}
        />
      )}

      {chunkProgress && (
        <ChunkProgressBar progress={chunkProgress} onCancel={cancelChunkedRun} />
      )}

      {/* Provenance for the run that just finished, with one-click reversal
          (SPEC-M3 FR-4.5 / FR-5.9). Retires itself on the next edit. */}
      {!chunkProgress && lastRun && (
        <TaskRunCard summary={lastRun} onUndo={undoLastRun} onDismiss={dismissLastRun} />
      )}

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
