import React, { useRef } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold, Italic, Heading1, Heading2, Quote, Search, Sparkles, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTasksForSurface } from "@/lib/tasks/registry";
import { calculateTaskCost } from "@/lib/tasks/cost";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import type { TaskDefinition } from "@/lib/tasks/types";
import type { SelectionBarActions } from "./useEditorAiActions";
import { TASK_ICONS, TASK_SHORT_LABEL, getActionHandler } from "./bubbleMenuTasks";
import { useBubblePlacement } from "./useBubblePlacement";

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

/**
 * Selection toolbar, laid out in two rows like the one in Word: formatting and
 * "research this" on top, AI tasks underneath.
 *
 * It used to be a single row of ~16 controls that overflowed into a horizontal
 * scrollbar, so most of the AI actions were reachable only by scrolling a
 * floating element. Two rows trade a little width for a height the user can
 * take in at a glance, and both rows wrap, so a narrow Canvas column reflows
 * instead of clipping. Placement is measured and clamped in
 * `useBubblePlacement` so the bar cannot leave the editor area.
 */
export const FloatingBubbleMenu: React.FC<FloatingBubbleMenuProps> = ({
  editor,
  actions,
  aiBusy,
  onOpenMobileSheet,
  isMobile = false,
}) => {
  const barRef = useRef<HTMLDivElement>(null);
  const workspace = useOptionalWorkspace();
  const pos = useBubblePlacement(editor, barRef);

  if (!editor || !pos) return null;

  // Touch layout: one pill, which opens the bottom sheet (FR-3.4).
  if (isMobile && onOpenMobileSheet) {
    return (
      <div
        ref={barRef}
        data-testid="floating-bubble-menu"
        style={{ position: "absolute", top: `${pos.top}px`, left: `${pos.left}px` }}
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

  // auto_format is strictly excluded from this surface per FR-2.3.
  const bubbleTasks = getTasksForSurface("bubble");

  const formatButtons = [
    { key: "bold", icon: Bold, title: "Bold", active: editor.isActive("bold"), run: () => editor.chain().focus().toggleBold().run() },
    { key: "italic", icon: Italic, title: "Italic", active: editor.isActive("italic"), run: () => editor.chain().focus().toggleItalic().run() },
    { key: "h1", icon: Heading1, title: "Heading 1", active: editor.isActive("heading", { level: 1 }), run: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { key: "h2", icon: Heading2, title: "Heading 2", active: editor.isActive("heading", { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { key: "quote", icon: Quote, title: "Blockquote", active: editor.isActive("blockquote"), run: () => editor.chain().focus().toggleBlockquote().run() },
  ];

  return (
    <div
      ref={barRef}
      data-testid="floating-bubble-menu"
      style={{
        position: "absolute",
        top: `${pos.top}px`,
        left: `${pos.left}px`,
        // Never wider than the editor area — this is what makes the rows wrap
        // instead of pushing the bar off the edge on a narrow Canvas.
        maxWidth: `${Math.max(200, pos.containerW - 16)}px`,
      }}
      className="z-40 flex flex-col gap-1 p-1.5 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg backdrop-blur-md"
      role="toolbar"
      aria-label="متن کے انتخاب پر دستیاب اعمال"
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Row 1 — formatting, and sending the selection to the Workbench.
          The Workbench action is carried over from the M2 selection bar
          (FR-3.3); this bubble replaced that bar, so it must not be lost. */}
      <div className="flex items-center gap-0.5 flex-wrap">
        {formatButtons.map(({ key, icon: Icon, title, active, run }) => (
          <Button
            key={key}
            size="sm"
            variant={active ? "secondary" : "ghost"}
            className="h-7 w-7 p-0 shrink-0 min-h-touch min-w-touch md:min-h-0 md:min-w-0"
            onClick={run}
            title={title}
            aria-label={title}
            aria-pressed={active}
          >
            <Icon className="h-3.5 w-3.5" />
          </Button>
        ))}

        {workspace && (
          <>
            <span className="mx-1 h-5 w-px bg-border shrink-0" aria-hidden="true" />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => workspace.sendSelectionToWorkbench(pos.text)}
              className="h-7 px-2 text-xs gap-1 font-medium text-primary hover:text-primary hover:bg-primary/10 shrink-0"
              aria-label="منتخب متن Workbench میں تحقیق کے لیے بھیجیں"
            >
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate max-w-[170px]">Workbench میں تحقیق</span>
            </Button>
          </>
        )}
      </div>

      {/* Row 2 — AI tasks. Wraps to further rows only when the column is too
          narrow to fit them, rather than overflowing into a scrollbar. */}
      <div className="flex items-center gap-0.5 flex-wrap border-t border-border/60 pt-1">
        {bubbleTasks.map((task: TaskDefinition) => {
          const Icon = TASK_ICONS[task.slug] || Sparkles;
          const handler = getActionHandler(actions, task.slug);
          if (!handler) return null;

          const isBusy = aiBusy === task.slug;
          const cost = calculateTaskCost(task, pos.text.length);

          return (
            <Button
              key={task.slug}
              size="sm"
              variant="ghost"
              disabled={Boolean(aiBusy) || !pos.text.trim()}
              onClick={handler}
              className="h-7 px-2 text-xs flex items-center gap-1.5 shrink-0"
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
