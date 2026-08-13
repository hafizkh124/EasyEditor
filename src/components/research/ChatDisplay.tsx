import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Send, Loader2, BookOpen, Copy, Sparkles, MessageSquarePlus, RefreshCw, AlertCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
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
import EmptyState from "./EmptyState";
import { ScholarlyPromptModal } from "./ScholarlyPromptModal";
import type { ScholarlyPromptDef } from "@/lib/prompts/promptsRegistry";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
import type { ResearchAssistMode } from "@/lib/prompts";
import type { ResearchMode } from "./ResearchModeSwitcher";
import { editorRoute } from "@/lib/routes";
import { DocumentBox } from "./chat/DocumentBox";
import { SourcesReadyIndicator, TypingDots, UserAvatar, AiAvatar } from "./chat/ChatAtoms";

const VIRTUALIZE_THRESHOLD = 50;

/* ── Main ChatDisplay ────────────────────────────────────────────── */

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
  onClearChat: () => void;
  onRegenerate: () => void;
  sources: Source[];
  researchLimitReached: boolean;
  chatEndRef: React.RefObject<HTMLDivElement>;
  t: import("@/lib/i18n").Translator;
  mode?: ResearchMode;
  onModeChange?: (mode: ResearchMode) => void;
  sourcesReadyInfo?: { count: number; domains: string[] } | null;
  citations?: CitationItem[];
  assistModes?: ResearchAssistMode[];
  onAssistModesChange?: (modes: ResearchAssistMode[]) => void;
  onContinue?: () => void;
}

