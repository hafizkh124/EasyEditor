import { useState, useEffect } from "react";
import { FileInput, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useLimitReached } from "@/hooks/useLimitReached";
import { useCanAfford } from "@/hooks/useTokenBalance";
import { useLanguage } from "@/contexts/LanguageContext";
import { translateStored } from "@/lib/i18n";
import ChatDisplay from "@/components/research/ChatDisplay";
import { useResearchChat } from "@/hooks/useResearchChat";
import { useSharedAgentRun } from "@/core/workspace/useSharedAgentRun";
import { AgentComposer } from "@/components/workspace/AgentComposer";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { markdownToHtml } from "@/lib/editor/htmlText";
import type { ResearchAssistMode } from "@/lib/prompts";
import { sanitizeSelection } from "@/lib/research/sources";
import { isCapabilityAvailable } from "@/core/capabilities/registry";

function usePersistedState<T>(key: string, initial: T, parse: (raw: string) => T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored) return parse(stored);
    } catch { /* ignore */ }
    return initial;
  });
  const update = (v: T) => {
    setValue(v);
    localStorage.setItem(key, typeof v === "string" ? v : JSON.stringify(v));
  };
  return [value, update];
}

/**
 * SPEC M10 §1 — the single Research+Agent surface. Two branches, decided by
 * one thing: is there an open project folder AND is the agent capability
 * available (desktop + VITE_AGENT_MODE, per registry.ts's wb.agent entry —
 * "never" on web until Phase 2 ships a web dispatcher)?
 *
 *   - No (the common case, and always true on web today): exactly what this
 *     file already was — plain research chat over islamic-search, via
 *     useResearchChat + ChatDisplay's own composer. Zero behavior change.
 *   - Yes: the agent branch — AgentComposer (Ask/Plan/Auto, mentions,
 *     playbooks, dictation, drag-drop) wrapping ChatDisplay's `agent_run`
 *     item, exactly the pair AgentPanel.tsx already proved out. "Ask" here
 *     is the agent's own read-only tool loop (can read the open project's
 *     chapters, search the corpus, etc.) — a strictly richer version of
 *     plain research chat, which is exactly the duplication the user asked
 *     to remove ("ایجنٹ کے اندر آسک موڈ سرچ والا کام ہی کرتا ہے").
 *
 * `useAgentRun()` is called unconditionally either way (React's own rule —
 * hooks can't be conditional) — it is web-safe on its own (every IPC call
 * inside it already guards on `window.electronAPI` existing) and idle when
 * no folder is open, so this costs nothing on the common path.
 *
 * §1.1 already removed the اسلامی/عمومی mode switch (see git history) —
 * there is therefore no more mode to persist, switch, or confirm-before-
 * discarding in this file.
 */
