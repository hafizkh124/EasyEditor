import { useCallback, useMemo, useRef } from "react";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { createWebDispatcher, type WebAgentSession } from "@/core/agent/webDispatch";
import { webAgentModel } from "@/core/agent/webModel";
import { runAgentLoop } from "~shared/agent/loop";
import { buildHistory, type ConversationTurn } from "~shared/agent/history";
import { toolsFor } from "~shared/agent/toolScoping";
import { buildWebSystemPrompt } from "~shared/agent/systemPrompt";
import { classifyIntent, negativeConstraintBlock } from "~shared/agent/intent";
import { CONNECTORS } from "~shared/agent/connectors";
import type { AgentMode, AgentProgress, AgentRunResult } from "~shared/agent/types";

const PLAN_APPROVAL_TIMEOUT_MS = 10 * 60_000; // mirrors electron/agent/planApproval.ts

/**
 * M10 Phase 2.1 — the web agent's run engine, the counterpart of what
 * `window.electronAPI.agent` (main-process IPC) gives desktop's
 * `useAgentRun`. No IPC here: `createWebDispatcher` + `webAgentModel` +
 * `runAgentLoop` all run directly in this same renderer, so plan-approval and
 * cancellation are plain in-memory refs instead of a request/resolve IPC
 * round trip (electron/agent/planApproval.ts's pattern, without the channel).
 *
 * Deliberately a separate hook rather than inlined into useAgentRun.ts: it
 * has its own lifecycle (one dispatcher session per run, its own cancel/
 * approval refs) and is independently testable without desktop's
 * window.electronAPI surface at all.
 */
export function useWebAgentEngine() {
  const ws = useOptionalWorkspace();
  const hasElectronAgent = typeof window !== "undefined" && Boolean(window.electronAPI?.agent);
  const activeDocumentId = ws?.activeDocumentId ?? null;

  /** Only meaningful when desktop's own agent IPC is absent — never double-run. */
  const available = !hasElectronAgent && Boolean(activeDocumentId);

  const cancelledRef = useRef(false);
  const approvalRef = useRef<((decision: "approved" | "rejected") => void) | null>(null);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  const decidePlan = useCallback((decision: "approved" | "rejected") => {
    approvalRef.current?.(decision);
    approvalRef.current = null;
  }, []);

  const run = useCallback(
    async (
      instruction: string,
      mode: AgentMode,
      onProgress: (p: AgentProgress) => void,
      // Plan §4.5 — the `#` scope. Web mirrors `books` for search_corpus only
      // (batch mode and Shamela/JKHSSN scoping are desktop-agent flows).
      scope?: { books?: string[] },
      // M11 Phase 1 — the conversation so far, so a follow-up has the thread.
      history?: ConversationTurn[],
    ): Promise<AgentRunResult> => {
      cancelledRef.current = false;
      approvalRef.current = null;

      const session: WebAgentSession = {
        activeDocumentId,
        insertIntoCanvas: ws?.insertIntoCanvas ?? null,
        emitArtifact: (ev) => onProgress({ kind: "artifact", artifact: ev }),
        model: webAgentModel,
        isCancelled: () => cancelledRef.current,
        bookScope: scope?.books?.length ? scope.books : undefined,
      };
      const { dispatch } = createWebDispatcher(session);

      // Plan mode — the SAME two progress events electron/agent/planApproval.ts
      // sends the renderer (open the plan artifact, then its text), just
      // emitted directly instead of over IPC — ChatDisplay's agent_run item
      // already renders both a live "plan-pending" progress line and the plan
      // artifact from these exact events.
      const waitForApproval = mode === "plan"
        ? (plan: { steps: string[]; summary: string }): Promise<"approved" | "rejected"> =>
          new Promise((resolve) => {
            const artifactId = "plan-web";
            const settle = (decision: "approved" | "rejected") => {
              clearTimeout(timer);
              resolve(decision);
            };
            const timer = setTimeout(() => {
              if (approvalRef.current === settle) approvalRef.current = null;
              resolve("rejected");
            }, PLAN_APPROVAL_TIMEOUT_MS);
            approvalRef.current = settle;
            onProgress({
              kind: "plan-pending", label: "review the plan and approve it to continue",
              labelKey: "agent.step.plan_pending",
              artifact: { op: "open", artifactId, title: "Proposed plan", artifactType: "plan" },
            });
            onProgress({
              kind: "plan-pending",
              artifact: {
                op: "delta", artifactId, mode: "replace",
                text: `${plan.summary}\n\n${plan.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
              },
            });
          })
        : undefined;

      // ADR-0038 — Level-1 (heuristic only) intent gating on web. No per-project
      // connector switches here yet, so every connector counts as "on".
      const intent = classifyIntent(instruction, { connectorsOn: CONNECTORS.map((c) => c.id) });
      const gateConnectors = intent.route.kind === "gated"
        ? intent.route.connectors
        : intent.route.kind === "direct"
          ? []
          : undefined;
      const tools = toolsFor(mode, { platform: "web", ask: instruction, gateConnectors });
      const systemPrompt = buildWebSystemPrompt({ mode, toolGating: negativeConstraintBlock(intent.route) });

      return runAgentLoop(instruction, webAgentModel, dispatch, systemPrompt, {
        mode, tools, onProgress, waitForApproval,
        isCancelled: () => cancelledRef.current,
        history: history?.length ? buildHistory(history) : undefined,
      });
    },
    [activeDocumentId, ws],
  );

  return useMemo(() => ({ available, run, cancel, decidePlan }), [available, run, cancel, decidePlan]);
}
