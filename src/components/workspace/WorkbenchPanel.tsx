import React from "react";
import { ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResearchPanel } from "@/components/research/ResearchPanel";
import { TranslatePanel } from "@/components/translate/TranslatePanel";
import { StudyPanel } from "./StudyPanel";
import { TrustPanel } from "./TrustPanel";
import { useWorkspace } from "@/core/workspace/WorkspaceContext";
import { type WorkbenchTab } from "@/core/workspace/usePanelState";
import { useLanguage } from "@/contexts/LanguageContext";
import { availableCapabilities, isCapabilityAvailable } from "@/core/capabilities/registry";
import type { Capability, CapabilityId } from "@/core/capabilities/registry";

/** Written out so Tailwind's class scanner can see every value it must emit. */
const GRID_COLS: Record<number, string> = {
  3: "grid-cols-3", 4: "grid-cols-4", 5: "grid-cols-5", 6: "grid-cols-6", 7: "grid-cols-7", 8: "grid-cols-8",
};

/**
 * Translate is a paid cloud edge function, so on desktop the tab goes with it.
 * The remaining tabs simply redistribute across the grid.
 *
 * SPEC M10 §1.2 — wb.agent is deliberately absent here now. The Research
 * pillar's own panel (ResearchPanel.tsx) decides internally whether to show
 * the agent's Ask/Plan/Auto surface (open project folder + capability
 * available) or plain research chat — there is no separate "agent" tab to
 * map a capability onto anymore. isCapabilityAvailable("wb.agent") is still
 * a real, used check; it just no longer drives a tab of its own.
 *
 * SPEC M10 §3.6 — wb.aiReader now maps to "study" (StudyPanel.tsx merges
 * AI Reader + Notes behind an inner segmented control); wb.notes was
 * removed as its own capability entirely, so it has no entry here at all.
 */
const TAB_VALUE_BY_CAPABILITY: Partial<Record<CapabilityId, WorkbenchTab>> = {
  "wb.aiReader": "study",
  "wb.research": "research",
  "wb.translate": "translate",
};

interface WorkbenchPanelProps {
  /**
   * Set by the mobile drawer, which hides the panel by sliding it off-screen
   * and so must not also have it removed from the layout.
   */
  alwaysVisible?: boolean;
}

export const WorkbenchPanel: React.FC<WorkbenchPanelProps> = ({ alwaysVisible = false }) => {
  const { workbenchCollapsed, setWorkbenchOpen, workbenchTab, setWorkbenchTab } = useWorkspace();
  const { t } = useLanguage();
  const hidden = workbenchCollapsed && !alwaysVisible;
  // Tasks + Trust (now one merged "trust" tab, TrustPanel.tsx) are both
  // Pillar A/C surfaces, so they ride the flag SPEC-M3 §4.3 defines. (An
  // extra `VITE_TRUST_UI` flag would be a fourth, undocumented switch that
  // `.env.example` never mentions.)
  const showTaskTabs = import.meta.env.VITE_TASK_LIBRARY !== "false";

  const baseTabs = React.useMemo(
    () =>
      availableCapabilities("workbench-tab")
        .map((capability) => ({ capability, value: TAB_VALUE_BY_CAPABILITY[capability.id] }))
        .filter((entry): entry is { capability: Capability; value: WorkbenchTab } => Boolean(entry.value)),
    [],
  );

  // A tab can become unreachable between sessions — persisted panel state may
  // still name "translate" after the same document is opened on desktop. Without
  // this the Workbench renders a tab strip with no panel under it.
  const activeTabAvailable =
    baseTabs.some((entry) => entry.value === workbenchTab)
    || (showTaskTabs && workbenchTab === "trust");
  React.useEffect(() => {
    if (!activeTabAvailable && baseTabs.length > 0) setWorkbenchTab(baseTabs[0].value);
  }, [activeTabAvailable, baseTabs, setWorkbenchTab]);

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
          {/* The labels do not fit the Workbench at its 320px minimum, so the
              tab layout is icon-only with accessible names (R6/NFR-4) — which
              is exactly why those names must be translated: they are the only
              text a screen reader or a hovering user ever gets. */}
          {/* h-11 (44px, min-h-touch) below md, h-7 once a mouse is the input —
              same split as LibraryPanel's tab strip. Triggers fill via h-full. */}
          <TabsList className={`grid ${GRID_COLS[baseTabs.length + (showTaskTabs ? 1 : 0)]} h-11 md:h-7 bg-muted p-0.5`}>
            {baseTabs.map(({ capability, value }) => {
              const label = t(capability.labelKey, capability.fallbackLabel);
              const Icon = capability.icon;
              return (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="text-xs h-full py-0 gap-1 px-1"
                  title={label}
                  aria-label={label}
                >
                  <Icon className={`h-3 w-3 shrink-0 ${value === "study" ? "text-primary" : ""}`} />
                  {!showTaskTabs && <span className="truncate">{label}</span>}
                </TabsTrigger>
              );
            })}

            {/* M10 Phase 3 §3.6 — Tasks + Trust merged into one "trust" tab
                (TrustPanel.tsx's own inner segmented control switches between
                them); this outer trigger only needs the combined tab's own
                identity, not two. */}
            {showTaskTabs && (
              <TabsTrigger value="trust" className="text-xs h-full py-0 gap-1 px-1" title={t("workbench.trust", "Trust")} aria-label={t("workbench.trust", "Trust")}>
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 min-h-touch min-w-touch md:h-7 md:w-7 md:min-h-0 md:min-w-0 text-muted-foreground hover:text-foreground shrink-0 ms-2"
          onClick={() => setWorkbenchOpen(false)}
          title={t("workbench.close", "Close Workbench")}
          aria-label={t("workbench.close", "Close Workbench")}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Tab Panels — render active tab while keeping mounted */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <div className={`h-full ${workbenchTab === "study" ? "block" : "hidden"}`}>
          <StudyPanel active={workbenchTab === "study"} />
        </div>
        <div className={`h-full ${workbenchTab === "research" ? "block" : "hidden"}`}>
          <ResearchPanel />
        </div>
        {/* These stay mounted-but-hidden on web for tab-switch speed; on desktop
            they must not mount at all, since both reach for cloud edge functions
            on first render. */}
        {isCapabilityAvailable("wb.translate") && (
          <div className={`h-full ${workbenchTab === "translate" ? "block" : "hidden"}`}>
            <TranslatePanel />
          </div>
        )}
        {showTaskTabs && (
          <div className={`h-full ${workbenchTab === "trust" ? "block" : "hidden"}`}>
            <TrustPanel />
          </div>
        )}
      </div>
    </div>
  );
};
