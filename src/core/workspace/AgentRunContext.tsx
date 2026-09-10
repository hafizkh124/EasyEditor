import React, { createContext } from "react";
import { useAgentRun } from "@/hooks/useAgentRun";

/**
 * Plan §3.1 — one shared `useAgentRun()` instance for the whole Workspace.
 *
 * `useAgentRun` was instantiated inside `ResearchPanel`, so its state (the
 * running turn, the artifact list, the composer scope) was reachable only from
 * there. Phase 4's scope chips + review dialog and Phase 5's artifact stage all
 * need the SAME instance, so it is lifted here and provided once, high in the
 * tree (inside `WorkspaceProvider`, above the panel host and the workbench).
 *
 * Pure lift, no behaviour change: `ResearchPanel` reads `useSharedAgentRun()`
 * instead of calling the hook itself.
 */

export type AgentRunValue = ReturnType<typeof useAgentRun>;

// eslint-disable-next-line react-refresh/only-export-components -- context object, consumed by the sibling hooks module
export const AgentRunContext = createContext<AgentRunValue | null>(null);

export const AgentRunProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const agent = useAgentRun();
  return <AgentRunContext.Provider value={agent}>{children}</AgentRunContext.Provider>;
};
