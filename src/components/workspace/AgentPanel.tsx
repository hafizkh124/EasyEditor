import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Send, Loader2, Square, FolderOpen, Wrench, ScrollText, ChevronRight, AlertTriangle, CheckCircle2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLanguage } from "@/contexts/LanguageContext";
import { useProjectFolderContext } from "@/core/projectFolder/context";
import { logger } from "@/lib/logger";
import { buildMentions, filterMentions, activeMentionQuery, applyMention, type Mention } from "../../../shared/mentions";
import { PLAYBOOKS } from "../../../shared/playbooks/registry";

const log = logger.child("AgentPanel");

type Mode = "ask" | "do";
interface ProgressLine { step: number; label: string; kind: string; detail?: string }
interface RunResult {
  answer: string;
  stopReason: string;
  steps: number;
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown }>;
  playbook?: string;
  checkpointId?: string;
  error?: string;
}

/**
 * SPEC-M8 Layer 6 / P8b — the Agent tab. Two modes: "Ask" (read-only) and
 * "Do" (tracked-change edits). Every step shows a live present-tense line
 * (§3 UI shape — a trust requirement, not decoration). `/` opens a playbook
 * picker, `@` a chapter picker. Desktop + VITE_AGENT_MODE only; needs an
 * open project folder.
 */
