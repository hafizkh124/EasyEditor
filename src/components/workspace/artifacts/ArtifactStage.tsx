import React, { useEffect, useRef, useState } from "react";
import { FileText, Maximize2, Minimize2, ChevronsDownUp } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { useOptionalSharedAgentRun } from "@/core/workspace/useSharedAgentRun";
import { ARTIFACT_ICON } from "./artifactIcons";
import { ArtifactBody } from "./ArtifactBody";
import { ArtifactToolbar } from "./ArtifactToolbar";
import { ArtifactFullscreen } from "./ArtifactFullscreen";
import type { ArtifactState } from "../agentArtifactState";

/**
 * Plan §5.2 — the artifact stage. Lives in the vertical split below the editor
 * (WorkspaceLayout's nested ResizablePanelGroup). Renders only when there is at
 * least one artifact; a tab strip appears once there are two or more.
 */
export const ArtifactStage: React.FC = () => {
  const { t } = useLanguage();
  const agent = useOptionalSharedAgentRun();
  const ws = useOptionalWorkspace();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState<ArtifactState | null>(null);

  const artifacts = agent?.artifacts ?? [];
  const activeId = agent?.activeArtifactId ?? artifacts[artifacts.length - 1]?.id ?? null;
  const active = artifacts.find((a) => a.id === activeId) ?? artifacts[artifacts.length - 1] ?? null;

  // Plan §3.0 — opening the stage below 1280px auto-collapses the side panel once.
  const collapsedOnce = useRef(false);
  useEffect(() => {
    if (artifacts.length > 0 && !collapsedOnce.current && typeof window !== "undefined" && window.innerWidth < 1280 && ws) {
      collapsedOnce.current = true;
      ws.setActiveRailPanel(null);
    }
  }, [artifacts.length, ws]);

  if (artifacts.length === 0 || !active) return null;

  const Icon = ARTIFACT_ICON[active.type] ?? FileText;

  return (
    <section className="flex h-full min-h-0 flex-col border-t border-border bg-card" role="region" aria-label={t("artifact.stage", "Artifact stage")}>
      <header className="flex items-center gap-1 border-b border-border bg-muted px-2 py-1">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <h2 className="truncate text-xs font-semibold">{active.title}</h2>
        {active.status !== "open" && (
          <span className={`rounded px-1 text-[0.7rem] ${active.status === "final" ? "text-emerald-600" : "text-amber-600"}`}>{active.status}</span>
        )}
        <div className="ms-auto flex items-center gap-0.5">
          <ArtifactToolbar
            artifact={active}
            bodyRef={bodyRef}
            onFullscreen={() => setFullscreen(active)}
            onDismiss={agent?.dismissArtifact ? () => agent.dismissArtifact(active.id) : undefined}
          />
          {ws && (
            <>
              <button
                className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                onClick={() => ws.setStageMaximized(!ws.stageMaximized)}
                title={ws.stageMaximized ? t("artifact.restore", "Restore") : t("artifact.maximize", "Maximize")}
              >
                {ws.stageMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </button>
              <button
                className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                onClick={() => ws.setStageCollapsed(true)}
                title={t("artifact.collapse", "Collapse stage")}
              >
                <ChevronsDownUp className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </header>

      {artifacts.length > 1 && (
        <div className="flex gap-0.5 overflow-x-auto border-b border-border bg-muted/60 px-1 py-0.5">
          {artifacts.map((a) => {
            const TabIcon = ARTIFACT_ICON[a.type] ?? FileText;
            return (
              <button
                key={a.id}
                onClick={() => agent?.setActiveArtifactId(a.id)}
                className={`flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs ${a.id === active.id ? "bg-background font-medium" : "text-muted-foreground hover:bg-background/60"}`}
              >
                <TabIcon className="h-3 w-3" />
                <span className="max-w-[10rem] truncate">{a.title}</span>
              </button>
            );
          })}
        </div>
      )}

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto p-3">
        <ArtifactBody artifact={active} />
      </div>

      <ArtifactFullscreen artifact={fullscreen} onClose={() => setFullscreen(null)} />
    </section>
  );
};
