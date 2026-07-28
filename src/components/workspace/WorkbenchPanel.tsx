import React from "react";
import { Search, Languages, Layers, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResearchPanel } from "@/components/research/ResearchPanel";
import { TranslatePanel } from "@/components/translate/TranslatePanel";
import { ExtractPanel } from "@/components/extract/ExtractPanel";
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
          className="w-full max-w-xs"
        >
          <TabsList className="grid grid-cols-3 h-7 bg-muted/60 p-0.5">
            <TabsTrigger value="research" className="text-xs h-6 py-0 gap-1">
              <Search className="h-3 w-3" />
              <span>Research</span>
            </TabsTrigger>
            <TabsTrigger value="translate" className="text-xs h-6 py-0 gap-1">
              <Languages className="h-3 w-3" />
              <span>Translate</span>
            </TabsTrigger>
            <TabsTrigger value="extract" className="text-xs h-6 py-0 gap-1">
              <Layers className="h-3 w-3" />
              <span>Extract</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0 ms-2"
          onClick={() => setWorkbenchOpen(false)}
          title="Close Workbench"
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
      </div>
    </div>
  );
};