export const AgentPanel: React.FC = () => {
  const { t } = useLanguage();
  const pf = useProjectFolderContext();
  const agent = typeof window !== "undefined" ? window.electronAPI?.agent : undefined;

  const [mode, setMode] = useState<Mode>("ask");
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ProgressLine[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [caps, setCaps] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ kind: "mention" | "command"; items: Array<{ label: string; apply: () => void }> } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const projectRoot = pf.folder?.path ?? null;

  useEffect(() => {
    window.electronAPI?.docBridge?.detectTools().then((d) => {
      setCaps(d.word ? `Word ${d.wordVersion ?? ""}`.trim() : t("agent.caps_no_word", "Word not found on this machine"));
    }).catch(() => setCaps(null));
  }, [t]);

  useEffect(() => {
    if (!agent?.onProgress) return;
    return agent.onProgress((p) => setProgress((prev) => [...prev, { step: p.step, label: p.label, kind: p.kind, detail: p.detail }]));
  }, [agent]);

  const mentions = useMemo<Mention[]>(
    () => buildMentions({ chapters: pf.chapters.map((c) => c.name) }),
    [pf.chapters],
  );

  const updateInput = useCallback((text: string, caret: number) => {
    setInput(text);
    // `/` at the very start → command (playbook) picker.
    if (text.startsWith("/")) {
      const q = text.slice(1).toLowerCase();
      setPicker({
        kind: "command",
        items: PLAYBOOKS.filter((p) => p.title.toLowerCase().includes(q) || p.id.includes(q)).map((p) => ({
          label: p.title,
          apply: () => { setInput(p.title + " "); setPicker(null); taRef.current?.focus(); },
        })),
      });
      return;
    }
    const active = activeMentionQuery(text, caret);
    if (active) {
      const hits = filterMentions(mentions, active.query);
      setPicker(hits.length ? {
        kind: "mention",
        items: hits.map((m) => ({
          label: m.label,
          apply: () => {
            const next = applyMention(text, caret, m);
            setInput(next.text);
            setPicker(null);
            requestAnimationFrame(() => { taRef.current?.focus(); taRef.current?.setSelectionRange(next.caret, next.caret); });
          },
        })),
      } : null);
      return;
    }
    setPicker(null);
  }, [mentions]);

  const send = useCallback(async () => {
    const instruction = input.trim();
    if (!instruction || !agent || !projectRoot || running) return;
    setRunning(true);
    setProgress([]);
    setResult(null);
    setPicker(null);
    try {
      const res = await agent.run(instruction, mode, projectRoot);
      setResult(res as RunResult);
      setInput("");
      void pf.refresh();
    } catch (err) {
      log.error("agent run failed", { err });
      setResult({ answer: "", stopReason: "error", steps: 0, toolCalls: [], error: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  }, [input, agent, projectRoot, running, mode, pf]);

  const cancel = useCallback(() => { void agent?.cancel(); }, [agent]);

  const [undone, setUndone] = useState(false);
  const undoTask = useCallback(async () => {
    if (!agent || !projectRoot || !result?.checkpointId) return;
    try {
      await agent.undoTask(projectRoot, result.checkpointId);
      setUndone(true);
      void pf.refresh();
    } catch { /* toast handled by the caller pattern elsewhere; keep quiet here */ }
  }, [agent, projectRoot, result, pf]);
  useEffect(() => { setUndone(false); }, [result]);

  if (!projectRoot) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center text-muted-foreground">
        <Bot className="h-10 w-10 opacity-30" />
        <p className="text-sm">{t("agent.needs_folder", "The agent works on a folder of .docx chapters — open one to begin.")}</p>
        <p className="text-xs opacity-80">{t("agent.needs_folder_hint", "This is separate from a Library project. Pick the folder where your chapter files live (it can be inside Google Drive / OneDrive).")}</p>
        <Button size="sm" variant="outline" onClick={pf.openFolder} className="gap-1.5">
          <FolderOpen className="h-4 w-4" />
          {t("projectfolder.open", "Open a folder of .docx chapters")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Mode toggle */}
      <div className="flex items-center gap-1 border-b border-border p-2 shrink-0">
        {(["ask", "do"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            disabled={running}
            className={`rounded px-2.5 py-1 text-xs font-medium ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            {m === "ask" ? t("agent.mode_ask", "Ask") : t("agent.mode_do", "Do")}
          </button>
        ))}
        <span className="ms-auto text-xs text-muted-foreground truncate max-w-[45%]" title={pf.folder?.path}>
          {pf.folder?.manifest.title}
        </span>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-3">
          {pf.chapters.length === 0 && (
            <div className="flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {t("agent.no_chapters", "This folder has no .docx or .rtf files yet — the agent has nothing to read. Add chapter files, or pick a different folder.")}
            </div>
          )}
          {progress.length === 0 && !result && (
            <p className="text-xs text-muted-foreground">
              {mode === "ask"
                ? t("agent.hint_ask", "Ask about a chapter or a source. The agent reads and searches — it changes nothing.")
                : t("agent.hint_do", "Describe a task. Every edit lands as a tracked change you review in Word.")}
            </p>
          )}

          {progress.map((p, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              {p.kind === "error"
                ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500 mt-0.5" />
                : p.kind === "done"
                  ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500 mt-0.5" />
                  : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />}
              <span className={p.kind === "error" ? "text-amber-700 dark:text-amber-400" : "text-foreground"}>
                {p.label}{p.detail ? ` — ${p.detail}` : ""}
              </span>
            </div>
          ))}

          {result && (
            <div className="rounded-md border border-border bg-card p-2.5 space-y-2 text-sm">
              {result.error ? (
                <p className="text-destructive text-xs">{result.error}</p>
              ) : (
                <p className="whitespace-pre-wrap">{result.answer || t("agent.no_answer", "(no answer)")}</p>
              )}
              {result.playbook && (
                <p className="text-xs text-muted-foreground">{t("agent.used_playbook", "Playbook: {id}").replace("{id}", result.playbook)}</p>
              )}
              {result.toolCalls.length > 0 && (
                <div>
                  <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowTools((s) => !s)}>
                    <Wrench className="h-3 w-3" />
                    {t("agent.tool_calls", "{n} tool calls").replace("{n}", String(result.toolCalls.length))}
                  </button>
                  {showTools && (
                    <ul className="mt-1 space-y-1 border-s border-border ps-2">
                      {result.toolCalls.map((tc, i) => (
                        <li key={i} className="text-xs">
                          <span className="font-mono">{tc.name}</span>
                          <span className="text-muted-foreground"> {JSON.stringify(tc.args)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {result.stopReason === "step-limit" && (
                <p className="text-xs text-amber-700 dark:text-amber-400">{t("agent.step_limit", "Stopped at the step limit — ask a narrower question.")}</p>
              )}
              {result.checkpointId && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => void undoTask()}
                  disabled={undone}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  {undone ? t("agent.undone", "Task reverted") : t("agent.undo_task", "Undo this task")}
                </Button>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="relative border-t border-border p-2 shrink-0">
        {picker && picker.items.length > 0 && (
          <div className="absolute bottom-full start-2 end-2 mb-1 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
            {picker.items.map((it, i) => (
              <button key={i} className="flex w-full items-center gap-2 px-2 py-1.5 text-start text-xs hover:bg-muted" onClick={it.apply}>
                {picker.kind === "command" ? <ScrollText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <span className="text-muted-foreground">@</span>}
                <span className="truncate">{it.label}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => updateInput(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !picker) { e.preventDefault(); void send(); }
              if (e.key === "Escape") setPicker(null);
            }}
            rows={2}
            disabled={running}
            placeholder={t("agent.placeholder", "Ask, or describe a task…  @chapter  /playbook")}
            className="flex-1 resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          />
          {running ? (
            <Button size="icon" variant="outline" className="h-9 w-9 shrink-0" onClick={cancel} aria-label={t("common.cancel", "Cancel")}>
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="icon" className="h-9 w-9 shrink-0" onClick={() => void send()} disabled={!input.trim()} aria-label={t("agent.send", "Send")}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          )}
        </div>
        {caps && (
          <p className="mt-1 text-xs text-muted-foreground truncate" title={t("agent.caps_title", "This machine's capabilities")}>
            <span className="opacity-60">⚙ </span>{caps}
          </p>
        )}
      </div>
    </div>
  );
};
