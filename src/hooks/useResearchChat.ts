import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { User, Session } from "@supabase/supabase-js";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ChatMessage, Source } from "@/components/research/types";
import type { CitationItem } from "@/components/research/CitationPanel";
import { streamResearchQuery, streamIslamicQuery, assistResearchQuery } from "@/lib/research/streamers";
import type { ResearchAssistMode } from "@/lib/prompts";
import {
  upsertResearchSession,
  loadLatestResearchSession,
  loadResearchSession,
  deleteResearchSession,
} from "@/lib/research/persistence";
import { callRefineText, isRefineTextAction } from "@/lib/editor/aiActions";
import { logger } from "@/lib/logger";

const log = logger.child("useResearchChat");

const errMsg = (e: unknown, fallback: string): string =>
  e instanceof Error ? e.message : fallback;

function mergeCitations(existing: CitationItem[], fetched: CitationItem[]): CitationItem[] {
  const merged = [...existing];
  for (const c of fetched) {
    const key = c.url ?? `${c.domain}-${JSON.stringify(c.citation_ref)}`;
    if (!merged.some((m) => (m.url ?? `${m.domain}-${JSON.stringify(m.citation_ref)}`) === key)) {
      merged.push(c);
    }
  }
  return merged;
}

interface UseResearchChatArgs {
  user: User | null;
  session: Session | null;
  mode: "general" | "islamic" | "custom";
  tier: string;
  sources: Source[];
  strictMode: boolean;
  islamicDomains: string[];
  islamicLanguages: string[];
  researchLimitReached: boolean;
  islamicLimitReached: boolean;
  assistModes: ResearchAssistMode[];
  refetch: () => void;
}

