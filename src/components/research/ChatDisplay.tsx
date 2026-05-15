import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useEffect, useMemo, useRef } from "react";
import {
  Send, Loader2, BookOpen, Copy, Sparkles,
  PenLine, MessageSquare, Minimize2, MessageSquarePlus, RefreshCw,
  AlertCircle, BookMarked, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isRtlText as detectRtl } from "@/utils/textUtils";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import type { ChatMessage } from "./types";
import type { Source } from "./types";
import CitationPanel, { type CitationItem } from "./CitationPanel";
import SpellingResponse from "./SpellingResponse";
import CitationResponse from "./CitationResponse";
import ModeChips from "./ModeChips";
import VirtualMessageList from "./VirtualMessageList";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
import type { ResearchAssistMode } from "@/lib/prompts";
import type { ResearchMode } from "./ResearchModeSwitcher";

// SPEC-v2 NFR-2: virtualize the chat once it grows large. Below this threshold
// the flat render is faster and keeps markdown layout simple for the common case.
const VIRTUALIZE_THRESHOLD = 50;

interface DocumentBoxProps {
  content: string;
  isRefining: boolean;
  onRefine: (action: string) => void;
  onCopy: () => void;
  onRegenerate?: () => void;
  t: (k: string) => string;
}

const DocumentBox = ({ content, isRefining, onRefine, onCopy, onRegenerate, t }: DocumentBoxProps) => {
  const isRtl = detectRtl(content);

  return (
    <div
      className="relative rounded-xl border border-border bg-card shadow-md overflow-hidden"
      style={{ boxShadow: "0 4px 24px -4px hsl(var(--foreground) / 0.08)" }}
    >
      <div className="flex items-center gap-1.5 p-2 border-b border-border bg-muted/50 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground mr-1 flex items-center gap-1">
          <Sparkles className="h-3.5 w-3.5" />
          {t("research.ai_tools")}
        </span>
        <Separator orientation="vertical" className="h-5" />
        {[
          { action: "formalize", icon: PenLine,      label: t("research.formalize") },
          { action: "humanize",  icon: MessageSquare, label: t("research.humanize") },
          { action: "shorten",   icon: Minimize2,     label: t("research.shorten") },
          { action: "citations", icon: BookOpen,      label: t("research.add_sources") },
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

      {isRefining && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm transition-opacity duration-300">
          <div className="flex items-center gap-2 text-primary">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm font-medium">{t("research.refining")}</span>
          </div>
        </div>
      )}

      <div
        dir={isRtl ? "rtl" : "ltr"}
        className={cn(
          "px-4 py-5 sm:px-8 sm:py-6 prose prose-sm dark:prose-invert max-w-none min-h-[250px] leading-relaxed",
          isRtl && "text-right"
        )}
      >
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>

      <div className="flex items-center justify-between gap-2 p-3 border-t border-border flex-wrap">
        <div className="flex items-center gap-2">
          {onRegenerate && (
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={onRegenerate} disabled={isRefining}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t("research.regenerate")}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onCopy}>
            <Copy className="h-3.5 w-3.5" />
            {t("research.copy")}
          </Button>
        </div>
      </div>
    </div>
  );
};

// ── SourcesReadyIndicator ─────────────────────────────────────────────────────
// Shows a small banner once islamic-search emits the sources_ready SSE event,
// giving the user feedback that sources have been fetched before Gemini streams.
interface SourcesReadyIndicatorProps {
  count: number;
  domains: string[];
  t: (k: string) => string;
}

const DOMAIN_SHORT: Record<string, string> = {
  dorar:           "Dorar",
  sunnah:          "Sunnah",
  "hadith-index":  "Hadith Index",
  alquran:         "AlQuran",
  "quran-com":     "Quran.com",
  tanzil:          "Tanzil",
  islamqa:         "IslamQA",
  islamweb:        "IslamWeb",
  "dar-alifta":    "Dar-Alifta",
  "shamela-index": "Shamela",
  "openiti-index": "OpenITI",
};

const SourcesReadyIndicator = ({ count, domains, t }: SourcesReadyIndicatorProps) => {
  if (count === 0) return null;
  const domainLabels = domains.map((d) => DOMAIN_SHORT[d] ?? d).join(" · ");
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-2 rounded-lg border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400"
    >
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
      <span>
        <span className="font-semibold">{count}</span>{" "}
        {t("research.sources_fetched")}
        {domainLabels && (
          <span className="text-emerald-600 dark:text-emerald-500 ml-1">
            — {domainLabels}
          </span>
        )}
      </span>
    </motion.div>
  );
};

