import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Link2, Upload, FileText, Trash2, Plus, Send, Loader2, Download, BookOpen,
  Globe, Lock, Copy, Check, Sparkles, PenLine, MessageSquare, Minimize2, FileDown
} from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";

interface Source {
  id: string;
  source_type: "url" | "pdf" | "docx";
  title: string;
  url?: string;
  storage_path?: string;
  created_at: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// --- Drag-and-drop zone component ---
const DropZone = ({
  onFileDrop, isUploading, t,
}: {
  onFileDrop: (file: File) => void; isUploading: boolean; t: (k: string) => string;
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const handleDrag = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); }, []);
  const handleDragIn = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer.items?.length) setIsDragOver(true); }, []);
  const handleDragOut = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFileDrop(file);
  }, [onFileDrop]);

  return (
    <motion.div
      onDragEnter={handleDragIn} onDragLeave={handleDragOut} onDragOver={handleDrag} onDrop={handleDrop}
      animate={{
        borderColor: isDragOver ? "hsl(var(--primary))" : "hsl(var(--border))",
        backgroundColor: isDragOver ? "hsl(var(--primary) / 0.08)" : "transparent",
        scale: isDragOver ? 1.02 : 1,
      }}
      transition={{ duration: 0.2 }}
      className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer"
    >
      {isUploading ? (
        <Loader2 className="h-5 w-5 animate-spin mx-auto text-primary" />
      ) : (
        <>
          <Upload className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
          <p className="text-xs text-muted-foreground">{t("research.drop_hint")}</p>
        </>
      )}
    </motion.div>
  );
};

