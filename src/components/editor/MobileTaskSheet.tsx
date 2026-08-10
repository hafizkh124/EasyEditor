import React from "react";
import { Search, Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { getTasksForSurface } from "@/lib/tasks/registry";
import { calculateTaskCost } from "@/lib/tasks/cost";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import type { TaskDefinition } from "@/lib/tasks/types";

interface MobileTaskSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedText: string;
  aiBusy: string | null;
  getHandler: (taskSlug: string) => (() => void) | undefined;
}

/**
 * The task list on touch devices (SPEC-M3 FR-3.4).
 *
 * Below 768px the floating bubble is the wrong shape twice over: iOS draws its
 * own selection callout on top of any floating element, and the on-screen
 * keyboard covers the area a popup would occupy. A bottom sheet sidesteps both,
 * and reuses the pattern the mobile Library and Workbench drawers already use.
 */
export const MobileTaskSheet: React.FC<MobileTaskSheetProps> = ({
  open,
  onOpenChange,
  selectedText,
  aiBusy,
  getHandler,
}) => {
  const workspace = useOptionalWorkspace();
  const tasks = getTasksForSurface("bubble");

  const run = (fn?: () => void) => {
    if (!fn) return;
    onOpenChange(false);
    fn();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        // `dvh` + safe-area so the sheet clears the iOS home indicator and does
        // not fight the virtual keyboard (FR-8.4 carried over from M2).
        className="max-h-[70dvh] overflow-y-auto pb-[env(safe-area-inset-bottom)]"
        dir="rtl"
      >
        <SheetHeader className="text-start">
          <SheetTitle className="text-sm flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-primary" />
            منتخب متن پر AI اعمال
          </SheetTitle>
          <SheetDescription className="text-xs">
            منتخب متن پر چلانے کے لیے کوئی عمل منتخب کریں۔
          </SheetDescription>
        </SheetHeader>

        <p className="text-xs text-muted-foreground line-clamp-2 py-2 border-b border-border" dir="auto">
          {selectedText}
        </p>

        <div className="grid grid-cols-2 gap-2 py-3">
          {workspace && (
            <Button
              variant="outline"
              className="col-span-2 h-10 justify-start gap-2 text-xs text-primary"
              onClick={() => run(() => workspace.sendSelectionToWorkbench(selectedText))}
            >
              <Search className="h-4 w-4" />
              Workbench میں تحقیق کریں
            </Button>
          )}

          {tasks.map((task: TaskDefinition) => {
            const handler = getHandler(task.slug);
            if (!handler) return null;
            const cost = calculateTaskCost(task, selectedText.length);
            return (
              <Button
                key={task.slug}
                variant="outline"
                // 40px tall: a comfortable touch target, unlike the 28px
                // desktop buttons.
                className="h-10 justify-start text-xs"
                disabled={Boolean(aiBusy)}
                onClick={() => run(handler)}
                aria-label={`${task.defaultLabel} — تخمینہ ${cost} ٹوکن`}
              >
                <span className="truncate">{task.defaultLabel}</span>
              </Button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default MobileTaskSheet;
