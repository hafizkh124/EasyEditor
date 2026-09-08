import React, { useState } from "react";
import { Sparkles, StickyNote } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AiReaderPanel } from "@/components/reader/AiReaderPanel";
import { NotesPanel } from "@/components/reader/NotesPanel";
import { useLanguage } from "@/contexts/LanguageContext";

interface StudyPanelProps {
  /** True when "study" is the active Workbench tab — forwarded to NotesPanel
   *  only when its own inner sub-view is also showing (see below). */
  active?: boolean;
}

/**
 * M10 Phase 3 §3.6 — "Study": AiReaderPanel (ask the AI about the reader's
 * current page) and NotesPanel (per-book page notes) merged into one
 * Workbench tab via an inner segmented control, cutting the tab strip from
 * 6 tabs to 4. Both stay genuinely separate, independently-scrollable
 * panels — this changes how they're switched between, not what either does.
 *
 * Both sub-views stay mounted (hidden via CSS, not conditional JSX) even
 * when not showing — matching the outer WorkbenchPanel's own "stays mounted
 * so a running answer survives closing it" pattern. AiReaderPanel keeps its
 * chat history in local state with nowhere else to persist it; unmounting
 * on every sub-view switch would silently lose an in-progress conversation.
 */
export const StudyPanel: React.FC<StudyPanelProps> = ({ active = false }) => {
  const { t } = useLanguage();
  const [view, setView] = useState<"aiReader" | "notes">("aiReader");

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-2 shrink-0">
        <Tabs value={view} onValueChange={(v) => setView(v as "aiReader" | "notes")}>
          <TabsList className="grid grid-cols-2 h-9 bg-muted p-0.5">
            <TabsTrigger value="aiReader" className="text-xs gap-1.5 py-0 h-full">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
              {t("workbench.ai_reader", "AI Reader")}
            </TabsTrigger>
            <TabsTrigger value="notes" className="text-xs gap-1.5 py-0 h-full">
              <StickyNote className="h-3.5 w-3.5 shrink-0" />
              {t("workbench.notes", "Notes")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 min-h-0 relative">
        <div className={`h-full ${view === "aiReader" ? "block" : "hidden"}`}>
          <AiReaderPanel />
        </div>
        <div className={`h-full ${view === "notes" ? "block" : "hidden"}`}>
          <NotesPanel active={active && view === "notes"} />
        </div>
      </div>
    </div>
  );
};