// --- SSE stream parser ---
async function streamResearchQuery({
  query, sources, strictMode, chatHistory, onDelta, onDone, onError,
}: {
  query: string; sources: Source[]; strictMode: boolean; chatHistory: ChatMessage[];
  onDelta: (text: string) => void; onDone: () => void; onError: (err: string) => void;
}) {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/research-query`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
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

// --- Document Box with refinement toolbar ---
const DocumentBox = ({
  content, isRefining, onRefine, onCopy, onDownload, t,
}: {
  content: string; isRefining: boolean;
  onRefine: (action: string) => void; onCopy: () => void; onDownload: () => void;
  t: (k: string) => string;
}) => {
  const isRtl = /[\u0600-\u06FF]/.test(content.slice(0, 100));

  return (
    <div className="relative rounded-xl border border-border bg-card shadow-md overflow-hidden" style={{ boxShadow: "0 4px 24px -4px hsl(var(--foreground) / 0.08)" }}>
      {/* Floating Toolbar */}
      <div className="flex items-center gap-1.5 p-2 border-b border-border bg-muted/50 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground mr-1 flex items-center gap-1">
          <Sparkles className="h-3.5 w-3.5" />
          {t("research.ai_tools")}
        </span>
        <Separator orientation="vertical" className="h-5" />
        {[
          { action: "formalize", icon: PenLine, label: t("research.formalize") },
          { action: "humanize", icon: MessageSquare, label: t("research.humanize") },
          { action: "shorten", icon: Minimize2, label: t("research.shorten") },
          { action: "citations", icon: BookOpen, label: t("research.add_sources") },
        ].map((btn) => (
          <Button
            key={btn.action}
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            disabled={isRefining}
            onClick={() => onRefine(btn.action)}
          >
            <btn.icon className="h-3 w-3" />
            {btn.label}
          </Button>
        ))}
      </div>

      {/* Refining overlay */}
      {isRefining && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm transition-opacity duration-300">
          <div className="flex items-center gap-2 text-primary">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm font-medium">{t("research.refining")}</span>
          </div>
        </div>
      )}

      {/* Document content - A4 paper feel */}
      <div
        dir={isRtl ? "rtl" : "ltr"}
        className={cn(
          "px-8 py-6 prose prose-sm dark:prose-invert max-w-none min-h-[250px] leading-relaxed",
          isRtl && "text-right"
        )}
      >
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>

      {/* Bottom actions */}
      <div className="flex items-center justify-end gap-2 p-3 border-t border-border">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onCopy}>
          <Copy className="h-3.5 w-3.5" />
          {t("research.copy")}
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onDownload}>
          <FileDown className="h-3.5 w-3.5" />
          {t("research.download_report")}
        </Button>
      </div>
    </div>
  );
};

const Research = () => {
  const { user, session } = useAuth();
  const { t } = useLanguage();

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

  // Get the latest assistant message for the Document Box
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
    } catch (err: any) { toast.error(err.message || t("research.upload_error")); }
    finally { setIsUploading(false); }
  }, [user, loadSources, t]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ""; if (file) processFile(file);
  };

  const handleAddUrl = async () => {
    if (!urlInput.trim() || !user) return;
    let url = urlInput.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://" + url;
    setIsAddingUrl(true);
    try {
      const title = new URL(url).hostname.replace("www.", "");
      const { error } = await supabase.from("research_sources").insert({ user_id: user.id, source_type: "url", title, url });
      if (error) throw error;
      setUrlInput("");
      await loadSources();
      toast.success(t("research.source_added"));
    } catch (err: any) { toast.error(err.message || t("research.add_error")); }
    finally { setIsAddingUrl(false); }
  };

  const handleDeleteSource = async (source: Source) => {
    try {
      if (source.storage_path) await supabase.storage.from("research-files").remove([source.storage_path]);
      await supabase.from("research_sources").delete().eq("id", source.id);
      setSources((prev) => prev.filter((s) => s.id !== source.id));
      toast.success(t("research.source_removed"));
    } catch { toast.error(t("research.delete_error")); }
  };

  // --- AI Query with streaming ---
  const handleSendQuery = async () => {
    if (!query.trim() || !session?.access_token) return;
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
      onDone: () => setIsQuerying(false),
      onError: (err) => { toast.error(err); setIsQuerying(false); },
    });
  };

  // --- Refinement using existing refine-text edge function ---
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
        const doneKey = `research.${action}_done` as string;
        toast.success(t(doneKey));
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
    a.href = url; a.download = `research-report-${Date.now()}.txt`; a.click();
    URL.revokeObjectURL(url);
    toast.success(t("research.report_downloaded"));
  };

  const sourceIcon = (type: string) => (type === "url" ? Link2 : FileText);
  const isRtlText = /[\u0600-\u06FF]/.test(query.slice(0, 50));

  return (
    <AppLayout>
      <div className="flex flex-col lg:flex-row h-[calc(100vh-3.5rem)] md:h-[calc(100vh)] overflow-hidden">
        {/* Sources Panel */}
        <div className="lg:w-80 border-b lg:border-b-0 lg:border-e border-border bg-card flex flex-col">
          <div className="p-4 border-b border-border">
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" />
              {t("research.sources")}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">{t("research.sources_hint")}</p>
          </div>

          <div className="p-3 space-y-2 border-b border-border">
            <div className="flex gap-2">
              <Input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="https://example.com" className="text-sm" onKeyDown={(e) => e.key === "Enter" && handleAddUrl()} />
              <Button size="icon" onClick={handleAddUrl} disabled={isAddingUrl || !urlInput.trim()}>
                {isAddingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </Button>
            </div>
            <DropZone onFileDrop={processFile} isUploading={isUploading} t={t} />
            <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
              {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {t("research.upload_file")}
            </Button>
            <input ref={fileInputRef} type="file" accept=".pdf,.docx" onChange={handleFileUpload} className="hidden" />
          </div>

          <ScrollArea className="flex-1 max-h-48 lg:max-h-none">
            <div className="p-3 space-y-1.5">
              <AnimatePresence>
                {sources.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">{t("research.no_sources")}</p>
                ) : (
                  sources.map((source) => {
                    const Icon = sourceIcon(source.source_type);
                    return (
                      <motion.div key={source.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex items-center gap-2 rounded-lg border border-border p-2 bg-background">
                        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm text-foreground truncate flex-1">{source.title}</span>
                        <Badge variant="secondary" className="text-[10px] shrink-0">{source.source_type.toUpperCase()}</Badge>
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => handleDeleteSource(source)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </motion.div>
                    );
                  })
                )}
              </AnimatePresence>
            </div>
          </ScrollArea>

          <div className="p-3 border-t border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {strictMode ? <Lock className="h-4 w-4 text-primary" /> : <Globe className="h-4 w-4 text-primary" />}
                <Label htmlFor="mode-toggle" className="text-sm font-medium text-foreground">
                  {strictMode ? t("research.strict_mode") : t("research.extended_mode")}
                </Label>
              </div>
              <Switch id="mode-toggle" checked={!strictMode} onCheckedChange={(v) => setStrictMode(!v)} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {strictMode ? t("research.strict_desc") : t("research.extended_desc")}
            </p>
          </div>
        </div>

        {/* Main Panel */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h1 className="text-xl font-bold text-foreground">{t("research.title")}</h1>
            {messages.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleDownloadReport}>
                <Download className="h-3.5 w-3.5 mr-1" />
                {t("research.download_report")}
              </Button>
            )}
          </div>

          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4 max-w-3xl mx-auto">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <BookOpen className="h-12 w-12 text-muted-foreground/40 mb-4" />
                  <h3 className="text-lg font-medium text-foreground">{t("research.welcome")}</h3>
                  <p className="text-sm text-muted-foreground mt-1 max-w-sm">{t("research.welcome_hint")}</p>
                </div>
              )}

              {messages.map((msg, i) => {
                const isLastAssistant = msg.role === "assistant" && i === messages.length - 1 - lastAssistantIdx;

                if (msg.role === "user") {
                  const isRtl = /[\u0600-\u06FF]/.test(msg.content.slice(0, 100));
                  return (
                    <div key={i} className="flex justify-end">
                      <div className="rounded-2xl px-4 py-2.5 max-w-[85%] text-sm bg-primary text-primary-foreground">
                        <div dir={isRtl ? "rtl" : "ltr"} className={cn("whitespace-pre-wrap", isRtl && "text-right")}>
                          {msg.content}
                        </div>
                      </div>
                    </div>
                  );
                }

                // Show Document Box for the latest assistant message
                if (isLastAssistant) {
                  return (
                    <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                      <DocumentBox
                        content={msg.content}
                        isRefining={isRefining}
                        onRefine={handleRefine}
                        onCopy={handleCopyOutput}
                        onDownload={handleDownloadReport}
                        t={t}
                      />
                    </motion.div>
                  );
                }

                // Older assistant messages rendered simply
                const isRtl = /[\u0600-\u06FF]/.test(msg.content.slice(0, 100));
                return (
                  <div key={i} className="flex justify-start">
                    <div className="rounded-2xl px-4 py-2.5 max-w-[85%] text-sm bg-muted text-foreground border border-border">
                      <div dir={isRtl ? "rtl" : "ltr"} className={cn("prose prose-sm dark:prose-invert max-w-none", isRtl && "text-right")}>
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                );
              })}

              {isQuerying && messages[messages.length - 1]?.role !== "assistant" && (
                <div className="flex justify-start">
                  <div className="rounded-2xl px-4 py-3 bg-muted border border-border flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-xs text-muted-foreground">{t("research.thinking")}</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          </ScrollArea>

          <div className="p-4 border-t border-border">
            <div className="flex gap-2 max-w-3xl mx-auto">
              <Textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("research.ask_placeholder")}
                dir={isRtlText ? "rtl" : "ltr"}
                className={cn("min-h-[44px] max-h-32 resize-none flex-1", isRtlText && "text-right")}
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendQuery(); }
                }}
              />
              <Button onClick={handleSendQuery} disabled={!query.trim() || isQuerying} size="icon" className="shrink-0 h-11 w-11">
                {isQuerying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Research;
