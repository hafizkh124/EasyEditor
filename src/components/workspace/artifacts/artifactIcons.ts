import { FileText, Table2, ListChecks, ListTree, GitCompare, Captions, ClipboardList, GitFork, UserSquare } from "lucide-react";
import type React from "react";
import type { AgentArtifactType } from "../../../../shared/agent/types";

/** Plan §5.2 — one icon per artifact type, shared by the timeline chip + stage. */
export const ARTIFACT_ICON: Record<AgentArtifactType, React.ComponentType<{ className?: string }>> = {
  document: FileText,
  table: Table2,
  comparison: GitCompare,
  "citation-list": ListChecks,
  outline: ListTree,
  index: ListTree,
  transcript: Captions,
  plan: ClipboardList,
  "sanad-tree": GitFork,
  "matn-diff": GitCompare,
  "narrator-card": UserSquare,
};
