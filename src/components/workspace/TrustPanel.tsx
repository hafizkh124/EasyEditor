import React, { useState } from "react";
import { ListChecks, ShieldCheck } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TasksTab } from "./TasksTab";
import { TrustTab } from "./TrustTab";
import { useLanguage } from "@/contexts/LanguageContext";

/**
 * M10 Phase 3 §3.6 — "Trust": the AI Task Library (TasksTab — the catalogue
 * of what the editor can do, and where custom tasks are authored) and the
 * run-history/audit trail (TrustTab) merged into one Workbench tab via an
 * inner segmented control. TasksTab's own header comment already says "run
 * history lives in the Trust tab; this tab is deliberately not a second
 * copy" — so this only changes HOW the two are switched between, not what
 * either one does. Both stay mounted (hidden via CSS) so switching sub-views
 * never loses TasksTab's in-progress custom-task draft.
 */
export const TrustPanel: React.FC = () => {
  const { t } = useLanguage();
  const [view, setView] = useState<"trust" | "tasks">("trust");

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-2 shrink-0">
        <Tabs value={view} onValueChange={(v) => setView(v as "trust" | "tasks")}>
          <TabsList className="grid grid-cols-2 h-9 bg-muted p-0.5">
            <TabsTrigger value="trust" className="text-xs gap-1.5 py-0 h-full">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-success" />
              {t("workbench.trust", "Trust")}
            </TabsTrigger>
            <TabsTrigger value="tasks" className="text-xs gap-1.5 py-0 h-full">
              <ListChecks className="h-3.5 w-3.5 shrink-0" />
              {t("workbench.tasks", "Tasks")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 min-h-0 relative">
        <div className={`h-full ${view === "trust" ? "block" : "hidden"}`}>
          <TrustTab />
        </div>
        <div className={`h-full ${view === "tasks" ? "block" : "hidden"}`}>
          <TasksTab />
        </div>
      </div>
    </div>
  );
};
