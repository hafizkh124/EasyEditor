import React, { useState, useEffect, useRef, useCallback } from "react";
import { Sparkles, BookOpen, Send, Loader2, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLanguage } from "@/contexts/LanguageContext";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { invokeAiText } from "@/core/ai/aiAdapter";
import {
  buildAiReaderSystemInstruction,
  buildActionPrompt,
  buildFreePrompt,
  type AiReaderAction,
} from "@/lib/reader/aiReaderPrompts";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

/**
 * SPEC-M6 Phase 7 — Reader AI Panel.
 *
 * An AI reading assistant docked in the Workbench. It answers questions about
 * the page the Shamela reader is currently showing (explain / summarize /
 * quiz quick actions, plus free-form questions). Text flows through the BYOK
 * Gemini stream in Desktop mode; in the web build it falls back to the
 * cloud `refine-text` edge function.
 */
export const AiReaderPanel: React.FC = () => {
  const { language, t } = useLanguage();
  const uiLang: "ur" | "en" = language === "ur" ? "ur" : "en";
  const navigate = useNavigate();
  const workspace = useOptionalWorkspace();
  const readerPage = workspace?.readerPage ?? null;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyStatus, setKeyStatus] = useState<{ hasKey: boolean } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.electronAPI?.byok) {
      window.electronAPI.byok
        .getKeyStatus()
        .then((st) => setKeyStatus({ hasKey: Boolean(st.hasKey) }))
        .catch(() => setKeyStatus({ hasKey: false }));
    }
  }, []);

  // A new page resets the conversation — the questions referred to the old one.
  const pageKey = readerPage ? `${readerPage.bookId}:${readerPage.pageNumber}` : null;
  useEffect(() => {
    setMessages([]);
    setError(null);
  }, [pageKey]);

  useEffect(() => {
    // Radix ScrollArea: the scrollable element is the viewport, not the Root
    // that the ref lands on — query it through the ref.
    const el = scrollRef.current?.querySelector?.("[data-radix-scroll-area-viewport]");
    el?.scrollTo?.({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const ask = useCallback(
    async (prompt: string) => {
      if (!prompt.trim() || busy) return;
      setMessages((prev) => [...prev, { role: "user", content: prompt.trim() }]);
      setMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true }]);
      setBusy(true);
      setError(null);
      try {
        let acc = "";
        const text = await invokeAiText({
          prompt,
          systemInstruction: buildAiReaderSystemInstruction(uiLang),
          temperature: 0.4,
          onChunk: (chunk) => {
            acc += chunk;
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { role: "assistant", content: acc, streaming: true };
              return next;
            });
          },
        });
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: text || acc, streaming: false };
          return next;
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setMessages((prev) => {
          const next = [...prev];
          if (next[next.length - 1]?.streaming) {
            next.pop();
          }
          return next;
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, uiLang],
  );

  const runAction = useCallback(
    (action: AiReaderAction) => {
      if (!readerPage) return;
      void ask(buildActionPrompt(action, readerPage.text, readerPage.pageNumber, uiLang));
    },
    [ask, readerPage, uiLang],
  );

  const handleSend = () => {
    if (!readerPage) return;
    void ask(buildFreePrompt(input, readerPage.text, readerPage.pageNumber));
    setInput("");
  };

  if (!readerPage) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center gap-2 bg-background">
        <BookOpen className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("reader.ai.open_book")}
        </p>
      </div>
    );
  }

  const noKey = keyStatus && !keyStatus.hasKey;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header — which book/page is the AI looking at */}
      <div className="px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold text-foreground truncate">{readerPage.title}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{t("reader.page")} {readerPage.pageNumber}</p>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-1 p-2 border-b border-border shrink-0">
        <Button size="sm" variant="outline" className="h-7 text-xs px-1" onClick={() => runAction("explain")} disabled={busy}>
          {t("reader.ai.explain")}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs px-1" onClick={() => runAction("summarize")} disabled={busy}>
          {t("reader.ai.summarize")}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs px-1" onClick={() => runAction("quiz")} disabled={busy}>
          {t("reader.ai.ask")}
        </Button>
      </div>

      {/* No-key hint */}
      {noKey && (
        <div className="mx-2 mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300 shrink-0">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">
            {t("reader.ai.key_required")}
            <button
              type="button"
              className="underline ms-1 font-medium"
              onClick={() => navigate("/settings")}
            >
              {t("reader.ai.open_settings")}
            </button>
          </span>
        </div>
      )}

      {/* Conversation */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground leading-relaxed text-center">
            {t("reader.ai.prompt_hint")}
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-full rounded-md px-2.5 py-1.5 text-xs leading-relaxed whitespace-pre-wrap ${
                  m.role === "user"
                    ? "ms-auto max-w-[85%] bg-primary/10 text-foreground"
                    : "me-auto max-w-[95%] bg-muted text-foreground"
                }`}
              >
                {m.content || (m.streaming ? <Loader2 className="h-3 w-3 animate-spin" /> : null)}
              </div>
            ))}
          </div>
        )}
        {error && <p className="p-2 text-xs text-destructive break-words">{error}</p>}
      </ScrollArea>

      {/* Free-form input */}
      <div className="flex gap-1.5 p-2 border-t border-border shrink-0">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder={t("reader.ai.placeholder")}
          className="h-8 text-xs"
          disabled={busy}
        />
        <Button
          size="icon"
          className="h-8 w-8 shrink-0"
          title={t("research.send")}
          aria-label={t("research.send")}
          onClick={handleSend}
          disabled={busy || !input.trim()}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
};
