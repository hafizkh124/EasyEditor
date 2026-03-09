import { useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Link2, Upload, FileText, Trash2, Plus, Send, Loader2, Download, BookOpen,
  Globe, Lock, X
} from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

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

const Research = () => {
  const { user, session } = useAuth();
  const { t } = useLanguage();

  // Sources state
  const [sources, setSources] = useState<Source[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [activeTab, setActiveTab] = useState("sources");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState("");
  const [isQuerying, setIsQuerying] = useState(false);
  const [strictMode, setStrictMode] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Load sources on mount
  const loadSources = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("research_sources")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (data) setSources(data as Source[]);
  }, [user]);

  useState(() => {
    loadSources();
  });

  // Add URL source
  const handleAddUrl = async () => {
    if (!urlInput.trim() || !user) return;
    let url = urlInput.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }

    setIsAddingUrl(true);
    try {
      const title = new URL(url).hostname.replace("www.", "");
      const { error } = await supabase.from("research_sources").insert({
        user_id: user.id,
        source_type: "url",
        title,
        url,
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

  // Upload file
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    e.target.value = "";

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["pdf", "docx"].includes(ext || "")) {
      toast.error(t("research.invalid_file"));
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error(t("research.file_too_large"));
      return;
    }

    setIsUploading(true);
    try {
      const filePath = `${user.id}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("research-files")
        .upload(filePath, file);
      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase.from("research_sources").insert({
        user_id: user.id,
        source_type: ext as "pdf" | "docx",
        title: file.name,
        storage_path: filePath,
      });
      if (dbError) throw dbError;

      await loadSources();
      toast.success(t("research.source_added"));
    } catch (err: any) {
      toast.error(err.message || t("research.upload_error"));
    } finally {
      setIsUploading(false);
    }
  };

  // Delete source
  const handleDeleteSource = async (source: Source) => {
    try {
      if (source.storage_path) {
        await supabase.storage.from("research-files").remove([source.storage_path]);
      }
      await supabase.from("research_sources").delete().eq("id", source.id);
      setSources((prev) => prev.filter((s) => s.id !== source.id));
      toast.success(t("research.source_removed"));
    } catch {
      toast.error(t("research.delete_error"));
    }
  };

  // Send query (placeholder for now — will be wired to edge function in next step)
  const handleSendQuery = async () => {
    if (!query.trim() || !session?.access_token) return;
    const userMsg: ChatMessage = { role: "user", content: query };
    setMessages((prev) => [...prev, userMsg]);
    setQuery("");
    setIsQuerying(true);

    try {
      // For now show a placeholder — the edge function will be built next
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: t("research.coming_soon_msg"),
      };
      setTimeout(() => {
        setMessages((prev) => [...prev, assistantMsg]);
        setIsQuerying(false);
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 1000);
    } catch {
      setIsQuerying(false);
      toast.error(t("research.query_error"));
    }
  };

  const handleDownloadReport = () => {
    const report = messages
      .map((m) => `${m.role === "user" ? "Q" : "A"}: ${m.content}`)
      .join("\n\n");
    const blob = new Blob([report], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `research-report-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("research.report_downloaded"));
  };

  const sourceIcon = (type: string) => {
    if (type === "url") return Link2;
    if (type === "pdf") return FileText;
    return FileText;
  };

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

          {/* Add URL */}
          <div className="p-3 space-y-2 border-b border-border">
            <div className="flex gap-2">
              <Input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://example.com"
                className="text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleAddUrl()}
              />
              <Button size="icon" onClick={handleAddUrl} disabled={isAddingUrl || !urlInput.trim()}>
                {isAddingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {t("research.upload_file")}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>

          {/* Source List */}
          <ScrollArea className="flex-1 max-h-48 lg:max-h-none">
            <div className="p-3 space-y-1.5">
              <AnimatePresence>
                {sources.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    {t("research.no_sources")}
                  </p>
                ) : (
                  sources.map((source) => {
                    const Icon = sourceIcon(source.source_type);
                    return (
                      <motion.div
                        key={source.id}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex items-center gap-2 rounded-lg border border-border p-2 bg-background"
                      >
                        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm text-foreground truncate flex-1">{source.title}</span>
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          {source.source_type.toUpperCase()}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeleteSource(source)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </motion.div>
                    );
                  })
                )}
              </AnimatePresence>
            </div>
          </ScrollArea>

          {/* Mode Toggle */}
          <div className="p-3 border-t border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {strictMode ? (
                  <Lock className="h-4 w-4 text-primary" />
                ) : (
                  <Globe className="h-4 w-4 text-primary" />
                )}
                <Label htmlFor="mode-toggle" className="text-sm font-medium text-foreground">
                  {strictMode ? t("research.strict_mode") : t("research.extended_mode")}
                </Label>
              </div>
              <Switch
                id="mode-toggle"
                checked={!strictMode}
                onCheckedChange={(v) => setStrictMode(!v)}
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {strictMode ? t("research.strict_desc") : t("research.extended_desc")}
            </p>
          </div>
        </div>

        {/* Chat Panel */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Chat Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h1 className="text-xl font-bold text-foreground">{t("research.title")}</h1>
            {messages.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleDownloadReport}>
                <Download className="h-3.5 w-3.5" />
                {t("research.download_report")}
              </Button>
            )}
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4 max-w-3xl mx-auto">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <BookOpen className="h-12 w-12 text-muted-foreground/40 mb-4" />
                  <h3 className="text-lg font-medium text-foreground">{t("research.welcome")}</h3>
                  <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                    {t("research.welcome_hint")}
                  </p>
                </div>
              )}
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex",
                    msg.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "rounded-2xl px-4 py-2.5 max-w-[85%] text-sm whitespace-pre-wrap",
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground border border-border"
                    )}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {isQuerying && (
                <div className="flex justify-start">
                  <div className="rounded-2xl px-4 py-2.5 bg-muted border border-border">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          </ScrollArea>

          {/* Input */}
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
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendQuery();
                  }
                }}
              />
              <Button
                onClick={handleSendQuery}
                disabled={!query.trim() || isQuerying}
                size="icon"
                className="shrink-0 h-11 w-11"
              >
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
