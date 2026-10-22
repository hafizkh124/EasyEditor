import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLimitReached } from "@/hooks/useLimitReached";
import { useCanAfford } from "@/hooks/useTokenBalance";
import { useLanguage } from "@/contexts/LanguageContext";
import ChatDisplay from "@/components/research/ChatDisplay";
import { useSharedAgentRun } from "@/core/workspace/useSharedAgentRun";
import { AgentComposer } from "@/components/workspace/AgentComposer";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { sanitizeSelection } from "@/lib/research/sources";

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
 * M11 — the single Research+Agent surface: the AgentComposer (Ask/Plan/Auto)
 * wrapping ChatDisplay's `agent_run` timeline, always. There is no more
 * separate plain-chat fallback — the branch that used to render
 * `useResearchChat` + ChatDisplay's own composer when no project folder/
 * document was open is gone. Ask mode is a strict superset of that old
 * streaming chat (same corpus, plus every connector — Shamela, Dorar,
 * Rijāl, lexicon, تفسیر, جوامع الكلم, Ganjoor, Urdu prosody, general web,
 * repositories — none of which the old plain-chat path could ever reach),
 * and now runs with nothing open too (`useAgentRun.ts`'s `send()`), so
 * there is nothing left for the fallback to offer that Ask doesn't already
 * do. Plan/Auto still need a target to write into; `AgentComposer` disables
 * those two mode buttons with an explanatory hint until one is open.
 *
 * `useAgentRun()` (via `useSharedAgentRun`) is web-safe on its own — every
 * IPC call inside it already guards on `window.electronAPI` existing.
 */
export const ResearchPanel = () => {
  const { session } = useAuth();
  const { t } = useLanguage();

  const workspaceCtx = useOptionalWorkspace();
  const agentHook = useSharedAgentRun();

  // The free-tier search quota — UX consistency with the old plain-chat
  // badge/warning, not a security gate (the server already meters every
  // search server-side regardless of which UI reached it).
  const {
    used: islamicQueriesUsed,
    limit: islamicQueriesLimit,
  } = useLimitReached("islamic");
  const { canAfford: canAffordIslamic } = useCanAfford("islamic", 1);
  const islamicLimitReached = !canAffordIslamic;

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

  // Listen to a selection query sent from the Canvas.
  useEffect(() => {
    if (workspaceCtx?.pendingWorkbenchQuery) {
      const text = workspaceCtx.pendingWorkbenchQuery;
      agentHook.updateInput(text, text.length);
      workspaceCtx.clearPendingWorkbenchQuery();
    }
  }, [workspaceCtx?.pendingWorkbenchQuery, agentHook, workspaceCtx]);

  // A prompt skill picked in `Ctrl+K` opens its details dialog here.
  useEffect(() => {
    if (workspaceCtx?.pendingSkillPrompt) {
      agentHook.requestSkillPrompt(workspaceCtx.pendingSkillPrompt);
      workspaceCtx.clearPendingSkillPrompt();
    }
  }, [workspaceCtx?.pendingSkillPrompt, agentHook, workspaceCtx]);

  return (
    <AgentComposer
      agent={agentHook}
      islamicLimitReached={islamicLimitReached}
      islamicQueriesUsed={islamicQueriesUsed}
      islamicQueriesLimit={islamicQueriesLimit}
      isSignedIn={!!session}
      selectedDomains={selectedDomains}
      onSelectedDomainsChange={setSelectedDomains}
      requireArabicMatn={requireArabicMatn}
      onRequireArabicMatnChange={setRequireArabicMatn}
    >
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
        onClearChat={agentHook.clearConversation}
        onRegenerate={() => {}}
        researchLimitReached={false}
        chatEndRef={{ current: null }}
        t={t}
        isQuerying={agentHook.running}
        agent={agentHook}
        onSuggestionSelect={(text) => {
          agentHook.updateInput(text, text.length);
          requestAnimationFrame(() => agentHook.taRef.current?.focus());
        }}
        composer={null}
      />
    </AgentComposer>
  );
};