const ISLAMIC_QUERY_MARKERS = /(?:قرآن|قراٰن|قُرآن|حدیث|حديث|آیت|آية|آیات|آيات|اَیات|سورۃ|سورة|نماز|روزہ|روزه|زکوٰۃ|زكاة|حج|عمرہ|عمرة|نکاح|طلاق|توبہ|توبة|صدقہ|صدقة|الله|اللہ|اللّٰہ|سنت|سنة|فقہ|فقه|تفسیر|تفسير|نبی|نبي|رسول|صحابہ|صحابة|إسلام|اسلام|sahaba|quran|qur'?an|hadith|hadis|surah|ayah|prophet|islam(?:ic)?)/i;

const ChatDisplay = ({
  messages, isQuerying, query, onQueryChange, onSendQuery, isRefining,
  lastAssistantIdx, onRefine, onCopyOutput, onClearChat, onRegenerate,
  sources, researchLimitReached, chatEndRef: _chatEndRef, t,
  mode = "general", onModeChange, sourcesReadyInfo, citations = [],
  assistModes = [], onAssistModesChange, onContinue,
}: ChatDisplayProps) => {
  const navigate = useNavigate();
  const isRtlQuery = detectRtl(query);
  const guard = useSubmitGuard(500);
  const guardedSendQuery = guard(onSendQuery);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [inputFocused, setInputFocused] = useState(false);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, []);

  useEffect(() => { autoResize(); }, [query, autoResize]);

  const copyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
    toast.success(t("research.copy_message"));
  };

  const lastMsg = messages[messages.length - 1];
  const responseLooksTruncated = useMemo(() => {
    if (!lastMsg || lastMsg.role !== "user") {
      const assistMsg = lastMsg?.role === "assistant" ? lastMsg : null;
      if (!assistMsg || !assistMsg.content || assistMsg.content.length < 200) return false;
      const trimmed = assistMsg.content.trimEnd();
      return !/[.!?؟۔\n```]$/.test(trimmed);
    }
    return false;
  }, [lastMsg]);

  const showSourcesIndicator = mode === "islamic" && sourcesReadyInfo != null && sourcesReadyInfo.count > 0;
  const showNoSourcesWarning = mode === "custom" && sources.length === 0;
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);

  const [islamicHintDismissed, setIslamicHintDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem("islamicHintDismissed") === "1"; } catch { return false; }
  });
  const queryLooksIslamic = useMemo(
    () => query.trim().length >= 3 && ISLAMIC_QUERY_MARKERS.test(query),
    [query],
  );
  const showIslamicHint = (mode === "general" || mode === "custom") && queryLooksIslamic && !islamicHintDismissed;

  type ListItem =
    | { type: "empty" }
    | { type: "citations" }
    | { type: "message"; index: number; msg: ChatMessage }
    | { type: "sources_ready" }
    | { type: "typing" }
    | { type: "spacer" };

  const listItems = useMemo(() => {
    const items: ListItem[] = [];
    if (messages.length === 0) items.push({ type: "empty" });
    if (mode === "islamic" && citations.length > 0) items.push({ type: "citations" });
    messages.forEach((msg, i) => items.push({ type: "message", index: i, msg }));
    if (showSourcesIndicator && isQuerying) items.push({ type: "sources_ready" });
    if (isQuerying && messages[messages.length - 1]?.role !== "assistant") items.push({ type: "typing" });
    items.push({ type: "spacer" });
    return items;
  }, [messages, mode, citations.length, showSourcesIndicator, isQuerying]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isQuerying, listItems.length]);

  const handleSuggestionClick = (text: string) => {
    onQueryChange(text);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  /* ── Render a single list item ──────────────────────────────── */
  const renderItem = (item: ListItem, index: number) => {
    let content: React.ReactNode = null;

    if (item.type === "empty") {
      content = <EmptyState mode={mode} onSuggestionClick={handleSuggestionClick} t={t} />;
    } else if (item.type === "citations") {
      content = <CitationPanel citations={citations} t={t} />;
    } else if (item.type === "message") {
      const msg = item.msg;
      const isLastAssistant = msg.role === "assistant" && item.index === messages.length - 1 - lastAssistantIdx;

      if (msg.role === "user") {
        const isRtl = detectRtl(msg.content);
        content = (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="flex justify-end gap-2"
          >
            <div className="rounded-2xl rounded-tr-md px-4 py-2.5 max-w-[80%] text-sm bg-primary text-primary-foreground shadow-sm">
              <div dir={isRtl ? "rtl" : "ltr"} className={cn("whitespace-pre-wrap", isRtl && "text-right")}>
                {msg.content}
              </div>
            </div>
            <UserAvatar />
          </motion.div>
        );
      } else if (msg.assist) {
        content = (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="flex gap-2">
            <AiAvatar />
            <div className="space-y-4 max-w-3xl flex-1 min-w-0">
              {msg.assist.promptKey === "spelling" && (
                <SpellingResponse original="" corrected={msg.assist.corrected} changes={msg.assist.changes} t={t} />
              )}
              {msg.assist.promptKey === "citations" && (
                <CitationResponse text={msg.assist.text} citations={msg.assist.citations} totalSegments={msg.assist.total_segments} rejectedSegments={msg.assist.rejected_segments} uncitedSegments={msg.assist.uncited_segments} t={t} />
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
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="flex gap-2">
            <AiAvatar />
            <div className="flex-1 min-w-0">
              <DocumentBox
                content={msg.content}
                isRefining={isRefining}
                onRefine={onRefine}
                onCopy={onCopyOutput}
                onRegenerate={onRegenerate}
                onOpenInEditor={() => navigate(editorRoute(), { state: { content: msg.content, source: "research" } })}
                t={t}
              />
              {responseLooksTruncated && !isQuerying && onContinue && (
                <div className="mt-3 flex justify-center">
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={onContinue}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t("research.continue_generating")}
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        );
      } else {
        const isRtl = detectRtl(msg.content);
        content = (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="flex gap-2 group"
          >
            <AiAvatar />
            <div className="rounded-2xl rounded-tl-md px-4 py-2.5 max-w-[80%] text-sm bg-muted text-foreground border border-border/50 relative shadow-sm">
              <div dir={isRtl ? "rtl" : "ltr"} className={cn("prose prose-sm dark:prose-invert max-w-none", isRtl && "text-right")}>
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
              <button
                onClick={() => copyMessage(msg.content)}
                className="absolute top-1.5 end-1.5 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-background hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover:opacity-100"
                aria-label={t("research.copy")}
                title={t("research.copy")}
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          </motion.div>
        );
      }
    } else if (item.type === "sources_ready") {
      content = (
        <AnimatePresence>
          <SourcesReadyIndicator count={sourcesReadyInfo!.count} domains={sourcesReadyInfo!.domains} t={t} />
        </AnimatePresence>
      );
    } else if (item.type === "typing") {
      content = (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex gap-2 items-start"
        >
          <AiAvatar />
          <div className="rounded-2xl rounded-tl-md px-4 py-3 bg-muted border border-border/50 flex items-center gap-2.5 shadow-sm">
            <TypingDots />
            <span className="text-xs text-muted-foreground">
              {showSourcesIndicator ? t("research.generating_with_sources") : t("research.thinking")}
            </span>
          </div>
        </motion.div>
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

  /* ── Layout ─────────────────────────────────────────────────── */
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/80 backdrop-blur-sm">
        <h1 className="text-lg font-semibold text-foreground">{t("research.title")}</h1>
        <Button variant="ghost" size="sm" onClick={onClearChat} className="gap-1.5 h-8 text-xs text-muted-foreground hover:text-foreground">
          <MessageSquarePlus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t("common.new_chat")}</span>
        </Button>
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} className={cn(
        "flex-1 w-full relative",
        listItems.length > VIRTUALIZE_THRESHOLD ? "overflow-hidden" : "overflow-y-auto",
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
          <div className="max-w-3xl mx-auto px-4 py-4">
            {listItems.map((item, index) => renderItem(item, index))}
            <div ref={bottomAnchorRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="px-4 pb-4 pt-2 space-y-2">
        {onAssistModesChange && (
          <div className="max-w-3xl mx-auto">
            <ModeChips modes={assistModes} onModesChange={onAssistModesChange} disabled={isQuerying} t={t} />
          </div>
        )}
        {showNoSourcesWarning && (
          <div className="flex items-center gap-2 max-w-3xl mx-auto rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-3 py-2">
            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
            <p className="text-xs text-amber-700 dark:text-amber-400">{t("research.no_sources_warning")}</p>
          </div>
        )}
        {showIslamicHint && (
          <div className="flex items-center gap-2 max-w-3xl mx-auto rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50 px-3 py-2">
            <BookOpen className="h-4 w-4 text-blue-500 shrink-0" />
            <p className="text-xs flex-1 text-blue-700 dark:text-blue-400">{t("research.islamic_hint")}</p>
            {onModeChange && (
              <Button size="sm" variant="default" className="h-7 text-xs px-2"
                onClick={() => { onModeChange("islamic"); setIslamicHintDismissed(true); }}>
                {t("research.islamic_hint_switch")}
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 text-xs px-2"
              onClick={() => { setIslamicHintDismissed(true); try { sessionStorage.setItem("islamicHintDismissed", "1"); } catch { /* no-op */ } }}>
              {t("research.islamic_hint_dismiss")}
            </Button>
          </div>
        )}

        {/* Modern input container */}
        <div className={cn(
          "max-w-3xl mx-auto rounded-2xl border bg-card shadow-sm transition-all duration-200",
          inputFocused
            ? "border-primary/50 shadow-md ring-2 ring-primary/10"
            : "border-border hover:border-border/80",
        )}>
          <div className="flex gap-2 items-end p-3">
            <Textarea
              ref={textareaRef}
              value={query}
              onChange={(e) => { onQueryChange(e.target.value); autoResize(); }}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder={mode === "islamic" ? t("research.ask_placeholder_islamic") : t("research.ask_placeholder")}
              aria-label={t("research.ask_placeholder")}
              dir={isRtlQuery ? "rtl" : "ltr"}
              className={cn(
                "min-h-[56px] max-h-[320px] resize-none flex-1 overflow-y-auto border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 text-sm",
                isRtlQuery && "text-right",
              )}
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); guardedSendQuery(); }
              }}
            />
            <Button
              onClick={guardedSendQuery}
              disabled={!query.trim() || isQuerying || researchLimitReached}
              size="icon"
              aria-label={t("research.send") || "Send"}
              className="shrink-0 h-9 w-9 rounded-xl"
            >
              {isQuerying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <div className="px-3 pb-2 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{t("research.send_hint")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsPromptModalOpen(true)}
              className="h-6 text-xs px-2 gap-1 rounded-lg text-primary border-primary/30 hover:bg-primary/10 transition-colors"
            >
              <Sparkles className="h-3 w-3" />
              14 علمی پرامپٹس
            </Button>
          </div>
        </div>
      </div>

      <ScholarlyPromptModal
        isOpen={isPromptModalOpen}
        onClose={() => setIsPromptModalOpen(false)}
        onSelectPrompt={(promptText: string, prompt: ScholarlyPromptDef) => {
          // Route citation-heavy prompts through the grounded Islamic engine so
          // references come from the corpus, not an ungrounded general LLM.
          // Auto-switch only when it's safe (no conversation/draft to discard) —
          // switching mode with content on screen triggers a confirm dialog, so
          // in that case we advise the user to switch manually instead.
          if (prompt.grounded && mode !== "islamic") {
            const canAutoSwitch = messages.length === 0 && !query.trim();
            if (canAutoSwitch && onModeChange) {
              onModeChange("islamic");
              onQueryChange(promptText);
              toast.info(t("research.prompt_switched_islamic"));
            } else {
              onQueryChange(promptText);
              toast.info(t("research.prompt_switch_manual"));
            }
          } else {
            onQueryChange(promptText);
          }
          if (!prompt.corpusReady) {
            toast.warning(t("research.prompt_corpus_pending"));
          }
          setTimeout(() => textareaRef.current?.focus(), 50);
        }}
      />
    </div>
  );
};

export default ChatDisplay;
