import React, { useState, useEffect, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold, Italic, Heading1, Heading2, Quote, Search,
  Sparkles, Eraser, CheckCheck, RefreshCw, FileText,
  BookmarkCheck, AlignLeft, GraduationCap, Heart, Scissors, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTasksForSurface } from "@/lib/tasks/registry";
import { calculateTaskCost } from "@/lib/tasks/cost";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import type { TaskDefinition } from "@/lib/tasks/types";
import type { SelectionBarActions } from "./useEditorAiActions";

interface FloatingBubbleMenuProps {
  editor: Editor | null;
  actions: SelectionBarActions;
  aiBusy: string | null;
  /**
   * On touch layouts the bar collapses to a single pill that opens a bottom
   * sheet instead (FR-3.4). When set, this is called on tap.
   */
  onOpenMobileSheet?: (selectedText: string) => void;
  isMobile?: boolean;
}

const TASK_ICONS: Record<string, React.FC<{ className?: string }>> = {
  add_harakat: Sparkles,
  remove_harakat: Eraser,
  spelling_check: CheckCheck,
  paraphrase: RefreshCw,
  summarize: FileText,
  citations: BookmarkCheck,
  normalize_script: AlignLeft,
  formalize: GraduationCap,
  humanize: Heart,
  shorten: Scissors,
};

/**
 * Short button captions. Deriving these from `defaultLabel.split(" ")[0]` gave
 * two different buttons the caption "علمی" (citations and formalize), so the
 * captions are spelled out here instead.
 */
const TASK_SHORT_LABEL: Record<string, string> = {
  add_harakat: "حرکات",
  remove_harakat: "بلا حرکات",
  spelling_check: "املا",
  paraphrase: "تفہیم",
  summarize: "خلاصہ",
  citations: "حوالہ جات",
  normalize_script: "رسم الخط",
  formalize: "رسمی",
  humanize: "سلیس",
  shorten: "مختصر",
};

