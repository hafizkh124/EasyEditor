import React from "react";
import { FileText, ChevronRight } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { ARTIFACT_ICON } from "./artifactIcons";
import type { ArtifactState } from "../agentArtifactState";

/**
 * Plan §5.2 — the compact timeline reference. One row per artifact; clicking it
 * makes that artifact active on the stage instead of rendering the whole card
 * inline (the clutter this milestone removes).
 */
export const ArtifactChips: React.FC<{
  artifacts: ArtifactState[];
  activeId: string | null;
  onOpen: (id: string) => void;
}> = ({ artifacts, activeId, onOpen }) => {
  const { t } = useLanguage();
  return (
    <div className="space-y-1">
      {artifacts.map((a) => {
        const Icon = ARTIFACT_ICON[a.type] ?? FileText;
        return (
          <button
            key={a.id}
            onClick={() => onOpen(a.id)}
            className={`flex w-full items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs ${a.id === activeId ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted"}`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate text-start">{a.title}</span>
            {a.status === "open" && <span className="shrink-0 text-muted-foreground">{t("artifact.building", "building…")}</span>}
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        );
      })}
    </div>
  );
};
