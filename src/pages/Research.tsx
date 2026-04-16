import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import SourcesPanel from "@/components/research/SourcesPanel";
import ChatDisplay from "@/components/research/ChatDisplay";
import type { Source, ChatMessage } from "@/components/research/types";
import type { CitationItem } from "@/components/research/CitationPanel";

// --- SSE stream parser (general research-query) ---
async function streamResearchQuery({
  query, sources, strictMode, chatHistory, onDelta, onDone, onError,
}: {
  query: string; sources: Source[]; strictMode: boolean; chatHistory: ChatMessage[];
  onDelta: (text: string) => void; onDone: () => void; onError: (err: string) => void;
}) {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/research-query`;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { onError("Please sign in to use research."); return; }

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ query, sources, strictMode, chatHistory }),
    });

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({ error: "Request failed" }));
      onError(errData.error || "Request failed");
      return;
    }

    if (!resp.body) { onError("No response body"); return; }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "") continue;
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") { onDone(); return; }
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (content) onDelta(content);
        } catch {
          buffer = line + "\n" + buffer;
          break;
        }
      }
    }
    // flush
    if (buffer.trim()) {
      for (let raw of buffer.split("\n")) {
        if (!raw) continue;
        if (raw.endsWith("\r")) raw = raw.slice(0, -1);
        if (!raw.startsWith("data: ")) continue;
        const jsonStr = raw.slice(6).trim();
        if (jsonStr === "[DONE]") continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (content) onDelta(content);
        } catch { /* ignore */ }
      }
    }
    onDone();
  } catch (e: any) {
    onError(e.message || "Stream error");
  }
}

// --- SSE stream parser (islamic-search) ---
async function streamIslamicQuery({
  query, selectedDomains, selectedLanguages, strictMode, chatHistory, tier,
  onDelta, onDone, onError, onSourcesReady,
}: {
  query: string;
  selectedDomains: string[];
  selectedLanguages: string[];
  strictMode: boolean;
  chatHistory: ChatMessage[];
  tier: string;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (err: string) => void;
  onSourcesReady?: (count: number, domains: string[], citations: CitationItem[]) => void;
}) {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/islamic-search`;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { onError("Please sign in to use research."); return; }

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ query, selectedDomains, selectedLanguages, strictMode, chatHistory, tier }),
    });

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({ error: "Request failed" }));
      onError(errData.error || "Request failed");
      return;
    }

    if (!resp.body) { onError("No response body"); return; }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const parseLine = (line: string): boolean => {
      if (!line.startsWith("data: ")) return false;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") { onDone(); return true; }
      try {
        const parsed = JSON.parse(jsonStr);
        // Islamic search emits a sources_ready event before Gemini starts
        if (parsed.type === "sources_ready") {
          onSourcesReady?.(parsed.count ?? 0, parsed.domains ?? [], parsed.citations ?? []);
          return false;
        }
        const content = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (content) onDelta(content);
      } catch {
        return false;
      }
      return false;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "") continue;
        const isDone = parseLine(line);
        if (isDone) return;
      }
    }
    // flush
    if (buffer.trim()) {
      for (let raw of buffer.split("\n")) {
        if (!raw) continue;
        if (raw.endsWith("\r")) raw = raw.slice(0, -1);
        parseLine(raw);
      }
    }
    onDone();
  } catch (e: any) {
    onError(e.message || "Stream error");
  }
}

// --- Islamic domains (auto-selected based on tier; UI is hidden) ---
const ALL_ISLAMIC_DOMAINS_TIER_A = ["dorar", "sunnah", "alquran", "quran-com", "tanzil"];
const ALL_ISLAMIC_DOMAINS_PRO = [
  ...ALL_ISLAMIC_DOMAINS_TIER_A,
  "hadith-index", "islamqa", "islamweb", "dar-alifta", "shamela-index", "openiti-index",
];
const DEFAULT_ISLAMIC_DOMAINS = ALL_ISLAMIC_DOMAINS_TIER_A;
const DEFAULT_ISLAMIC_LANGUAGES = ["ar", "en", "ur"];
const getAutoIslamicDomains = (tier: string) =>
  tier === "pro" || tier === "ultra" ? ALL_ISLAMIC_DOMAINS_PRO : ALL_ISLAMIC_DOMAINS_TIER_A;

