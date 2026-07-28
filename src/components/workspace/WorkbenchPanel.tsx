import React from "react";
import { Search, Languages, Layers, ListChecks, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResearchPanel } from "@/components/research/ResearchPanel";
import { TranslatePanel } from "@/components/translate/TranslatePanel";
import { ExtractPanel } from "@/components/extract/ExtractPanel";
import { TasksTab } from "./TasksTab";
import { TrustTab } from "./TrustTab";
import { useWorkspace } from "@/core/workspace/WorkspaceContext";
import { type WorkbenchTab } from "@/core/workspace/usePanelState";

interface WorkbenchPanelProps {
  /**
   * Set by the mobile drawer, which hides the panel by sliding it off-screen
   * and so must not also have it removed from the layout.
   */
  alwaysVisible?: boolean;
}

export const WorkbenchPanel: React.FC<WorkbenchPanelProps> = ({ alwaysVisible = false }) => {
  const { workbenchCollapsed, setWorkbenchOpen, workbenchTab, setWorkbenchTab } = useWorkspace();
  const hidden = workbenchCollapsed && !alwaysVisible;
  // Tasks + Trust are both Pillar A/C surfaces, so they ride the flag SPEC-M3
  // §4.3 defines. (An extra `VITE_TRUST_UI` flag would be a fourth, undocumented
  // switch that `.env.example` never mentions.)
  const showTaskTabs = import.meta.env.VITE_TASK_LIBRARY !== "false";

  return (
    <div
      className={`flex flex-col h-full bg-background border-s border-border overflow-hidden select-none transition-all ${
        hidden ? "hidden" : "w-full"
      }`}
      aria-expanded={!workbenchCollapsed}
    >
      {/* Workbench Top Bar & Tab Selector */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0 bg-card">
        <Tabs
          value={workbenchTab}
          onValueChange={(val) => setWorkbenchTab(val as WorkbenchTab)}
          className="w-full max-w-sm"
        >
          {/* Five text labels do not fit the Workbench at its 320px minimum, so
              the five-tab layout is icon-only with accessible names (R6/NFR-4). */}
          <TabsList className={`grid ${showTaskTabs ? "grid-cols-5" : "grid-cols-3"} h-7 bg-muted/60 p-0.5`}>
            <TabsTrigger value="research" className="text-[11px] h-6 py-0 gap-1 px-1" title="Research" aria-label="Research">
              <Search className="h-3 w-3 shrink-0" />
              {!showTaskTabs && <span className="truncate">Research</span>}
            </TabsTrigger>
            <TabsTrigger value="translate" className="text-[11px] h-6 py-0 gap-1 px-1" title="Translate" aria-label="Translate">
              <Languages className="h-3 w-3 shrink-0" />
              {!showTaskTabs && <span className="truncate">Translate</span>}
            </TabsTrigger>
            <TabsTrigger value="extract" className="text-[11px] h-6 py-0 gap-1 px-1" title="Extract" aria-label="Extract">
              <Layers className="h-3 w-3 shrink-0" />
              {!showTaskTabs && <span className="truncate">Extract</span>}
            </TabsTrigger>

            {showTaskTabs && (
              <>
                <TabsTrigger value="tasks" className="text-[11px] h-6 py-0 gap-1 px-1" title="Tasks" aria-label="Tasks">
                  <ListChecks className="h-3 w-3 shrink-0" />
                </TabsTrigger>
                <TabsTrigger value="trust" className="text-[11px] h-6 py-0 gap-1 px-1" title="Trust" aria-label="Trust">
                  <ShieldCheck className="h-3 w-3 shrink-0 text-emerald-600" />
                </TabsTrigger>
              </>
            )}
          </TabsList>
        </Tabs>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0 ms-2"
          onClick={() => setWorkbenchOpen(false)}
          title="Close Workbench"
          aria-label="Close Workbench"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Tab Panels — render active tab while keeping mounted */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <div className={`h-full ${workbenchTab === "research" ? "block" : "hidden"}`}>
          <ResearchPanel />
        </div>
        <div className={`h-full ${workbenchTab === "translate" ? "block" : "hidden"}`}>
          <TranslatePanel />
        </div>
        <div className={`h-full ${workbenchTab === "extract" ? "block" : "hidden"}`}>
          <ExtractPanel />
        </div>
        {showTaskTabs && (
          <>
            <div className={`h-full ${workbenchTab === "tasks" ? "block" : "hidden"}`}>
              <TasksTab />
            </div>
            <div className={`h-full ${workbenchTab === "trust" ? "block" : "hidden"}`}>
              <TrustTab />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
