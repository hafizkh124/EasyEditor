import { useEditor, EditorContent } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { getPendingChangeCount } from "tiptap-track-changes";
import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { buildEditorExtensions } from "./editorExtensions";
import { cn } from "@/lib/utils";
import { isRtlText } from "@/utils/textUtils";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useEditorAiActions, type SelectionBarActions } from "./useEditorAiActions";
import { useTrackChanges, type TrackMode } from "./useTrackChanges";
import { useFormatBrush } from "./useFormatBrush";
import { useSelectionOverlay } from "./useSelectionOverlay";
import { useIncompleteRun } from "./useIncompleteRun";
import { useEditorContentSync, useFullscreen } from "./useEditorContentSync";
import { useEditorInserts } from "./useEditorInserts";
import { useAnnotations } from "./useAnnotations";
import EditorToolbar from "./EditorToolbar";
import { EditorMenusAndOverlays } from "./EditorMenusAndOverlays";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
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
   * Bump to force `contentJson` in even when the user has already typed — the
   * one case where overwriting their text is the intent (restoring a version).
   * Left alone, content is only ever adopted into an empty editor.
   */
  contentRevision?: number;
  placeholder?: string;
  onChange?: (html: string, text: string) => void;
  onDocChange?: (payload: DocChangePayload) => void;
  className?: string;
  editable?: boolean;
  /**
   * Render a floating bar over the current selection. The editor owns *when*
   * and *where* it appears; the caller owns what it looks like.
   */
  selectionBar?: (args: SelectionBarRenderArgs) => ReactNode;
  /**
   * HTML to drop in at the cursor. Set a new value to insert; the editor calls
   * `onInsertHandled` once it has, so the caller can clear its signal.
   */
  pendingInsertHtml?: string | null;
  onInsertHandled?: () => void;
  /** Persisted direction for this document; null/undefined = not decided yet. */
  textDirection?: "rtl" | "ltr" | null;
  /** Fired when the user flips direction, so the caller can persist it. */
  onTextDirectionChange?: (dir: "rtl" | "ltr") => void;
}

/**
 * The document surface, deliberately not sized like the chrome around it.
 *
 * This was `prose-sm` — the same 14px the toolbars and side panels use — so the
 * text being written read as densely as a menu label. Urdu and Arabic need more
 * room than Latin at equal point size (taller ascenders/descenders, and
 * Nastaliq's steep baseline especially), which is why the size and line-height
 * step up here rather than inheriting the UI scale. `editor-surface` carries
 * the script-aware line-height; see index.css.
 */
const EDITOR_CLASS =
  "prose prose-base dark:prose-invert max-w-none min-h-[400px] focus:outline-none px-6 py-5 editor-surface";

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
  textDirection,
  onTextDirectionChange,
}: RichEditorProps) => {
  const { session } = useAuth();
  const { t } = useLanguage();
  const [resourceOpen, setResourceOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const workspace = useOptionalWorkspace();
  const documentId = workspace?.activeDocumentId;

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
    // Direction is corrected by `useEditorContentSync` once the editor exists
    // and can be asked what it actually holds.
    editorProps: {
      attributes: {
        class: EDITOR_CLASS,
        dir: isRtlText(typeof initialContent === "string" ? initialContent : "") ? "rtl" : "ltr",
      },
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

  const { isRtl, toggleDirection } = useEditorContentSync({
    editor,
    initialContent,
    contentJson,
    contentRevision,
    editorClass: EDITOR_CLASS,
    storedDirection: textDirection,
    onDirectionChange: onTextDirectionChange,
    onChange,
    onDocChange,
  });

  const { isFullscreen, toggleFullscreen } = useFullscreen();

  const notifyChange = useCallback(() => {
    // Async callers (track-changes, AI actions) can land after unmount, when the
    // editor's state is already torn down — reading it then throws.
    if (editor && !editor.isDestroyed) onChange?.(editor.getHTML(), editor.getText());
  }, [editor, onChange]);


  const {
    trackMode, aiReview, pendingCount, setPendingCount, refreshPendingCount,
    handleSetTrackMode, handleAcceptAll, handleRejectAll, handleToggleAiReview,
    applyAsSuggestion,
  } = useTrackChanges(editor, authorConfig, notifyChange);

  const emitChange = useCallback(() => {
    notifyChange();
    refreshPendingCount();
  }, [notifyChange, refreshPendingCount]);

  const { brushActive, toggleBrush } = useFormatBrush(editor, emitChange);

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
    resumeChunkedRun,
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

  // Margin notes on this document (FR-1.3).
  const notes = useAnnotations(editor, documentId);

  const {
    incompleteRun,
    canResume: canResumeIncompleteRun,
    discard: handleDiscardIncompleteRun,
    resume: handleResumeIncompleteRun,
  } = useIncompleteRun(editor, documentId, resumeChunkedRun);

  const { handleSetFont, handleInsertResource } = useEditorInserts({
    editor,
    emitChange,
    pendingInsertHtml,
    onInsertHandled,
  });

  const selectionUi = useSelectionOverlay(editor, containerRef, Boolean(selectionBar));

  const annotationProps = notes.enabled
    ? {
        items: notes.annotations,
        hasSelection: selectionUi !== null,
        onCreate: notes.createFromSelection,
        onDelete: notes.remove,
      }
    : undefined;

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

      <div
        dir={isRtl ? "rtl" : "ltr"}
        className={cn(isRtl && "text-right", isFullscreen && "flex-1 overflow-auto")}
      >
        <EditorContent editor={editor} />
      </div>

      <EditorMenusAndOverlays
        editor={editor}
        menusEnabled={menusEnabled}
        isMobile={isMobile}
        aiActions={aiActions}
        aiBusy={aiBusy}
        mobileSheetText={mobileSheetText}
        setMobileSheetText={setMobileSheetText}
        handleAutoFormat={handleAutoFormat}
        pendingChunkedRun={pendingChunkedRun}
        dismissChunkedRun={dismissChunkedRun}
        confirmChunkedRun={confirmChunkedRun}
        availableTokens={availableTokens}
        chunkProgress={chunkProgress}
        cancelChunkedRun={cancelChunkedRun}
        lastRun={lastRun}
        undoLastRun={undoLastRun}
        dismissLastRun={dismissLastRun}
        incompleteRun={incompleteRun}
        canResumeIncompleteRun={canResumeIncompleteRun}
        resumeIncompleteRun={handleResumeIncompleteRun}
        discardIncompleteRun={handleDiscardIncompleteRun}
        resourceOpen={resourceOpen}
        setResourceOpen={setResourceOpen}
        handleInsertResource={handleInsertResource}
        selectionBar={selectionBar}
        selectionUi={selectionUi}
        annotations={annotationProps}
        t={t}
      />
    </div>
  );
};

export default RichEditor;
export { type RichEditorProps };