export const FloatingBubbleMenu: React.FC<FloatingBubbleMenuProps> = ({
  editor,
  actions,
  aiBusy,
  onOpenMobileSheet,
  isMobile = false,
}) => {
  const [pos, setPos] = useState<{ top: number; left: number; text: string; below: boolean } | null>(null);
  const workspace = useOptionalWorkspace();

  const updatePos = useCallback(() => {
    if (!editor) {
      setPos(null);
      return;
    }
    const { from, to, empty } = editor.state.selection;
    if (empty || to <= from) {
      setPos((prev) => (prev === null ? prev : null));
      return;
    }
    const text = editor.state.doc.textBetween(from, to, "\n");
    if (!text.trim()) {
      setPos((prev) => (prev === null ? prev : null));
      return;
    }

    const dom = editor.view.dom;
    const container = dom.closest(".relative") || dom.parentElement;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);

    // Flip below the selection when there is not enough room above, otherwise
    // the panel's `overflow-hidden` clips the bar (same rule as the M2 bar).
    const above = Math.min(start.top, end.top) - rect.top - 44;
    const below = above < 8;
    const top = below ? Math.max(start.bottom, end.bottom) - rect.top + 8 : above;
    // Keep the (centre-anchored) bar inside the panel — it must not drift off
    // the edge when the Canvas column is at its 480px minimum, in LTR or RTL.
    const rawLeft = (start.left + end.left) / 2 - rect.left;
    const left = Math.min(Math.max(rawLeft, 24), Math.max(24, rect.width - 24));

    setPos((prev) => {
      // `transaction` fires on every keystroke; returning the previous object
      // when nothing moved keeps the editor from re-rendering as the user types.
      if (prev && prev.text === text && prev.below === below
        && Math.abs(prev.top - top) < 1 && Math.abs(prev.left - left) < 1) {
        return prev;
      }
      return { top: Math.max(0, top), left, text, below };
    });
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.on("selectionUpdate", updatePos);
    editor.on("transaction", updatePos);
    return () => {
      editor.off("selectionUpdate", updatePos);
      editor.off("transaction", updatePos);
    };
  }, [editor, updatePos]);

  if (!editor || !pos) return null;

  // Touch layout: one pill, which opens the bottom sheet (FR-3.4).
  if (isMobile && onOpenMobileSheet) {
    return (
      <div
        data-testid="floating-bubble-menu"
        style={{
          position: "absolute",
          top: `${pos.top}px`,
          left: `${pos.left}px`,
          transform: "translateX(-50%)",
        }}
        className="z-40"
        onMouseDown={(e) => e.preventDefault()}
      >
        <Button
          size="sm"
          className="h-9 px-3 text-xs gap-1.5 rounded-full shadow-lg"
          onClick={() => onOpenMobileSheet(pos.text)}
          aria-label="منتخب متن پر AI اعمال کھولیں"
        >
          <Sparkles className="h-4 w-4" />
          AI
        </Button>
      </div>
    );
  }

  // Filter tasks allowed on the bubble surface (auto_format is strictly excluded per FR-2.3)
  const bubbleTasks = getTasksForSurface("bubble");

  const getActionHandler = (taskSlug: string): (() => void) | undefined => {
    switch (taskSlug) {
      case "add_harakat": return actions.onAddHarakat;
      case "remove_harakat": return actions.onRemoveHarakat;
      case "spelling_check": return actions.onSpellCheck;
      case "paraphrase": return actions.onParaphrase;
      case "summarize": return actions.onSummarize;
      case "citations": return actions.onCitations;
      case "normalize_script": return actions.onNormalizeScript;
      case "formalize": return actions.onFormalize;
      case "humanize": return actions.onHumanize;
      case "shorten": return actions.onShorten;
      default: return undefined;
    }
  };

  return (
    <div
      data-testid="floating-bubble-menu"
      style={{
        position: "absolute",
        top: `${pos.top}px`,
        left: `${pos.left}px`,
        transform: "translateX(-50%)",
      }}
      className="z-40 flex items-center gap-1 p-1.5 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg backdrop-blur-md max-w-2xl overflow-x-auto"
      role="toolbar"
      aria-label="متن کے انتخاب پر دستیاب اعمال"
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Send the selection to the Workbench. Carried over from the M2 selection
          bar (FR-3.3) — this bubble replaces that bar, so it must not be lost. */}
      {workspace && (
        <div className="flex items-center border-e border-border pe-1.5 me-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => workspace.sendSelectionToWorkbench(pos.text)}
            className="h-7 px-2 text-xs gap-1 font-medium text-primary hover:text-primary hover:bg-primary/10"
            aria-label="منتخب متن Workbench میں تحقیق کے لیے بھیجیں"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="truncate max-w-[120px]">Workbench میں تحقیق</span>
          </Button>
        </div>
      )}

      {/* Standard Text Formatting Toggles */}
      <div className="flex items-center gap-0.5 border-e border-border pe-1.5 me-1">
        <Button
          size="sm"
          variant={editor.isActive("bold") ? "secondary" : "ghost"}
          className="h-7 w-7 p-0"
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold"
        >
          <Bold className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant={editor.isActive("italic") ? "secondary" : "ghost"}
          className="h-7 w-7 p-0"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic"
        >
          <Italic className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant={editor.isActive("heading", { level: 1 }) ? "secondary" : "ghost"}
          className="h-7 w-7 p-0"
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          title="Heading 1"
        >
          <Heading1 className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant={editor.isActive("heading", { level: 2 }) ? "secondary" : "ghost"}
          className="h-7 w-7 p-0"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          title="Heading 2"
        >
          <Heading2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant={editor.isActive("blockquote") ? "secondary" : "ghost"}
          className="h-7 w-7 p-0"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          title="Blockquote"
        >
          <Quote className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* AI Task Action Buttons */}
      <div className="flex items-center gap-1">
        {bubbleTasks.map((task: TaskDefinition) => {
          const Icon = TASK_ICONS[task.slug] || Sparkles;
          const handler = getActionHandler(task.slug);
          const isBusy = aiBusy === task.slug;
          const cost = calculateTaskCost(task, pos.text.length);

          if (!handler) return null;

          return (
            <Button
              key={task.slug}
              size="sm"
              variant="ghost"
              disabled={Boolean(aiBusy) || !pos.text.trim()}
              onClick={handler}
              className="h-7 px-2 text-xs flex items-center gap-1.5"
              title={`${task.defaultLabel} (${cost} ٹوکن)`}
              aria-label={`${task.defaultLabel} — تخمینہ ${cost} ٹوکن`}
            >
              {isBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              ) : (
                <Icon className="h-3.5 w-3.5 text-primary" />
              )}
              <span className="truncate max-w-[100px]">
                {TASK_SHORT_LABEL[task.slug] ?? task.defaultLabel}
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
};
