import React, { useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/core/workspace/WorkspaceContext";
import type { RailPanel } from "@/core/workspace/usePanelState";
import { LibraryPanel } from "@/components/workspace/LibraryPanel";
import { FilesPanel } from "./FilesPanel";
import { HistoryPanel } from "./HistoryPanel";
import { WorkspaceSettingsPanel } from "./WorkspaceSettingsPanel";
import { FolderIndexPanel } from "./FolderIndexPanel";

/**
 * Plan §3.1 — renders exactly one rail panel. The Library panel is kept mounted
 * (it holds async Shamela state that is slow to rebuild); the others mount on
 * demand — they are cheap and their own hooks re-fetch on open.
 */
interface SidePanelHostProps {
  /** Inside the mobile drawer, `LibraryPanel` must stay expanded. */
  forceExpanded?: boolean;
  /** Mobile drawer: the activity rail (the only panel switcher) is hidden
   *  there, so the drawer pins itself to one panel instead of following a
   *  persisted `activeRailPanel` that may be null or point elsewhere. */
  forcePanel?: RailPanel;
  onNavigate?: () => void;
  activeDocumentWordCount?: number | null;
}

export const SidePanelHost: React.FC<SidePanelHostProps> = ({ forceExpanded, forcePanel, onNavigate, activeDocumentWordCount }) => {
  const { t } = useLanguage();
  const { activeRailPanel: persistedPanel } = useWorkspace();
  // The mobile drawer has no activity rail, so it carries its own switch
  // between the folder index and the library, starting on `forcePanel`.
  const [drawerPanel, setDrawerPanel] = useState<RailPanel | undefined>(forcePanel);
  const activeRailPanel = (forcePanel ? drawerPanel : undefined) ?? persistedPanel;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {forcePanel && (
        <div role="tablist" className="grid shrink-0 grid-cols-2 gap-1 border-b border-border p-1.5">
          {(["folder", "library"] as const).map((panel) => (
            <button
              key={panel}
              type="button"
              role="tab"
              aria-selected={activeRailPanel === panel}
              onClick={() => setDrawerPanel(panel)}
              className={cn(
                "min-h-touch rounded-md text-sm transition-colors",
                activeRailPanel === panel ? "bg-accent font-semibold text-accent-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {panel === "folder" ? t("folderindex.title", "اس فولڈر میں") : t("rail.library", "Library")}
            </button>
          ))}
        </div>
      )}
      {activeRailPanel === "folder" && <FolderIndexPanel onNavigate={onNavigate} />}
      <div className={activeRailPanel === "library" ? "flex h-full min-h-0 flex-col" : "hidden"}>
        <LibraryPanel forceExpanded={forceExpanded} onNavigate={onNavigate} activeDocumentWordCount={activeDocumentWordCount} />
      </div>
      {activeRailPanel === "files" && <FilesPanel />}
      {activeRailPanel === "history" && <HistoryPanel />}
      {activeRailPanel === "settings" && <WorkspaceSettingsPanel />}
    </div>
  );
};
