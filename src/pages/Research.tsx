import { useState } from "react";
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
import { useSeo } from "@/hooks/useSeo";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useLimitReached } from "@/hooks/useLimitReached";
import { useCanAfford } from "@/hooks/useTokenBalance";
import { useLanguage } from "@/contexts/LanguageContext";
import AppLayout from "@/components/AppLayout";
import SourcesPanel from "@/components/research/SourcesPanel";
import ChatDisplay from "@/components/research/ChatDisplay";
import ResearchModeSwitcher, { type ResearchMode } from "@/components/research/ResearchModeSwitcher";
import { useResearchSources } from "@/hooks/useResearchSources";
import { useResearchChat } from "@/hooks/useResearchChat";

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

const Research = () => {
  useSeo({ title: "Quran & Hadith AI — Grounded Islamic Research", description: "Grounded Islamic research assistant with cited answers from Quran, Hadith and classical sources in Urdu, Arabic and English.", path: "/research", noindex: true });

  const { user, session } = useAuth();
  const { t } = useLanguage();
  const { subscription, refetch } = useSubscription();
  const tier = subscription?.tier ?? "free";

  const {
    used: researchQueriesUsed,
    limit: researchQueriesLimitRaw,
    reached: legacyResearchLimitReached,
  } = useLimitReached("research");
  const researchQueriesLimit = researchQueriesLimitRaw || 3;
  void legacyResearchLimitReached; // legacy per-tier column no longer gates — token wallet does
  const { canAfford: canAffordResearch } = useCanAfford("research", 1);
  const researchLimitReached = !canAffordResearch;

  const {
    used: islamicQueriesUsed,
    limit: islamicQueriesLimit,
    reached: legacyIslamicLimitReached,
  } = useLimitReached("islamic");
  void legacyIslamicLimitReached; // legacy per-tier column no longer gates — token wallet does
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

  // Pass the full UI mode through so the chat hook and edge function can
  // apply context-aware behavior (e.g. whitelist enforcement in islamic/general
  // and bypass in custom).
  const hookMode: "general" | "islamic" | "custom" = mode;

  const sourcesApi = useResearchSources(user);
  const chat = useResearchChat({
    user,
    session,
    mode: hookMode,
    tier,
    sources: sourcesApi.sources,
    // Per Phase 10.3: strictMode is per-mode.
    //   - Islamic: always strict (answers MUST be grounded in retrieved sources).
    //   - General: never strict — Gemini answers with its general knowledge under
    //     citation-discipline rules (see STRICT_INSTRUCTION_OFF in
    //     supabase/functions/_shared/researchPrompts.ts).
    //   - Custom: honour the user's UI toggle.
    strictMode: mode === "islamic" ? true : mode === "general" ? false : strictMode,
    islamicDomains,
    islamicLanguages,
    researchLimitReached,
    islamicLimitReached,
    assistModes,
    refetch,
  });


  // Pending mode for the confirm dialog. When switching modes with an active
  // conversation on screen, we ask before discarding it — using the app's own
  // AlertDialog rather than the native window.confirm.
  const [pendingMode, setPendingMode] = useState<ResearchMode | null>(null);

  const handleModeChange = (next: ResearchMode) => {
    if (next === mode) return;
    // Warn if there is a visible conversation OR an unsent draft that switching
    // away would discard. (The draft box is cleared after sending, so message
    // presence is what actually matters once an answer has rendered.)
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
    </AppLayout>
  );
};

export default Research;
