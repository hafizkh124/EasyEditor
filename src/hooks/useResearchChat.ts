import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ChatMessage, Source } from "@/components/research/types";
import type { CitationItem } from "@/components/research/CitationPanel";
import { streamResearchQuery, streamIslamicQuery, assistResearchQuery } from "@/lib/research/streamers";
import type { ResearchAssistMode } from "@/lib/prompts";
import {
  upsertResearchSession,
  loadLatestResearchSession,
  deleteResearchSession,
  incrementQueryCount,
} from "@/lib/research/persistence";

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
  mode: "general" | "islamic";
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

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState("");
  const [isQuerying, setIsQuerying] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [citations, setCitations] = useState<CitationItem[]>([]);
  const [sourcesReadyInfo, setSourcesReadyInfo] = useState<{ count: number; domains: string[] } | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);

  const lastAssistantIdx = [...messages].reverse().findIndex((m) => m.role === "assistant");
  const lastAssistantMessage = lastAssistantIdx >= 0 ? messages[messages.length - 1 - lastAssistantIdx] : null;

  const saveSession = useCallback(async (
    updatedMessages: ChatMessage[],
    updatedCitations: CitationItem[],
  ) => {
    if (!user || updatedMessages.length === 0) return;
    try {
      const firstUser = updatedMessages.find((m) => m.role === "user");
      const title = firstUser?.content.slice(0, 80) ?? "Research Session";
      const newId = await upsertResearchSession({
        id: sessionIdRef.current,
        userId: user.id,
        title,
        mode,
        messages: updatedMessages,
        citations: updatedCitations,
        selectedDomains: mode === "islamic" ? islamicDomains : [],
      });
      if (newId && !sessionIdRef.current) sessionIdRef.current = newId;
    } catch {
      if (import.meta.env.DEV) console.warn("[Research] research_sessions table not available yet");
    }
  }, [user, mode, islamicDomains]);

  const loadLastSession = useCallback(async () => {
    if (!user) return;
    try {
      const data = await loadLatestResearchSession(user.id, mode);
      if (data) {
        sessionIdRef.current = data.id;
        setMessages(data.messages ?? []);
        setCitations(data.citations ?? []);
      }
    } catch {
      if (import.meta.env.DEV) console.warn("[Research] research_sessions table not available yet");
    }
  }, [user, mode]);

  useEffect(() => {
    sessionIdRef.current = null;
    setMessages([]);
    setCitations([]);
    setSourcesReadyInfo(null);
    loadLastSession();
  }, [loadLastSession]);

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
    setSourcesReadyInfo(null);
    const soFar = { value: "" };
    const onDelta = (chunk: string) => appendAssistantChunk(soFar, chunk);

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

        if (user) {
          incrementQueryCount("increment_research_queries", user.id).then((ok) => { if (ok) refetch(); });
        }
      } catch (err: unknown) {
        toast.error(errMsg(err, t("research.refine_error")));
      } finally {
        setIsQuerying(false);
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
          setIsQuerying(false);
          if (user) {
            incrementQueryCount("increment_islamic_queries", user.id).then((ok) => { if (ok) refetch(); });
          }
          setMessages((prev) => { saveSession(prev, finalCitations); return prev; });
        },
        onError: (err) => { toast.error(err); setIsQuerying(false); },
      });
    } else {
      await streamResearchQuery({
        query: userContent,
        sources,
        strictMode,
        chatHistory: prevMessages,
        onDelta,
        onDone: () => {
          setIsQuerying(false);
          if (user) {
            incrementQueryCount("increment_research_queries", user.id).then((ok) => { if (ok) refetch(); });
          }
        },
        onError: (err) => { toast.error(err); setIsQuerying(false); },
      });
    }
  }, [mode, citations, islamicDomains, islamicLanguages, strictMode, tier, sources, user, refetch, saveSession, appendAssistantChunk]);

  const handleSendQuery = async () => {
    if (!query.trim() || !session?.access_token) return;
    const limitReached = mode === "islamic" ? islamicLimitReached : researchLimitReached;
    if (limitReached) { toast.error(t("research.limit_reached")); return; }

    const userMsg: ChatMessage = { role: "user", content: query };
    const prevMessages = [...messages];
    setMessages((prev) => [...prev, userMsg]);
    setQuery("");
    await runQuery(userMsg.content, prevMessages);
  };

  const handleRegenerate = async () => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg || !session?.access_token) return;

    const limitReached = mode === "islamic" ? islamicLimitReached : researchLimitReached;
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
    setIsRefining(true);
    try {
      const { data, error } = await supabase.functions.invoke("refine-text", {
        body: { text: lastAssistantMessage.content, action },
      });
      if (error) throw error;
      if (data?.error) { toast.error(data.error); setIsRefining(false); return; }
      const refined = data?.text;
      if (refined) {
        setMessages((prev) =>
          prev.map((m, i) =>
            i === messages.length - 1 - lastAssistantIdx ? { ...m, content: refined } : m
          )
        );
        toast.success(t(`research.${action}_done` as string));
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
    setMessages([]);
    setCitations([]);
    setSourcesReadyInfo(null);
    toast.success(t("research.chat_cleared"));
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
  };
}
