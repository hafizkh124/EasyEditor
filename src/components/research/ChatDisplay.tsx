import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Send, Loader2, Download, BookOpen, Copy, Sparkles,
  PenLine, MessageSquare, Minimize2, FileDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isRtlText as detectRtl } from "@/utils/textUtils";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "./types";

interface DocumentBoxProps {
  content: string;
  isRefining: boolean;
  onRefine: (action: string) => void;
  onCopy: () => void;
  onDownload: () => void;
  t: (k: string) => string;
}

const DocumentBox = ({ content, isRefining, onRefine, onCopy, onDownload, t }: DocumentBoxProps) => {
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
          "px-8 py-6 prose prose-sm dark:prose-invert max-w-none min-h-[250px] leading-relaxed",
          isRtl && "text-right"
        )}
      >
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>

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
  researchLimitReached: boolean;
  chatEndRef: React.RefObject<HTMLDivElement>;
  t: (k: string) => string;
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
  researchLimitReached,
  chatEndRef,
  t,
}: ChatDisplayProps) => {
  const isRtlQuery = detectRtl(query);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h1 className="text-xl font-bold text-foreground">{t("research.title")}</h1>
        {messages.length > 0 && (
          <Button variant="outline" size="sm" onClick={onDownloadReport}>
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
              const isRtl = detectRtl(msg.content);
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

            if (isLastAssistant) {
              return (
                <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                  <DocumentBox
                    content={msg.content}
                    isRefining={isRefining}
                    onRefine={onRefine}
                    onCopy={onCopyOutput}
                    onDownload={onDownloadReport}
                    t={t}
                  />
                </motion.div>
              );
            }

            const isRtl = detectRtl(msg.content);
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
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t("research.ask_placeholder")}
            dir={isRtlQuery ? "rtl" : "ltr"}
            className={cn("min-h-[44px] max-h-32 resize-none flex-1", isRtlQuery && "text-right")}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSendQuery(); }
            }}
          />
          <Button
            onClick={onSendQuery}
            disabled={!query.trim() || isQuerying || researchLimitReached}
            size="icon"
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