export const ResearchPanel = () => {
  const { user, session } = useAuth();
  const { t } = useLanguage();
  const { subscription, refetch } = useSubscription();
  const tier = subscription?.tier ?? "free";

  const workspaceCtx = useOptionalWorkspace();
  const agentHook = useSharedAgentRun();
  // M10 Phase 2.1 — the capability gate (registry.ts, VITE_AGENT_MODE) is
  // shared by both platforms; which run path actually fires is decided by
  // useAgentRun itself (desktop's project folder vs. web's open document).
  const agentAvailable = isCapabilityAvailable("wb.agent")
    && (Boolean(agentHook.projectRoot) || agentHook.webAgentAvailable);

  const {
    used: islamicQueriesUsed,
    limit: islamicQueriesLimit,
  } = useLimitReached("islamic");
  const { canAfford: canAffordIslamic } = useCanAfford("islamic", 1);
  const islamicLimitReached = !canAffordIslamic;

  const {
    used: researchQueriesUsed,
    limit: researchQueriesLimitRaw,
  } = useLimitReached("research");
  const researchQueriesLimit = researchQueriesLimitRaw || 3;
  const { canAfford: canAffordResearch } = useCanAfford("research", 1);
  const researchLimitReached = !canAffordResearch;

  const [assistModes, setAssistModes] = usePersistedState<ResearchAssistMode[]>(
    "research_assist_modes",
    [],
    (raw) => {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((m): m is ResearchAssistMode => m === "spelling" || m === "citations");
    },
  );

  // Source narrowing. Empty = every source, which is the default and what
  // ADR-0002 wanted; the picker only exists to opt OUT of some. Sanitised on
  // read so a stale id from an older build cannot reach the backend (where
  // an unknown domain is silently dropped from the fan-out).
  const [selectedDomains, setSelectedDomains] = usePersistedState<string[]>(
    "research_selected_domains",
    [],
    (raw) => sanitizeSelection(JSON.parse(raw) as unknown),
  );

  // Corpus Atlas finding #7 — restrict citations to rows with real Arabic
  // matn. A query-time modifier, not part of session identity, so it lives
  // in localStorage like the source selection rather than the DB session row.
  const [requireArabicMatn, setRequireArabicMatn] = usePersistedState<boolean>(
    "research_require_arabic_matn",
    false,
    (raw) => raw === "true",
  );

  const chat = useResearchChat({
    user,
    session,
    tier,
    selectedDomains,
    requireArabicMatn,
    researchLimitReached,
    islamicLimitReached,
    assistModes,
    refetch,
  });

  // Listen to selection query sent from Canvas
  useEffect(() => {
    if (workspaceCtx?.pendingWorkbenchQuery) {
      chat.setQuery(workspaceCtx.pendingWorkbenchQuery);
      workspaceCtx.clearPendingWorkbenchQuery();
    }
  }, [workspaceCtx?.pendingWorkbenchQuery, chat, workspaceCtx]);

  // Assist modes bill against research quota; every other query now goes
  // through islamic-search, so it bills against that quota (mirrors
  // useResearchChat's own handleSendQuery/handleRegenerate guard).
  const activeLimitReached = assistModes.length > 0 ? researchLimitReached : islamicLimitReached;

  // FR-4.5 — hand the latest answer to the Canvas. Only offered inside the
  // workspace; on the standalone /research page there is no Canvas to insert into.
  const lastAnswer =
    chat.lastAssistantIdx >= 0 ? chat.messages[chat.messages.length - 1 - chat.lastAssistantIdx] : null;
  const canInsertIntoCanvas = Boolean(workspaceCtx && lastAnswer?.content?.trim() && !chat.isQuerying);

  const handleInsertIntoCanvas = () => {
    if (!workspaceCtx || !lastAnswer?.content?.trim()) return;
    workspaceCtx.insertIntoCanvas(markdownToHtml(lastAnswer.content));
    toast.success(t("research.inserted_into_canvas") || translateStored("toast.canvas.inserted"));
  };

  if (agentAvailable) {
    return (
      <AgentComposer agent={agentHook}>
        <ChatDisplay
          // Research-only props ChatDisplay still requires but does not use
          // while `composer` is supplied — see its own doc comment.
          messages={[]}
          query=""
          onQueryChange={() => {}}
          onSendQuery={() => {}}
          isRefining={false}
          lastAssistantIdx={-1}
          onRefine={() => {}}
          onCopyOutput={() => {}}
          onClearChat={() => {}}
          onRegenerate={() => {}}
          researchLimitReached={false}
          chatEndRef={{ current: null }}
          t={t}
          isQuerying={agentHook.running}
          agent={agentHook}
          composer={null}
        />
      </AgentComposer>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <div className="border-b border-border bg-background px-3 py-2">
        <div className="flex items-center justify-end gap-2 max-w-full">
          {/* The agent capability exists on this machine but no project
              folder is open yet — surface the door to it rather than
              silently dropping it now that it no longer has its own
              always-visible tab. Desktop-only button: on web the equivalent
              door is opening a document in the Workspace, not a folder
              picker (agentHook.pf.openFolder is a no-op there). */}
          {isCapabilityAvailable("wb.agent") && agentHook.pf.supported && (
            <Button
              variant="outline"
              size="sm"
              onClick={agentHook.pf.openFolder}
              className="h-7 text-xs gap-1 px-2 shrink-0"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {t("agent.open_folder_hint_short", "پراجیکٹ فولڈر کھولیں — ایجنٹ کی صلاحیات کے لیے")}
            </Button>
          )}
          {canInsertIntoCanvas && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleInsertIntoCanvas}
              className="h-7 text-xs gap-1 px-2 shrink-0"
            >
              <FileInput className="h-3.5 w-3.5" />
              <span>{t("research.insert_into_canvas", "Canvas میں داخل کریں")}</span>
            </Button>
          )}
          {assistModes.length === 0 && islamicQueriesLimit > 0 && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded border whitespace-nowrap ${islamicLimitReached ? "text-destructive border-destructive/40 bg-destructive/5" : "text-muted-foreground border-border bg-muted"}`}>
              {islamicQueriesUsed} / {islamicQueriesLimit}
            </span>
          )}
          {assistModes.length > 0 && (subscription?.research_queries_limit ?? 0) > 0 && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded border whitespace-nowrap ${researchLimitReached ? "text-destructive border-destructive/40 bg-destructive/5" : "text-muted-foreground border-border bg-muted"}`}>
              {researchQueriesUsed} / {researchQueriesLimit}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row flex-1 min-h-0 overflow-hidden">
        <ChatDisplay
          messages={chat.messages}
          isQuerying={chat.isQuerying}
          query={chat.query}
          onQueryChange={chat.setQuery}
          onSendQuery={chat.handleSendQuery}
          isRefining={chat.isRefining}
          lastAssistantIdx={chat.lastAssistantIdx}
          onRefine={chat.handleRefine}
          onCopyOutput={chat.handleCopyOutput}
          onClearChat={chat.handleNewChat}
          onRegenerate={chat.handleRegenerate}
          researchLimitReached={activeLimitReached}
          isSignedIn={!!session}
          chatEndRef={chat.chatEndRef}
          t={t}
          sourcesReadyInfo={chat.sourcesReadyInfo}
          citations={chat.citations}
          assistModes={assistModes}
          onAssistModesChange={setAssistModes}
          selectedDomains={selectedDomains}
          onSelectedDomainsChange={setSelectedDomains}
          requireArabicMatn={requireArabicMatn}
          onRequireArabicMatnChange={setRequireArabicMatn}
          onContinue={chat.handleContinue}
        />
      </div>
    </div>
  );
};
