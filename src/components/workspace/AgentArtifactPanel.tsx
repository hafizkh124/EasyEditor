/**
 * M9 ADR-0024 — the inline artifact surface (fallback path).
 *
 * Plan §5.2 promotes artifacts to a dedicated stage inside the workspace shell;
 * this full-card render stays for surfaces WITHOUT that shell — the standalone
 * /research page and narrow viewports. The body switch itself now lives in
 * `artifacts/ArtifactBody.tsx`, shared with the stage.
 */
import React from "react";
import { FileText } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { ARTIFACT_ICON } from "./artifacts/artifactIcons";
import { ArtifactBody } from "./artifacts/ArtifactBody";
import type { ArtifactState } from "./agentArtifactState";

const AgentArtifactPanel: React.FC<{ artifacts: ArtifactState[] }> = ({ artifacts }) => {
  const { t } = useLanguage();
  return (
    <div className="space-y-2">
      {artifacts.map((a) => {
        const Icon = ARTIFACT_ICON[a.type] ?? FileText;
        return (
          <div key={a.id} className="rounded-md border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-1.5 border-b border-border bg-muted px-2 py-1 text-xs font-medium">
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{a.title}</span>
              {a.status !== "open" && (
                <span className={`ms-auto rounded px-1 text-xs ${a.status === "final" ? "text-success" : "text-warning"}`}>
                  {a.status}
                </span>
              )}
            </div>
            <div className="max-h-64 overflow-y-auto p-2 text-xs">
              <ArtifactBody artifact={a} compact />
            </div>
            {a.targetChapter && a.status === "final" && (
              <div className="border-t border-border px-2 py-1 text-xs text-muted-foreground">
                → {a.targetChapter}
              </div>
            )}
          </div>
        );
      })}
      {artifacts.length === 0 && (
        <p className="p-2 text-xs text-muted-foreground">{t("agent.artifact_none", "No artifacts yet.")}</p>
      )}
    </div>
  );
};

export { AgentArtifactPanel };
export default AgentArtifactPanel;
