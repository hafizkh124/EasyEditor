import { useState, useEffect } from "react";
import { FileInput } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useLimitReached } from "@/hooks/useLimitReached";
import { useCanAfford } from "@/hooks/useTokenBalance";
import { useLanguage } from "@/contexts/LanguageContext";
import SourcesPanel from "@/components/research/SourcesPanel";
import ChatDisplay from "@/components/research/ChatDisplay";
import ResearchModeSwitcher, { type ResearchMode } from "@/components/research/ResearchModeSwitcher";
import { useResearchSources } from "@/hooks/useResearchSources";
import { useResearchChat } from "@/hooks/useResearchChat";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { textToHtml } from "@/lib/editor/htmlText";
import type { ResearchAssistMode } from "@/lib/prompts";

const DEFAULT_ISLAMIC_DOMAINS = ["dorar", "sunnah", "alquran", "quran-com", "tanzil"];
const DEFAULT_ISLAMIC_LANGUAGES = ["ar", "en"];

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

export const ResearchPanel = () => {
  const { user, session } = useAuth();
  const { t } = useLanguage();
  const { subscription, refetch } = useSubscription();
  const tier = subscription?.tier ?? "free";
  
  const workspaceCtx = useOptionalWorkspace();

  const {
    used: researchQueriesUsed,
    limit: researchQueriesLimitRaw,
  } = useLimitReached("research");
  const researchQueriesLimit = researchQueriesLimitRaw || 3;
  const { canAfford: canAffordResearch } = useCanAfford("research", 1);
  const researchLimitReached = !canAffordResearch;

  const {
    used: islamicQueriesUsed,
    limit: islamicQueriesLimit,
  } = useLimitReached("islamic");
  const { canAfford: canAffordIslamic } = useCanAfford("islamic", 1);
  const islamicLimitReached = !canAffordIslamic;

  const [mode, setMode] = usePersistedState<ResearchMode>(
    "research_mode",
    "islamic",
    (raw) => (raw === "islamic" || raw === "custom" || raw === "general" ? raw : "islamic"),
  );
  const [assistModes, setAssistModes] = usePersistedState<ResearchAssistMode[]>(
    "research_assist_modes",
    [],
    (raw) => {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((m): m is ResearchAssistMode => m === "spelling" || m === "citations");
    },
  );
  const [islamicDomains, setIslamicDomains] = usePersistedState<string[]>(
    "islamic_domains",
    DEFAULT_ISLAMIC_DOMAINS,
    (raw) => JSON.parse(raw) as string[],
  );
  const [islamicLanguages, setIslamicLanguages] = usePersistedState<string[]>(
    "islamic_languages",
    DEFAULT_ISLAMIC_LANGUAGES,
    (raw) => JSON.parse(raw) as string[],
  );
  const [madhhab, setMadhhab] = usePersistedState<string>(
    "research_madhhab",
    "any",
    (raw) => raw,
  );
  const [strictMode, setStrictMode] = useState(true);

  const hookMode: "general" | "islamic" | "custom" = mode;
  const sourcesApi = useResearchSources(user);
  const chat = useResearchChat({
    user,
    session,
    mode: hookMode,
    tier,
    sources: sourcesApi.sources,
    strictMode: mode === "islamic" ? true : mode === "general" ? false : strictMode,
    islamicDomains,
    islamicLanguages,
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

  const [pendingMode, setPendingMode] = useState<ResearchMode | null>(null);

  const handleModeChange = (next: ResearchMode) => {
    if (next === mode) return;
    if (chat.messages.length > 0 || chat.query.trim().length > 0) {
      setPendingMode(next);
      return;
    }
    setMode(next);
  };

  const confirmModeChange = () => {
    if (pendingMode) setMode(pendingMode);
    setPendingMode(null);
  };

  const activeLimitReached = mode === "islamic" ? islamicLimitReached : researchLimitReached;

  // FR-4.5 — hand the latest answer to the Canvas. Only offered inside the
  // workspace; on the standalone /research page there is no Canvas to insert into.
  const lastAnswer =
    chat.lastAssistantIdx >= 0 ? chat.messages[chat.messages.length - 1 - chat.lastAssistantIdx] : null;
  const canInsertIntoCanvas = Boolean(workspaceCtx && lastAnswer?.content?.trim() && !chat.isQuerying);

  const handleInsertIntoCanvas = () => {
    if (!workspaceCtx || !lastAnswer?.content?.trim()) return;
    workspaceCtx.insertIntoCanvas(textToHtml(lastAnswer.content));
    toast.success(t("research.inserted_into_canvas") || "Canvas میں داخل کر دیا گیا");
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <div className="border-b border-border bg-background px-3 py-2">
        <div className="flex items-center justify-between gap-2 max-w-full">
          <ResearchModeSwitcher mode={mode} onModeChange={handleModeChange} t={t} />
          {canInsertIntoCanvas && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleInsertIntoCanvas}
              className="h-7 text-[11px] gap-1 px-2 shrink-0"
            >
              <FileInput className="h-3.5 w-3.5" />
              <span>Canvas میں داخل کریں</span>
            </Button>
          )}
          {mode === "islamic" && islamicQueriesLimit > 0 && (
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded border whitespace-nowrap ${islamicLimitReached ? "text-destructive border-destructive/40 bg-destructive/5" : "text-muted-foreground border-border bg-muted/40"}`}>
              {islamicQueriesUsed} / {islamicQueriesLimit}
            </span>
          )}
          {mode === "general" && (subscription?.research_queries_limit ?? 0) > 0 && (
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded border whitespace-nowrap ${researchLimitReached ? "text-destructive border-destructive/40 bg-destructive/5" : "text-muted-foreground border-border bg-muted/40"}`}>
              {researchQueriesUsed} / {researchQueriesLimit}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row flex-1 min-h-0 overflow-hidden">
        {mode === "custom" && (
          <SourcesPanel
            sources={sourcesApi.sources}
            urlInput={sourcesApi.urlInput}
            onUrlInputChange={sourcesApi.setUrlInput}
            isAddingUrl={sourcesApi.isAddingUrl}
            isUploading={sourcesApi.isUploading}
            fileInputRef={sourcesApi.fileInputRef}
            onAddUrl={sourcesApi.handleAddUrl}
            onFileUpload={sourcesApi.handleFileUpload}
            onFileDrop={sourcesApi.processFile}
            onDeleteSource={sourcesApi.handleDeleteSource}
            onDeleteAllSources={sourcesApi.handleDeleteAllSources}
            strictMode={strictMode}
            onStrictModeChange={setStrictMode}
            researchQueriesUsed={researchQueriesUsed}
            researchQueriesLimit={researchQueriesLimit}
            researchLimitReached={researchLimitReached}
            showUsageMeter={(subscription?.research_queries_limit ?? 0) > 0}
            mode={mode}
            islamicDomains={islamicDomains}
            onIslamicDomainsChange={setIslamicDomains}
            islamicLanguages={islamicLanguages}
            onIslamicLanguagesChange={setIslamicLanguages}
            islamicQueriesUsed={islamicQueriesUsed}
            islamicQueriesLimit={islamicQueriesLimit}
            madhhab={madhhab}
            onMadhhabChange={setMadhhab}
            tier={tier}
            t={t}
          />
        )}
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
          sources={sourcesApi.sources}
          researchLimitReached={activeLimitReached}
          chatEndRef={chat.chatEndRef}
          t={t}
          mode={mode}
          onModeChange={handleModeChange}
          sourcesReadyInfo={chat.sourcesReadyInfo}
          citations={chat.citations}
          assistModes={assistModes}
          onAssistModesChange={setAssistModes}
          onContinue={chat.handleContinue}
        />
      </div>

      <AlertDialog open={pendingMode !== null} onOpenChange={(open) => { if (!open) setPendingMode(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("research.mode_switch_title") || t("common.new_chat")}</AlertDialogTitle>
            <AlertDialogDescription>{t("research.mode_switch_unsaved")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingMode(null)}>{t("common.cancel") || "Cancel"}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmModeChange}>{t("common.confirm") || "Confirm"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
