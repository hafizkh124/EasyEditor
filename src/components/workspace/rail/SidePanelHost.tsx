import React from "react";
import { useWorkspace } from "@/core/workspace/WorkspaceContext";
import { LibraryPanel } from "@/components/workspace/LibraryPanel";
import { FilesPanel } from "./FilesPanel";
import { HistoryPanel } from "./HistoryPanel";
import { WorkspaceSettingsPanel } from "./WorkspaceSettingsPanel";

/**
 * Plan §3.1 — renders exactly one rail panel. The Library panel is kept mounted
 * (it holds async Shamela state that is slow to rebuild); the others mount on
 * demand — they are cheap and their own hooks re-fetch on open.
 */
interface SidePanelHostProps {
  /** Inside the mobile drawer, `LibraryPanel` must stay expanded. */
  forceExpanded?: boolean;
  onNavigate?: () => void;
  activeDocumentWordCount?: number | null;
}

export const SidePanelHost: React.FC<SidePanelHostProps> = ({ forceExpanded, onNavigate, activeDocumentWordCount }) => {
  const { activeRailPanel } = useWorkspace();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={activeRailPanel === "library" ? "flex h-full min-h-0 flex-col" : "hidden"}>
        <LibraryPanel forceExpanded={forceExpanded} onNavigate={onNavigate} activeDocumentWordCount={activeDocumentWordCount} />
      </div>
      {activeRailPanel === "files" && <FilesPanel />}
      {activeRailPanel === "history" && <HistoryPanel />}
      {activeRailPanel === "settings" && <WorkspaceSettingsPanel />}
    </div>
  );
};
