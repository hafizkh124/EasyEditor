import { Plus } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { useCreateActions, type CreateAction } from "@/components/layout/useCreateActions";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The "+" create menu (SYSTEM-2026 §2). Both renderings below read the one
 * list from `useCreateActions`, so the sidebar dropdown and the mobile sheet
 * can never offer different things.
 */

/** Tints for the job tiles, matching the v3 designs (audio / image / translation). */
const JOB_TINT: Record<string, string> = {
  transcribe: "bg-info-soft text-info",
  ocr: "bg-warning-soft text-warning",
  "translate.book": "bg-success-soft text-success",
};

/** Desktop/web sidebar: a primary "+ New" button that opens a dropdown. */
export function CreateMenuButton({ collapsed = false }: { collapsed?: boolean }) {
  const { t, direction } = useLanguage();
  const actions = useCreateActions();
  const jobs = actions.filter((a) => a.group === "job");
  const others = actions.filter((a) => a.group === "new");
  const label = t("create.new", "نیا");

  return (
    <DropdownMenu dir={direction}>
      <DropdownMenuTrigger asChild>
        <Button
          className={cn("w-full justify-start gap-2 font-semibold shadow-sm", collapsed && "justify-center px-0")}
          aria-label={collapsed ? label : undefined}
          title={collapsed ? label : undefined}
        >
          <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
          {!collapsed && <span>{label}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-[min(16rem,calc(100vw-2rem))]">
        {jobs.map((action) => (
          <DropdownMenuItem key={action.id} onSelect={action.run} className="min-h-touch cursor-pointer gap-3">
            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", JOB_TINT[action.id] ?? "bg-muted text-muted-foreground")}>
              <action.icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="font-medium">{action.label}</span>
          </DropdownMenuItem>
        ))}
        {jobs.length > 0 && <DropdownMenuSeparator />}
        {others.map((action) => (
          <DropdownMenuItem key={action.id} onSelect={action.run} className="min-h-touch cursor-pointer gap-3">
            <action.icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span>{action.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Mobile: the bottom sheet opened by the tab bar's centred "+" button. */
export function CreateSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useLanguage();
  const actions = useCreateActions();
  const jobs = actions.filter((a) => a.group === "job");
  const others = actions.filter((a) => a.group === "new");

  const run = (action: CreateAction) => {
    onOpenChange(false);
    action.run();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
        <SheetHeader className="mb-3 text-start">
          <SheetTitle className="text-base">{t("create.menu_label", "نیا کام شروع کریں")}</SheetTitle>
        </SheetHeader>
        {jobs.length > 0 && (
          <div className={cn("grid gap-2", jobs.length >= 3 ? "grid-cols-3" : "grid-cols-2")}>
            {jobs.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => run(action)}
                className="flex min-h-touch flex-col items-center gap-2 rounded-xl border border-border bg-card p-3 text-center text-xs font-semibold shadow-xs transition-colors hover:bg-muted"
              >
                <span className={cn("flex h-11 w-11 items-center justify-center rounded-xl", JOB_TINT[action.id] ?? "bg-muted text-muted-foreground")}>
                  <action.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                {action.label}
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {others.map((action) => (
            <Button key={action.id} variant="outline" className="min-h-touch gap-2" onClick={() => run(action)}>
              <action.icon className="h-4 w-4" aria-hidden="true" />
              {action.label}
            </Button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
