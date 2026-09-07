import { useState, useEffect } from "react";
import { FileInput } from "lucide-react";
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
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { markdownToHtml } from "@/lib/editor/htmlText";
import type { ResearchAssistMode } from "@/lib/prompts";
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
 * SPEC M10 §1.1 — the اسلامی/عمومی mode switch is gone. Every query now goes
 * through islamic-search, which derives strictness itself from what it
 * actually retrieves (see useResearchChat's runQuery). There is therefore no
 * more mode to persist, switch, or confirm-before-discarding — this file
 * used to own all three (`research_mode`, `handleModeChange`, the
 * mode-switch AlertDialog); none of that is needed anymore.
 */
export const ResearchPanel = () => {
  const { user, session } = useAuth();
  const { t } = useLanguage();
  const { subscription, refetch } = useSubscription();
  const tier = subscription?.tier ?? "free";

  const workspaceCtx = useOptionalWorkspace();

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

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <div className="border-b border-border bg-background px-3 py-2">
        <div className="flex items-center justify-end gap-2 max-w-full">
          {canInsertIntoCanvas && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleInsertIntoCanvas}
              className="h-7 text-xs gap-1 px-2 shrink-0"
            >
              <FileInput className="h-3.5 w-3.5" />
              <span>Canvas میں داخل کریں</span>
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