const Research = () => {
  const { user, session } = useAuth();
  const { t } = useLanguage();
  const { subscription, refetch } = useSubscription();

  const tier = subscription?.tier ?? "free";
  const researchQueriesUsed = subscription?.research_queries_used ?? 0;
  const researchQueriesLimit = subscription?.research_queries_limit ?? 3;
  const researchLimitReached = researchQueriesLimit > 0 && researchQueriesUsed >= researchQueriesLimit;

  // Islamic mode quota (columns added in migration 20260406000002)
  const islamicQueriesUsed = (subscription as any)?.islamic_queries_used ?? 0;
  const islamicQueriesLimit = (subscription as any)?.islamic_queries_limit ?? 0;
  const islamicLimitReached = islamicQueriesLimit > 0 && islamicQueriesUsed >= islamicQueriesLimit;

  // --- Mode state (general | islamic) with localStorage persistence ---
  const [mode, setMode] = useState<"general" | "islamic">(() => {
    return (localStorage.getItem("research_mode") as "general" | "islamic") ?? "general";
  });

  const handleModeChange = (m: "general" | "islamic") => {
    setMode(m);
    localStorage.setItem("research_mode", m);
  };

  // --- Islamic domain + language selection with localStorage persistence ---
  const [islamicDomains, setIslamicDomains] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("islamic_domains");
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return DEFAULT_ISLAMIC_DOMAINS;
  });

  const [islamicLanguages, setIslamicLanguages] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("islamic_languages");
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return DEFAULT_ISLAMIC_LANGUAGES;
  });

  const handleIslamicDomainsChange = (domains: string[]) => {
    setIslamicDomains(domains);
    localStorage.setItem("islamic_domains", JSON.stringify(domains));
  };

  const handleIslamicLanguagesChange = (langs: string[]) => {
    setIslamicLanguages(langs);
    localStorage.setItem("islamic_languages", JSON.stringify(langs));
  };

  // --- Sources (general mode) ---
  const [sources, setSources] = useState<Source[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Chat ---
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState("");
  const [isQuerying, setIsQuerying] = useState(false);
  const [strictMode, setStrictMode] = useState(true);
  const [isRefining, setIsRefining] = useState(false);
  const [sourcesReadyInfo, setSourcesReadyInfo] = useState<{ count: number; domains: string[] } | null>(null);
  const [citations, setCitations] = useState<CitationItem[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Session management
  const sessionIdRef = useRef<string | null>(null);

  const lastAssistantIdx = [...messages].reverse().findIndex((m) => m.role === "assistant");
  const lastAssistantMessage = lastAssistantIdx >= 0 ? messages[messages.length - 1 - lastAssistantIdx] : null;

  const loadSources = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("research_sources")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (data) setSources(data as Source[]);
  }, [user]);

  // ── Session save/load ─────────────────────────────────────────────────────
  // Silently no-ops if the research_sessions table hasn't been migrated yet
  // (returns a 404/PGRST116 until the SQL migration runs in the dashboard).
  const saveSession = useCallback(async (
    updatedMessages: ChatMessage[],
    updatedCitations: CitationItem[],
  ) => {
    if (!user || updatedMessages.length === 0) return;
    try {
      const firstUser = updatedMessages.find((m) => m.role === "user");
      const title = firstUser?.content.slice(0, 80) ?? "Research Session";

      if (sessionIdRef.current) {
        await (supabase.from as any)("research_sessions")
          .update({
            messages:         updatedMessages,
            citations:        updatedCitations,
            selected_domains: mode === "islamic" ? islamicDomains : [],
            mode,
            title,
          })
          .eq("id", sessionIdRef.current)
          .eq("user_id", user.id);
      } else {
        const { data, error } = await (supabase.from as any)("research_sessions")
          .insert({
            user_id:          user.id,
            title,
            messages:         updatedMessages,
            citations:        updatedCitations,
            selected_domains: mode === "islamic" ? islamicDomains : [],
            mode,
          })
          .select("id")
          .single();
        if (!error && data?.id) sessionIdRef.current = data.id;
      }
    } catch {
      // Table not yet migrated — session persistence silently disabled
      if (import.meta.env.DEV) console.warn("[Research] research_sessions table not available yet");
    }
  }, [user, mode, islamicDomains]);

  const loadLastSession = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await (supabase.from as any)("research_sessions")
        .select("*")
        .eq("user_id", user.id)
        .eq("mode", mode)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        sessionIdRef.current = data.id;
        setMessages(data.messages as unknown as ChatMessage[] ?? []);
        setCitations(data.citations as unknown as CitationItem[] ?? []);
      }
    } catch {
      // Table not yet migrated — start with empty session
      if (import.meta.env.DEV) console.warn("[Research] research_sessions table not available yet");
    }
  }, [user, mode]);

  useEffect(() => { loadSources(); }, [loadSources]);
  // Load session when user/mode changes
  useEffect(() => {
    sessionIdRef.current = null;
    setMessages([]);
    setCitations([]);
    setSourcesReadyInfo(null);
    loadLastSession();
  }, [loadLastSession]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isQuerying]);

  // Reset sources_ready indicator when a new query starts
  const processFile = useCallback(async (file: File) => {
    if (!user) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["pdf", "docx"].includes(ext || "")) { toast.error(t("research.invalid_file")); return; }
    if (file.size > 20 * 1024 * 1024) { toast.error(t("research.file_too_large")); return; }
    setIsUploading(true);
    try {
      const filePath = `${user.id}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("research-files").upload(filePath, file);
      if (uploadError) throw uploadError;
      const { error: dbError } = await supabase.from("research_sources").insert({
        user_id: user.id, source_type: ext as "pdf" | "docx", title: file.name, storage_path: filePath,
      });
      if (dbError) throw dbError;
      await loadSources();
      toast.success(t("research.source_added"));
    } catch (err: any) {
      toast.error(err.message || t("research.upload_error"));
    } finally {
      setIsUploading(false);
    }
  }, [user, loadSources, t]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) processFile(file);
  };

  const handleAddUrl = async () => {
    if (!urlInput.trim() || !user) return;
    let url = urlInput.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://" + url;
    setIsAddingUrl(true);
    try {
      const title = new URL(url).hostname.replace("www.", "");
      const { error } = await supabase.from("research_sources").insert({
        user_id: user.id, source_type: "url", title, url,
      });
      if (error) throw error;
      setUrlInput("");
      await loadSources();
      toast.success(t("research.source_added"));
    } catch (err: any) {
      toast.error(err.message || t("research.add_error"));
    } finally {
      setIsAddingUrl(false);
    }
  };

  const handleDeleteSource = async (source: Source) => {
    try {
      if (source.storage_path) await supabase.storage.from("research-files").remove([source.storage_path]);
      await supabase.from("research_sources").delete().eq("id", source.id);
      setSources((prev) => prev.filter((s) => s.id !== source.id));
      toast.success(t("research.source_removed"));
    } catch {
      toast.error(t("research.delete_error"));
    }
  };

  const handleDeleteAllSources = async () => {
    if (!user || sources.length === 0) return;
    try {
      // Remove all stored files in parallel
      const filePaths = sources.filter((s) => s.storage_path).map((s) => s.storage_path as string);
      if (filePaths.length > 0) {
        await supabase.storage.from("research-files").remove(filePaths);
      }
      // Delete all DB rows for this user
      await supabase.from("research_sources").delete().eq("user_id", user.id);
      setSources([]);
      toast.success(t("research.sources_cleared"));
    } catch {
      toast.error(t("research.delete_error"));
    }
  };

  const handleSendQuery = async () => {
    if (!query.trim() || !session?.access_token) return;

    // Branch on mode
    if (mode === "islamic") {
      if (islamicLimitReached) { toast.error(t("research.limit_reached")); return; }

      const userMsg: ChatMessage = { role: "user", content: query };
      const prevMessages = [...messages];
      setMessages((prev) => [...prev, userMsg]);
      setQuery("");
      setIsQuerying(true);
      setSourcesReadyInfo(null);

      let assistantSoFar = "";
      const upsertAssistant = (chunk: string) => {
        assistantSoFar += chunk;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
          }
          return [...prev, { role: "assistant", content: assistantSoFar }];
        });
      };

      let newCitations: CitationItem[] = [];
      await streamIslamicQuery({
        query: userMsg.content,
        selectedDomains: islamicDomains,
        selectedLanguages: islamicLanguages,
        strictMode,
        chatHistory: prevMessages,
        tier,
        onDelta: upsertAssistant,
        onSourcesReady: (count, domains, fetchedCitations) => {
          setSourcesReadyInfo({ count, domains });
          // Merge new citations (deduplicate by url)
          const merged = [...citations];
          for (const c of fetchedCitations) {
            const key = c.url ?? `${c.domain}-${JSON.stringify(c.citation_ref)}`;
            if (!merged.some((m) => (m.url ?? `${m.domain}-${JSON.stringify(m.citation_ref)}`) === key)) {
              merged.push(c);
            }
          }
          newCitations = merged;
          setCitations(merged);
        },
        onDone: () => {
          setIsQuerying(false);
          if (user) {
            if (import.meta.env.DEV) console.log("[Research] Incrementing islamic_queries_used for user:", user.id);
            (supabase.rpc as any)("increment_islamic_queries", { p_user_id: user.id })
              .then(({ error }: any) => { if (!error) refetch(); });
          }
          // Auto-save session after stream completes
          setMessages((prev) => {
            saveSession(prev, newCitations);
            return prev;
          });
        },
        onError: (err) => { toast.error(err); setIsQuerying(false); },
      });
      return;
    }

    // --- General mode ---
    if (researchLimitReached) { toast.error(t("research.limit_reached")); return; }

    const userMsg: ChatMessage = { role: "user", content: query };
    const prevMessages = [...messages];
    setMessages((prev) => [...prev, userMsg]);
    setQuery("");
    setIsQuerying(true);
    setSourcesReadyInfo(null);

    let assistantSoFar = "";
    const upsertAssistant = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    await streamResearchQuery({
      query: userMsg.content,
      sources,
      strictMode,
      chatHistory: prevMessages,
      onDelta: upsertAssistant,
      onDone: () => {
        setIsQuerying(false);
        if (user) {
          if (import.meta.env.DEV) console.log("[Research] Incrementing research_queries_used for user:", user.id);
          // Use atomic RPC to avoid race conditions (multiple tabs / concurrent requests)
          (supabase.rpc as any)("increment_research_queries", { p_user_id: user.id })
            .then(({ error }: any) => { if (!error) refetch(); });
        }
      },
      onError: (err) => { toast.error(err); setIsQuerying(false); },
    });
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
    } catch (err: any) {
      toast.error(err.message || t("research.refine_error"));
    } finally {
      setIsRefining(false);
    }
  };

  const handleCopyOutput = () => {
    if (!lastAssistantMessage) return;
    navigator.clipboard.writeText(lastAssistantMessage.content);
    toast.success(t("research.copied"));
  };

  const handleDownloadReport = () => {
    // Export as Markdown for better readability
    const sourceList = sources.length > 0
      ? `## Sources\n${sources.map((s) => `- ${s.title}${s.url ? ` (${s.url})` : ""}`).join("\n")}\n\n`
      : "";
    const body = messages.map((m) =>
      m.role === "user"
        ? `## Question\n${m.content}`
        : `## Answer\n${m.content}`
    ).join("\n\n---\n\n");
    const report = `# Research Report\n_Generated: ${new Date().toLocaleString()}_\n\n${sourceList}${body}`;
    const blob = new Blob([report], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `research-report-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("research.report_downloaded"));
  };

  const handleClearChat = async () => {
    // Delete the current session from DB if one exists (silent if table missing)
    if (user && sessionIdRef.current) {
      try {
        await (supabase.from as any)("research_sessions")
          .delete()
          .eq("id", sessionIdRef.current)
          .eq("user_id", user.id);
      } catch {
        // Ignore — table may not be migrated yet
      }
    }
    sessionIdRef.current = null;
    setMessages([]);
    setCitations([]);
    setSourcesReadyInfo(null);
    toast.success(t("research.chat_cleared"));
  };

  const handleRegenerate = async () => {
    // Find the last user message and re-send it
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg || !session?.access_token) return;

    const limitReached = mode === "islamic" ? islamicLimitReached : researchLimitReached;
    if (limitReached) { toast.error(t("research.limit_reached")); return; }

    // Remove the last assistant response and re-query
    const messagesWithoutLastAssistant = messages.slice(
      0,
      messages.length - 1 - lastAssistantIdx >= 0
        ? messages.length - 1 - lastAssistantIdx
        : messages.length
    );
    const prevMessages = messagesWithoutLastAssistant.slice(0, -1); // history before the last user msg
    setMessages(messagesWithoutLastAssistant);
    setIsQuerying(true);
    setSourcesReadyInfo(null);

    let assistantSoFar = "";
    const upsertAssistant = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    if (mode === "islamic") {
      let newCitationsRegen: CitationItem[] = [];
      await streamIslamicQuery({
        query: lastUserMsg.content,
        selectedDomains: islamicDomains,
        selectedLanguages: islamicLanguages,
        strictMode,
        chatHistory: prevMessages,
        tier,
        onDelta: upsertAssistant,
        onSourcesReady: (count, domains, fetchedCitations) => {
          setSourcesReadyInfo({ count, domains });
          const merged = [...citations];
          for (const c of fetchedCitations) {
            const key = c.url ?? `${c.domain}-${JSON.stringify(c.citation_ref)}`;
            if (!merged.some((m) => (m.url ?? `${m.domain}-${JSON.stringify(m.citation_ref)}`) === key)) {
              merged.push(c);
            }
          }
          newCitationsRegen = merged;
          setCitations(merged);
        },
        onDone: () => {
          setIsQuerying(false);
          if (user) {
            (supabase.rpc as any)("increment_islamic_queries", { p_user_id: user.id })
              .then(({ error }: any) => { if (!error) refetch(); });
          }
          setMessages((prev) => { saveSession(prev, newCitationsRegen); return prev; });
        },
        onError: (err) => { toast.error(err); setIsQuerying(false); },
      });
    } else {
      await streamResearchQuery({
        query: lastUserMsg.content,
        sources,
        strictMode,
        chatHistory: prevMessages,
        onDelta: upsertAssistant,
        onDone: () => {
          setIsQuerying(false);
          if (user) {
            (supabase.rpc as any)("increment_research_queries", { p_user_id: user.id })
              .then(({ error }: any) => { if (!error) refetch(); });
          }
        },
        onError: (err) => { toast.error(err); setIsQuerying(false); },
      });
    }
  };

  // ── PDF Bibliography export (Ultra only) ─────────────────────────────────
  // Generates a plain-text bibliography markdown file from accumulated citations.
  // Named "bibliography" because Ultra users can use it as a reference list.
  const handleExportBibliography = () => {
    if (citations.length === 0) return;

    const lines: string[] = [
      "# Islamic Research Bibliography",
      `_Generated: ${new Date().toLocaleString()}_`,
      `_Session mode: Islamic Scholarly Research_`,
      "",
    ];

    // Group by domain
    const groups: Record<string, typeof citations> = {};
    for (const c of citations) {
      if (!groups[c.domain]) groups[c.domain] = [];
      groups[c.domain].push(c);
    }

    const DOMAIN_LABEL: Record<string, string> = {
      dorar:           "Dorar.net — Hadith",
      sunnah:          "Sunnah.com — Hadith",
      "hadith-index":  "Hadith Index (Pre-Indexed Corpus)",
      alquran:         "AlQuran.cloud — Quran",
      "quran-com":     "Quran.com — Quran",
      tanzil:          "Tanzil — Canonical Quran Text",
      islamqa:         "IslamQA.info — Fatawa",
      islamweb:        "IslamWeb.net — Fatawa",
      "dar-alifta":    "Dar-Alifta.org — Fatawa",
      "shamela-index": "Al-Maktaba Al-Shamela — Classical Texts",
      "openiti-index": "OpenITI — Classical Arabic Corpus",
    };

    for (const [domain, items] of Object.entries(groups)) {
      lines.push(`## ${DOMAIN_LABEL[domain] ?? domain}`);
      for (const c of items) {
        const ref = c.citation_ref;
        const parts: string[] = [];

        // Hadith
        if (ref.book || ref.hadith_number != null) {
          if (ref.book) parts.push(ref.book);
          if (ref.hadith_number != null) parts.push(`Hadith No. ${ref.hadith_number}`);
          if (ref.grade) parts.push(`Grade: ${ref.grade}`);
          if (ref.rawi) parts.push(`Narrated by: ${ref.rawi}`);
        }
        // Quran
        else if (ref.surah_number != null) {
          const surahStr = ref.surah_name_en
            ? `${ref.surah_name_en} (${ref.surah_name ?? ""})`
            : (ref.surah_name ?? `Surah ${ref.surah_number}`);
          parts.push(surahStr);
          if (ref.verse != null) parts.push(`${ref.surah_number}:${ref.verse}`);
          if (ref.juz) parts.push(`Juz ${ref.juz}`);
        }
        // Fatwa
        else if (ref.fatwa_number || ref.scholar) {
          if (ref.fatwa_number) parts.push(`Fatwa No. ${ref.fatwa_number}`);
          if (ref.scholar) parts.push(`Scholar: ${ref.scholar}`);
        }
        // Classical
        else if (ref.author || ref.title) {
          if (ref.author) parts.push(ref.author);
          if (ref.title) parts.push(ref.title);
          if (ref.volume != null) parts.push(`Vol. ${ref.volume}`);
          if (ref.page != null) parts.push(`P. ${ref.page}`);
        }

        const citationStr = parts.join(", ");
        const urlStr = c.url ? ` — ${c.url}` : "";
        lines.push(`- ${citationStr}${urlStr}`);
      }
      lines.push("");
    }

    const content = lines.join("\n");
    const blob = new Blob([content], { type: "text/markdown; charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bibliography-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("research.bibliography_exported"));
  };

  // Determine which limit to show in ChatDisplay
  const activeLimitReached = mode === "islamic" ? islamicLimitReached : researchLimitReached;

  return (
    <AppLayout>
      <div className="flex flex-col lg:flex-row h-[calc(100vh-3.5rem-5rem)] md:h-[calc(100vh-3.5rem)] lg:h-[calc(100vh-3.5rem)] overflow-hidden">
        <SourcesPanel
          sources={sources}
          urlInput={urlInput}
          onUrlInputChange={setUrlInput}
          isAddingUrl={isAddingUrl}
          isUploading={isUploading}
          fileInputRef={fileInputRef}
          onAddUrl={handleAddUrl}
          onFileUpload={handleFileUpload}
          onFileDrop={processFile}
          onDeleteSource={handleDeleteSource}
          onDeleteAllSources={handleDeleteAllSources}
          strictMode={strictMode}
          onStrictModeChange={setStrictMode}
          researchQueriesUsed={researchQueriesUsed}
          researchQueriesLimit={researchQueriesLimit}
          researchLimitReached={researchLimitReached}
          showUsageMeter={(subscription?.research_queries_limit ?? 0) > 0}
          mode={mode}
          onModeChange={handleModeChange}
          islamicDomains={islamicDomains}
          onIslamicDomainsChange={handleIslamicDomainsChange}
          islamicLanguages={islamicLanguages}
          onIslamicLanguagesChange={handleIslamicLanguagesChange}
          islamicQueriesUsed={islamicQueriesUsed}
          islamicQueriesLimit={islamicQueriesLimit}
          tier={tier}
          t={t}
        />
        <ChatDisplay
          messages={messages}
          isQuerying={isQuerying}
          query={query}
          onQueryChange={setQuery}
          onSendQuery={handleSendQuery}
          isRefining={isRefining}
          lastAssistantIdx={lastAssistantIdx}
          onRefine={handleRefine}
          onCopyOutput={handleCopyOutput}
          onDownloadReport={handleDownloadReport}
          onClearChat={handleClearChat}
          onRegenerate={handleRegenerate}
          sources={sources}
          researchLimitReached={activeLimitReached}
          chatEndRef={chatEndRef}
          t={t}
          mode={mode}
          sourcesReadyInfo={sourcesReadyInfo}
          citations={citations}
          onExportBibliography={handleExportBibliography}
          canExportBibliography={tier === "ultra" && mode === "islamic"}
        />
      </div>
    </AppLayout>
  );
};

export default Research;
