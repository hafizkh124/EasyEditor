import React from "react";
import { FolderTree, Library, History, Settings } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useWorkspace } from "@/core/workspace/WorkspaceContext";
import { isDesktop } from "@/core/backend";
import { cn } from "@/lib/utils";
import type { RailPanel } from "@/core/workspace/usePanelState";

/**
 * Plan §3.1 — the 48px start-edge activity rail. Always visible (the side panel
 * collapses to 0, the rail does not). Icons toggle their panel; JKHSSN is a tab
 * inside مکتبہ, not a rail icon (§3.0).
 */

interface RailItem {
  id: RailPanel;
  icon: React.ComponentType<{ className?: string }>;
  labelKey: string;
  labelFallback: string;
  desktopOnly?: boolean;
}

const ITEMS: RailItem[] = [
  { id: "files", icon: FolderTree, labelKey: "rail.files", labelFallback: "Files", desktopOnly: true },
  { id: "library", icon: Library, labelKey: "rail.library", labelFallback: "Library" },
  { id: "history", icon: History, labelKey: "rail.history", labelFallback: "History" },
  { id: "settings", icon: Settings, labelKey: "rail.settings", labelFallback: "Settings" },
];

export const ActivityRail: React.FC = () => {
  const { t } = useLanguage();
  const { activeRailPanel, toggleRailPanel } = useWorkspace();
  const desktop = isDesktop();

  const items = ITEMS.filter((i) => !i.desktopOnly || desktop);

  return (
    <nav
      aria-label={t("rail.aria_label", "Workspace navigation")}
      className="flex w-12 shrink-0 flex-col items-center gap-1 border-e border-sidebar-border bg-sidebar py-2"
    >
      {items.map(({ id, icon: Icon, labelKey, labelFallback }) => {
        const active = activeRailPanel === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => toggleRailPanel(id)}
            aria-current={active ? "page" : undefined}
            aria-pressed={active}
            title={t(labelKey as never, labelFallback)}
            className={cn(
              "flex h-9 w-9 min-h-touch min-w-touch md:min-h-0 md:min-w-0 items-center justify-center rounded-md transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
            )}
          >
            <Icon className="h-[18px] w-[18px]" />
            <span className="sr-only">{t(labelKey as never, labelFallback)}</span>
          </button>
        );
      })}
    </nav>
  );
};
