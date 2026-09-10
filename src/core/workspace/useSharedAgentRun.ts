import { useContext } from "react";
import { AgentRunContext, type AgentRunValue } from "./AgentRunContext";

/** The shared `useAgentRun()` instance (plan §3.1). Throws outside the provider. */
export function useSharedAgentRun(): AgentRunValue {
  const ctx = useContext(AgentRunContext);
  if (!ctx) {
    throw new Error("useSharedAgentRun must be used inside <AgentRunProvider> (WorkspaceLayout mounts it)");
  }
  return ctx;
}

/** Non-throwing variant for surfaces that may render outside the workspace. */
export function useOptionalSharedAgentRun(): AgentRunValue | null {
  return useContext(AgentRunContext);
}