export function useResearchChat(args: UseResearchChatArgs) {
  const {
    user, session, mode, tier, sources, strictMode,
    islamicDomains, islamicLanguages,
    researchLimitReached, islamicLimitReached, assistModes, refetch,
  } = args;
  const { t } = useLanguage();
  const userId = user?.id ?? null;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState("");
  const [isQuerying, setIsQuerying] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [citations, setCitations] = useState<CitationItem[]>([]);
  const [sourcesReadyInfo, setSourcesReadyInfo] = useState<{ count: number; domains: string[] } | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  // Guards the reset-then-load effect from clobbering an in-flight stream.
  // Even after the AuthContext identity fix, a genuine mode/id change during
  // streaming should never wipe the answer currently being generated.
  const isStreamingRef = useRef(false);
  // Mirror of sessionIdRef as state so the sidebar can re-render and highlight
  // the active session. The ref is the source of truth for write paths
  // (handleSendQuery / handleClearChat); the state just tracks it for reads.
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // Bump this to trigger the sessions list to refetch (after save/delete).
  const [sessionsVersion, setSessionsVersion] = useState(0);

  const lastAssistantIdx = [...messages].reverse().findIndex((m) => m.role === "assistant");
  const lastAssistantMessage = lastAssistantIdx >= 0 ? messages[messages.length - 1 - lastAssistantIdx] : null;

  const saveSession = useCallback(async (
    updatedMessages: ChatMessage[],
    updatedCitations: CitationItem[],
  ) => {
    if (!userId || updatedMessages.length === 0) return;
    try {
      const firstUser = updatedMessages.find((m) => m.role === "user");
      const title = firstUser?.content.slice(0, 80) ?? "Research Session";
      const newId = await upsertResearchSession({
        id: sessionIdRef.current,
        userId,
        title,
        mode: mode === "islamic" ? "islamic" : "general",
        messages: updatedMessages,
        citations: updatedCitations,
        selectedDomains: mode === "islamic" ? islamicDomains : [],
      });
      if (newId && !sessionIdRef.current) {
        sessionIdRef.current = newId;
        setActiveSessionId(newId);
      }
      // Bump the sessions-list version so the sidebar refetches.
      setSessionsVersion((v) => v + 1);
      // Cross-component signal so the global `SidebarHistory` (rendered in
      // AppLayout) picks up the new/updated session without a page reload.
      window.dispatchEvent(new CustomEvent("session-history-changed", { detail: { section: "research" } }));
    } catch {
      log.debug("research_sessions table not available yet");
    }
  }, [userId, mode, islamicDomains]);

  // If the URL has `?session=<id>`, the global SidebarHistory has navigated
  // us into a specific past session — load THAT one instead of the latest.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSessionId = searchParams.get("session");

  const loadRequestedOrLatest = useCallback(async () => {
    if (!userId) return;
    try {
      if (requestedSessionId) {
        const data = await loadResearchSession(requestedSessionId, userId);
        if (data) {
          sessionIdRef.current = data.id;
          setActiveSessionId(data.id);
          setMessages(data.messages ?? []);
          setCitations(data.citations ?? []);
          return;
        }
        // Requested id wasn't found — fall through to "latest" so the page
        // isn't stuck empty, and strip the bad param so reload doesn't loop.
        const next = new URLSearchParams(searchParams);
        next.delete("session");
        setSearchParams(next, { replace: true });
      }
      const data = await loadLatestResearchSession(userId, mode === "islamic" ? "islamic" : "general");
      if (data) {
        sessionIdRef.current = data.id;
        setActiveSessionId(data.id);
        setMessages(data.messages ?? []);
        setCitations(data.citations ?? []);
      }
    } catch {
      log.debug("research_sessions table not available yet");
    }
  }, [userId, mode, requestedSessionId, searchParams, setSearchParams]);

  useEffect(() => {
    // Never reset while a stream is actively writing into `messages` — a
    // mode/id change mid-answer would otherwise discard the in-flight output.
    if (isStreamingRef.current) return;
    sessionIdRef.current = null;
    setActiveSessionId(null);
    setMessages([]);
    setCitations([]);
    setSourcesReadyInfo(null);
    loadRequestedOrLatest();
  }, [loadRequestedOrLatest]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isQuerying]);

  const appendAssistantChunk = useCallback((soFarRef: { value: string }, chunk: string) => {
    soFarRef.value += chunk;
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant") {
        return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: soFarRef.value } : m));
      }
      return [...prev, { role: "assistant", content: soFarRef.value }];
    });
  }, []);

  const runQuery = useCallback(async (userContent: string, prevMessages: ChatMessage[]) => {
    setIsQuerying(true);
    isStreamingRef.current = true;
    setSourcesReadyInfo(null);
    const soFar = { value: "" };
    const onDelta = (chunk: string) => appendAssistantChunk(soFar, chunk);
    const finish = () => { setIsQuerying(false); isStreamingRef.current = false; };

    if (assistModes.length > 0) {
      try {
        const assistResult = await assistResearchQuery({ query: userContent, modes: assistModes });
        let content = "";
        if (assistResult.promptKey === "spelling" || assistResult.promptKey === "combined") {
          content = assistResult.corrected;
        } else if (assistResult.promptKey === "citations") {
          content = assistResult.text;
        }

        const newMsg: ChatMessage = { role: "assistant", content, assist: assistResult };
        setMessages((prev) => {
          const next = [...prev, newMsg];
          saveSession(next, citations);
          return next;
        });

        // Token deduction handled server-side — just refetch wallet balance
        if (user) refetch();
      } catch (err: unknown) {
        toast.error(errMsg(err, t("research.refine_error")));
      } finally {
        finish();
      }
      return;
    }

    if (mode === "islamic") {
      let finalCitations: CitationItem[] = citations;
      await streamIslamicQuery({
        query: userContent,
        selectedDomains: islamicDomains,
        selectedLanguages: islamicLanguages,
        strictMode,
        chatHistory: prevMessages,
        tier,
        onDelta,
        onSourcesReady: (count, domains, fetched) => {
          setSourcesReadyInfo({ count, domains });
          const merged = mergeCitations(citations, fetched);
          finalCitations = merged;
          setCitations(merged);
        },
        onDone: () => {
          finish();
          // Token deduction handled server-side — just refetch wallet balance
          if (user) refetch();
          setMessages((prev) => { saveSession(prev, finalCitations); return prev; });
        },
        onError: (err) => { toast.error(err); finish(); },
      });
    } else {
      await streamResearchQuery({
        query: userContent,
        sources,
        strictMode,
        chatHistory: prevMessages,
        mode,
        onDelta,
        onDone: () => {
          finish();
          // Token deduction handled server-side — just refetch wallet balance
          if (user) refetch();
        },
        onError: (err) => { toast.error(err); finish(); },
      });
    }
  }, [mode, citations, islamicDomains, islamicLanguages, strictMode, tier, sources, user, refetch, saveSession, appendAssistantChunk, assistModes, t]);

  const handleSendQuery = async () => {
    if (!query.trim() || !session?.access_token) return;
    // Assist modes always bill against research quota regardless of tab.
    const limitReached = assistModes.length > 0
      ? researchLimitReached
      : mode === "islamic" ? islamicLimitReached : researchLimitReached;
    if (limitReached) { toast.error(t("research.limit_reached")); return; }

    const userMsg: ChatMessage = { role: "user", content: query };
    const prevMessages = [...messages];
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setQuery("");
    // Persist the session as soon as the user's question is added — before the
    // (potentially long) stream — so a mid-stream reload can never lose it and
    // sessionIdRef is set immediately for the "latest session" load path.
    saveSession(nextMessages, citations);
    await runQuery(userMsg.content, prevMessages);
  };

  const handleRegenerate = async () => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg || !session?.access_token) return;

    // Assist modes always bill against research quota regardless of tab.
    const limitReached = assistModes.length > 0
      ? researchLimitReached
      : mode === "islamic" ? islamicLimitReached : researchLimitReached;
    if (limitReached) { toast.error(t("research.limit_reached")); return; }

    const cutoff = messages.length - 1 - lastAssistantIdx >= 0
      ? messages.length - 1 - lastAssistantIdx
      : messages.length;
    const messagesWithoutLastAssistant = messages.slice(0, cutoff);
    const prevMessages = messagesWithoutLastAssistant.slice(0, -1);
    setMessages(messagesWithoutLastAssistant);
    await runQuery(lastUserMsg.content, prevMessages);
  };

  const handleRefine = async (action: string) => {
    if (!lastAssistantMessage || !session?.access_token) return;
    const sourceText = (lastAssistantMessage.content ?? "").trim();
    if (!sourceText || !isRefineTextAction(action)) {
      toast.error(t("research.refine_error"));
      return;
    }
    setIsRefining(true);
    try {
      const refined = await callRefineText(sourceText, action, session.access_token);
      if (refined) {
        setMessages((prev) =>
          prev.map((m, i) =>
            i === messages.length - 1 - lastAssistantIdx ? { ...m, content: refined } : m
          )
        );
        toast.success(t(`research.${action}_done` as import("@/lib/i18n").TranslationKey));
      }
    } catch (err: unknown) {
      toast.error(errMsg(err, t("research.refine_error")));
    } finally {
      setIsRefining(false);
    }
  };

  const handleCopyOutput = () => {
    if (!lastAssistantMessage) return;
    navigator.clipboard.writeText(lastAssistantMessage.content);
    toast.success(t("research.copied"));
  };

  const handleClearChat = async () => {
    if (user && sessionIdRef.current) {
      try {
        await deleteResearchSession(sessionIdRef.current, user.id);
      } catch { /* table may not be migrated */ }
    }
    sessionIdRef.current = null;
    setActiveSessionId(null);
    setMessages([]);
    setCitations([]);
    setSourcesReadyInfo(null);
    setSessionsVersion((v) => v + 1);
    window.dispatchEvent(new CustomEvent("session-history-changed", { detail: { section: "research" } }));
    toast.success(t("research.chat_cleared"));
  };

  // Phase 10.5: start a fresh chat without deleting the current session.
  const handleNewChat = () => {
    sessionIdRef.current = null;
    setActiveSessionId(null);
    setMessages([]);
    setCitations([]);
    setSourcesReadyInfo(null);
  };

  // Phase 10.5: load a specific past session into the active chat (sidebar click).
  const handleLoadSession = async (id: string) => {
    if (!user) return;
    try {
      const data = await loadResearchSession(id, user.id);
      if (!data) {
        toast.error(t("research.session_not_found", "Session not found"));
        return;
      }
      sessionIdRef.current = data.id;
      setActiveSessionId(data.id);
      setMessages(data.messages ?? []);
      setCitations(data.citations ?? []);
      setSourcesReadyInfo(null);
    } catch {
      toast.error(t("research.session_load_failed", "Failed to load session"));
    }
  };

  // Phase 10.5: delete a specific session from the sidebar (not necessarily the active one).
  const handleDeleteSession = async (id: string) => {
    if (!user) return;
    try {
      await deleteResearchSession(id, user.id);
      // If we deleted the currently-active session, reset the chat too.
      if (sessionIdRef.current === id) {
        sessionIdRef.current = null;
        setActiveSessionId(null);
        setMessages([]);
        setCitations([]);
        setSourcesReadyInfo(null);
      }
      setSessionsVersion((v) => v + 1);
    } catch {
      toast.error(t("research.session_delete_failed", "Failed to delete session"));
    }
  };

  const handleContinue = async () => {
    if (!session?.access_token) return;
    const limitReached = mode === "islamic" ? islamicLimitReached : researchLimitReached;
    if (limitReached) { toast.error(t("research.limit_reached")); return; }

    const continueMsg: ChatMessage = { role: "user", content: t("research.continue_prompt", "Continue from where you left off. Do not repeat what was already said.") };
    const prevMessages = [...messages];
    const nextMessages = [...messages, continueMsg];
    setMessages(nextMessages);
    saveSession(nextMessages, citations);
    await runQuery(continueMsg.content, prevMessages);
  };

  return {
    messages,
    query,
    setQuery,
    isQuerying,
    isRefining,
    citations,
    sourcesReadyInfo,
    chatEndRef,
    lastAssistantIdx,
    handleSendQuery,
    handleRegenerate,
    handleRefine,
    handleCopyOutput,
    handleClearChat,
    handleContinue,
    // Phase 10.5 sidebar API
    activeSessionId,
    sessionsVersion,
    handleNewChat,
    handleLoadSession,
    handleDeleteSession,
  };
}
