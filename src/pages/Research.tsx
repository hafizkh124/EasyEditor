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

// --- SSE stream parser ---
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

const Research = () => {
  const { user, session } = useAuth();
  const { t } = useLanguage();
  const { subscription, refetch } = useSubscription();

  const researchQueriesUsed = subscription?.research_queries_used ?? 0;
  const researchQueriesLimit = subscription?.research_queries_limit ?? 3;
  const researchLimitReached = subscription?.tier === "free" && researchQueriesUsed >= researchQueriesLimit;

  const [sources, setSources] = useState<Source[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState("");
  const [isQuerying, setIsQuerying] = useState(false);
  const [strictMode, setStrictMode] = useState(true);
  const [isRefining, setIsRefining] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => { loadSources(); }, [loadSources]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isQuerying]);

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

  const handleSendQuery = async () => {
    if (!query.trim() || !session?.access_token) return;
    if (researchLimitReached) { toast.error(t("research.limit_reached")); return; }

    const userMsg: ChatMessage = { role: "user", content: query };
    const prevMessages = [...messages];
    setMessages((prev) => [...prev, userMsg]);
    setQuery("");
    setIsQuerying(true);

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
          supabase
            .from("subscriptions")
            .update({ research_queries_used: researchQueriesUsed + 1 })
            .eq("user_id", user.id)
            .then(({ error }) => { if (!error) refetch(); });
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
    const report = messages.map((m) => `${m.role === "user" ? "Q" : "A"}: ${m.content}`).join("\n\n");
    const blob = new Blob([report], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `research-report-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("research.report_downloaded"));
  };

  return (
    <AppLayout>
      <div className="flex flex-col lg:flex-row h-[calc(100vh-3.5rem)] md:h-[calc(100vh)] overflow-hidden">
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
          strictMode={strictMode}
          onStrictModeChange={setStrictMode}
          researchQueriesUsed={researchQueriesUsed}
          researchQueriesLimit={researchQueriesLimit}
          researchLimitReached={researchLimitReached}
          showUsageMeter={subscription?.tier === "free"}
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
          researchLimitReached={researchLimitReached}
          chatEndRef={chatEndRef}
          t={t}
        />
      </div>
    </AppLayout>
  );
};

export default Research;