interface ChatDisplayProps {
  messages: ChatMessage[];
  isQuerying: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  onSendQuery: () => void;
  isRefining: boolean;
  lastAssistantIdx: number;
  onRefine: (action: string) => void;
  onCopyOutput: () => void;
  onDownloadReport: () => void;
  onClearChat: () => void;
  onRegenerate: () => void;
  sources: Source[];
  researchLimitReached: boolean;
  chatEndRef: React.RefObject<HTMLDivElement>;
  t: (k: string) => string;
  // Phase 3 additions
  mode?: ResearchMode;
  sourcesReadyInfo?: { count: number; domains: string[] } | null;
  citations?: CitationItem[];
  // Phase 4
  onExportBibliography?: () => void;
  canExportBibliography?: boolean;
  // Phase 3 assist chips
  assistModes?: ResearchAssistMode[];
  onAssistModesChange?: (modes: ResearchAssistMode[]) => void;
}

const ChatDisplay = ({
  messages,
  isQuerying,
  query,
  onQueryChange,
  onSendQuery,
  isRefining,
  lastAssistantIdx,
  onRefine,
  onCopyOutput,
  onDownloadReport,
  onClearChat,
  onRegenerate,
  sources,
  researchLimitReached,
  chatEndRef: _chatEndRef,
  t,
  mode = "general",
  sourcesReadyInfo,
  citations = [],
  onExportBibliography,
  canExportBibliography = false,
  assistModes = [],
  onAssistModesChange,
}: ChatDisplayProps) => {
  const isRtlQuery = detectRtl(query);
  const guard = useSubmitGuard(500);
  const guardedSendQuery = guard(onSendQuery);

  const copyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
    toast.success(t("research.copy_message"));
  };

  // Show sources indicator when we have fetched sources AND are still querying
  const showSourcesIndicator = mode === "islamic" && sourcesReadyInfo != null && sourcesReadyInfo.count > 0;

  // In Islamic/General mode, suppress the "no sources" warning.
  // Only warn in Custom (user-provided sources) mode when empty.
  const showNoSourcesWarning = mode === "custom" && sources.length === 0;

  type ListItem =
    | { type: "empty" }
    | { type: "citations" }
    | { type: "message"; index: number; msg: ChatMessage }
    | { type: "sources_ready" }
    | { type: "typing" }
    | { type: "spacer" };

  const listItems = useMemo(() => {
    const items: ListItem[] = [];
    if (messages.length === 0) {
      items.push({ type: "empty" });
    }
    if (mode === "islamic" && citations.length > 0) {
      items.push({ type: "citations" });
    }
    messages.forEach((msg, i) => {
      items.push({ type: "message", index: i, msg });
    });
    if (showSourcesIndicator && isQuerying) {
      items.push({ type: "sources_ready" });
    }
    if (isQuerying && messages[messages.length - 1]?.role !== "assistant") {
      items.push({ type: "typing" });
    }
    items.push({ type: "spacer" });
    return items;
  }, [messages, mode, citations.length, showSourcesIndicator, isQuerying]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest message on new content or while streaming.
  useEffect(() => {
    bottomAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isQuerying, listItems.length]);

  const renderItem = (item: ListItem, index: number) => {
    let content: React.ReactNode = null;

    if (item.type === "empty") {
      content = (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <BookOpen className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-medium text-foreground">
            {mode === "islamic" ? t("research.welcome_islamic") : t("research.welcome")}
          </h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            {mode === "islamic"
              ? t("research.welcome_islamic_hint")
              : mode === "general"
                ? t("research.welcome_general_hint")
                : t("research.welcome_hint")}
          </p>
        </div>
      );
    } else if (item.type === "citations") {
      content = <CitationPanel citations={citations} t={t} />;
    } else if (item.type === "message") {
      const msg = item.msg;
      const isLastAssistant = msg.role === "assistant" && item.index === messages.length - 1 - lastAssistantIdx;

      if (msg.role === "user") {
        const isRtl = detectRtl(msg.content);
        content = (
          <div className="flex justify-end">
            <div className="rounded-2xl px-4 py-2.5 max-w-[85%] text-sm bg-primary text-primary-foreground">
              <div dir={isRtl ? "rtl" : "ltr"} className={cn("whitespace-pre-wrap", isRtl && "text-right")}>
                {msg.content}
              </div>
            </div>
          </div>
        );
      } else if (msg.assist) {
        content = (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <div className="space-y-4 max-w-3xl">
              {msg.assist.promptKey === "spelling" && (
                <SpellingResponse original="" corrected={msg.assist.corrected} changes={msg.assist.changes} t={t} />
              )}
              {msg.assist.promptKey === "citations" && (
                <CitationResponse text={msg.assist.text} citations={msg.assist.citations} t={t} />
              )}
              {msg.assist.promptKey === "combined" && (
                <>
                  <SpellingResponse original="" corrected={msg.assist.corrected} changes={msg.assist.changes} t={t} />
                  <CitationResponse text={msg.assist.text} citations={msg.assist.citations} t={t} />
                </>
              )}
            </div>
          </motion.div>
        );
      } else if (isLastAssistant) {
        content = (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <DocumentBox
              content={msg.content}
              isRefining={isRefining}
              onRefine={onRefine}
              onCopy={onCopyOutput}
              
              onRegenerate={onRegenerate}
              t={t}
            />
          </motion.div>
        );
      } else {
        const isRtl = detectRtl(msg.content);
        content = (
          <div className="flex justify-start group">
            <div className="rounded-2xl px-4 py-2.5 max-w-[85%] text-sm bg-muted text-foreground border border-border relative">
              <div dir={isRtl ? "rtl" : "ltr"} className={cn("prose prose-sm dark:prose-invert max-w-none", isRtl && "text-right")}>
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
              <button
                onClick={() => copyMessage(msg.content)}
                className="absolute top-1.5 end-1.5 flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-background hover:text-foreground focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover:opacity-100"
                aria-label={t("research.copy")}
                title={t("research.copy")}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      }
    } else if (item.type === "sources_ready") {
      content = (
        <AnimatePresence>
          <SourcesReadyIndicator
            count={sourcesReadyInfo!.count}
            domains={sourcesReadyInfo!.domains}
            t={t}
          />
        </AnimatePresence>
      );
    } else if (item.type === "typing") {
      content = (
        <div className="flex justify-start">
          <div className="rounded-2xl px-4 py-3 bg-muted border border-border flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">
              {showSourcesIndicator
                ? t("research.generating_with_sources")
                : t("research.thinking")}
            </span>
          </div>
        </div>
      );
    } else if (item.type === "spacer") {
      content = <div className="h-4" />;
    }

    return (
      <div key={index} className="pb-4">
        {content}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h1 className="text-xl font-bold text-foreground">{t("research.title")}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onClearChat} className="gap-1.5">
            <MessageSquarePlus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("common.new_chat")}</span>
          </Button>
          {messages.length > 0 && canExportBibliography && onExportBibliography && citations.length > 0 && (
            <Button variant="outline" size="sm" onClick={onExportBibliography} className="gap-1.5">
              <BookMarked className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("research.export_bibliography")}</span>
            </Button>
          )}
        </div>
      </div>

      <div ref={scrollContainerRef} className={cn(
        "flex-1 w-full relative",
        listItems.length > VIRTUALIZE_THRESHOLD ? "overflow-hidden" : "overflow-y-auto p-4",
      )}>
        {listItems.length > VIRTUALIZE_THRESHOLD ? (
          <div className="absolute inset-0 px-4 py-4">
            <div className="max-w-3xl mx-auto h-full">
              <VirtualMessageList
                count={listItems.length}
                renderItem={(i) => renderItem(listItems[i], i)}
                getKey={(i) => {
                  const item = listItems[i];
                  if (item.type === "message") return `m:${item.index}:${item.msg.role}:${item.msg.content.length}`;
                  return `${item.type}:${i}`;
                }}
              />
              <div ref={bottomAnchorRef} />
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto">
            {listItems.map((item, index) => renderItem(item, index))}
            <div ref={bottomAnchorRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="p-4 border-t border-border space-y-2">
        {onAssistModesChange && (
          <div className="max-w-3xl mx-auto">
            <ModeChips modes={assistModes} onModesChange={onAssistModesChange} disabled={isQuerying} t={t} />
          </div>
        )}
        {showNoSourcesWarning && (
          <div className="flex items-center gap-2 max-w-3xl mx-auto rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-3 py-2">
            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
            <p className="text-xs text-amber-700 dark:text-amber-400">{t("research.no_sources_warning")}</p>
          </div>
        )}
        <div className="flex gap-2 max-w-3xl mx-auto">
          <Textarea
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={mode === "islamic" ? t("research.ask_placeholder_islamic") : t("research.ask_placeholder")}
            dir={isRtlQuery ? "rtl" : "ltr"}
            className={cn("min-h-[44px] max-h-32 resize-none flex-1", isRtlQuery && "text-right")}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); guardedSendQuery(); }
            }}
          />
          <Button
            onClick={guardedSendQuery}
            disabled={!query.trim() || isQuerying || researchLimitReached}
            size="icon"
            aria-label={t("research.send") || "Send"}
            className="shrink-0 h-11 w-11"
          >
            {isQuerying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ChatDisplay;
