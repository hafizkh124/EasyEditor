import { useState } from "react";
import { useSeo } from "@/hooks/useSeo";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useLimitReached } from "@/hooks/useLimitReached";
import { useLanguage } from "@/contexts/LanguageContext";
import AppLayout from "@/components/AppLayout";
import SourcesPanel from "@/components/research/SourcesPanel";
import ChatDisplay from "@/components/research/ChatDisplay";
import ResearchModeSwitcher, { type ResearchMode } from "@/components/research/ResearchModeSwitcher";
import { useResearchSources } from "@/hooks/useResearchSources";
import { useResearchChat } from "@/hooks/useResearchChat";
import { downloadBibliography } from "@/lib/research/bibliography";
import { downloadResearchReport } from "@/lib/research/report";
import type { ResearchAssistMode } from "@/lib/prompts";
import { toast } from "sonner";

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

const Research = () => {
  useSeo({ title: "Research — Al-Ulama Easy Editor", description: "Grounded Islamic research assistant with citations from Quran, Hadith and classical sources.", path: "/research" });

  const { user, session } = useAuth();
  const { t } = useLanguage();
  const { subscription, refetch } = useSubscription();
  const tier = subscription?.tier ?? "free";

  const {
    used: researchQueriesUsed,
    limit: researchQueriesLimitRaw,
    reached: researchLimitReached,
  } = useLimitReached("research");
  const researchQueriesLimit = researchQueriesLimitRaw || 3;

  const {
    used: islamicQueriesUsed,
    limit: islamicQueriesLimit,
    reached: islamicLimitReached,
  } = useLimitReached("islamic");

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

  // Map 3-tab UI mode → current hook's 2-mode contract.
  // Custom behaves like general (user-provided sources + research-query edge fn).
  const hookMode: "general" | "islamic" = mode === "islamic" ? "islamic" : "general";

  const sourcesApi = useResearchSources(user);
  const chat = useResearchChat({
    user,
    session,
    mode: hookMode,
    tier,
    sources: sourcesApi.sources,
    // Extended mode is only available in Custom Sources tab; force strict elsewhere
    strictMode: mode === "custom" ? strictMode : true,
    islamicDomains,
    islamicLanguages,
    researchLimitReached,
    islamicLimitReached,
    assistModes,
    refetch,
  });

  const handleDownloadReport = () => {
    downloadResearchReport(chat.messages, sourcesApi.sources);
    toast.success(t("research.report_downloaded"));
  };

  const handleExportBibliography = () => {
    if (downloadBibliography(chat.citations)) {
      toast.success(t("research.bibliography_exported"));
    }
  };

  const handleModeChange = (next: ResearchMode) => {
    if (next === mode) return;
    if (chat.query.trim().length > 0) {
      if (!window.confirm(t("research.mode_switch_unsaved"))) return;
    }
    setMode(next);
  };

  const activeLimitReached = mode === "islamic" ? islamicLimitReached : researchLimitReached;

  return (
    <AppLayout>
      <div className="flex flex-col h-[calc(100vh-3.5rem-5rem)] md:h-[calc(100vh-3.5rem)] lg:h-[calc(100vh-3.5rem)] overflow-hidden">
        <div className="border-b border-border bg-background px-3 py-2 md:px-4">
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
            <ResearchModeSwitcher mode={mode} onModeChange={handleModeChange} t={t} />
            {/* Compact usage chip for islamic/general (replaces left-panel usage block) */}
            {mode === "islamic" && islamicQueriesLimit > 0 && (
              <span className={`text-[11px] font-medium px-2 py-1 rounded-md border whitespace-nowrap ${islamicLimitReached ? "text-destructive border-destructive/40 bg-destructive/5" : "text-muted-foreground border-border bg-muted/40"}`}>
                {islamicQueriesUsed} / {islamicQueriesLimit}
              </span>
            )}
            {mode === "general" && (subscription?.research_queries_limit ?? 0) > 0 && (
              <span className={`text-[11px] font-medium px-2 py-1 rounded-md border whitespace-nowrap ${researchLimitReached ? "text-destructive border-destructive/40 bg-destructive/5" : "text-muted-foreground border-border bg-muted/40"}`}>
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
          onDownloadReport={handleDownloadReport}
          onClearChat={chat.handleClearChat}
          onRegenerate={chat.handleRegenerate}
          sources={sourcesApi.sources}
          researchLimitReached={activeLimitReached}
          chatEndRef={chat.chatEndRef}
          t={t}
          mode={mode}
          sourcesReadyInfo={chat.sourcesReadyInfo}
          citations={chat.citations}
          onExportBibliography={handleExportBibliography}
          canExportBibliography={tier === "ultra" && mode === "islamic"}
          assistModes={assistModes}
          onAssistModesChange={setAssistModes}
        />
        </div>
      </div>
    </AppLayout>
  );
};

export default Research;
