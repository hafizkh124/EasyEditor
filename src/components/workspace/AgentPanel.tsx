import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Send, Loader2, Square, FolderOpen, Wrench, ScrollText, ChevronRight, AlertTriangle, CheckCircle2, Undo2, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLanguage } from "@/contexts/LanguageContext";
import { useProjectFolderContext } from "@/core/projectFolder/context";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { logger } from "@/lib/logger";
import { decodeAudioFile, encodeChunkToWav } from "@/lib/audio/chunker";
import { streamResearchQuery, streamIslamicQuery } from "@/lib/research/streamers";
import { useSubscription } from "@/contexts/SubscriptionContext";
import type { CitationItem } from "~shared/research/citationTypes";
import { buildMentions, filterMentions, activeMentionQuery, applyMention, type Mention } from "../../../shared/mentions";
import { PLAYBOOKS } from "../../../shared/playbooks/registry";
import { AgentArtifactPanel } from "./AgentArtifactPanel";
import { applyArtifactEvent, type ArtifactState } from "./agentArtifactState";

const log = logger.child("AgentPanel");

type Mode = "ask" | "plan" | "auto";
interface ProgressLine { step: number; label: string; kind: string; detail?: string }
interface RunResult {
  id?: string;
  answer: string;
  stopReason: string;
  steps: number;
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown }>;
  playbook?: string;
  checkpointId?: string;
  question?: string;
  error?: string;
}


/**
 * SPEC-M8 Layer 6 / P8b — the Agent tab. Two modes: "Ask" (read-only) and
 * "Do" (tracked-change edits). Every step shows a live present-tense line
 * (§3 UI shape — a trust requirement, not decoration). `/` opens a playbook
 * picker, `@` a mention picker (chapters + the open document's outline +
 * matching Shamela books). A microphone dictates into the chat box via the
 * existing local Whisper. Desktop + VITE_AGENT_MODE only; needs an open
 * project folder.
 */
export const AgentPanel: React.FC = () => {
  const { t, language } = useLanguage();
  const pf = useProjectFolderContext();
  const ws = useOptionalWorkspace();
  const { subscription } = useSubscription();
  const agent = typeof window !== "undefined" ? window.electronAPI?.agent : undefined;

  const [mode, setMode] = useState<Mode>("ask");
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ProgressLine[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactState[]>([]);
  const [planPending, setPlanPending] = useState(false);
  const runIdRef = useRef<string | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [caps, setCaps] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ kind: "mention" | "command"; query: string } | null>(null);
  const [shamelaBooks, setShamelaBooks] = useState<Array<{ id: string; title: string }>>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const shamelaDbRef = useRef<string | null | undefined>(undefined);

  const projectRoot = pf.folder?.path ?? null;

  useEffect(() => {
    window.electronAPI?.docBridge?.detectTools().then((d) => {
      if (!d.word) { setCaps(t("agent.caps_no_word", "Word not found on this machine")); return; }
      const parts = [`Word ${d.wordVersion ?? ""}`.trim()];
      if (d.excel) parts.push(`Excel ${d.excelVersion ?? ""}`.trim());
      if (d.powerpoint) parts.push(`PowerPoint ${d.powerpointVersion ?? ""}`.trim());
      setCaps(parts.join(" · "));
    }).catch(() => setCaps(null));
  }, [t]);

  // The agent asks the renderer to run a research query (it can't reach the
  // signed-in edge functions from the main process — ADR-0019 #7 / ADR-0022).
  // `islamic` also returns page-precise citations the agent can cite.
  const handleResearch = useCallback(async (requestId: string, query: string, mode: "general" | "islamic") => {
    if (!agent?.submitGeneralSearch) return;
    const acc = { value: "" };
    try {
      if (mode === "islamic") {
        let citations: CitationItem[] = [];
        await streamIslamicQuery({
          query, strictMode: false, chatHistory: [], tier: subscription?.tier ?? "free",
          onDelta: (chunk) => { acc.value += chunk; },
          onSourcesReady: (_c, _d, fetched) => { citations = fetched; },
          onDone: () => { void agent.submitGeneralSearch!(requestId, { answer: acc.value.trim(), channel: "islamic", citations }); },
          onError: (err) => { void agent.submitGeneralSearch!(requestId, { error: err }); },
        });
      } else {
        await streamResearchQuery({
          query, sources: [], strictMode: false, chatHistory: [], mode: "general",
          onDelta: (chunk) => { acc.value += chunk; },
          onDone: () => { void agent.submitGeneralSearch!(requestId, { answer: acc.value.trim(), channel: "general" }); },
          onError: (err) => { void agent.submitGeneralSearch!(requestId, { error: err }); },
        });
      }
    } catch (err) {
      void agent.submitGeneralSearch!(requestId, { error: err instanceof Error ? err.message : String(err) });
    }
  }, [agent, subscription?.tier]);

  useEffect(() => {
    if (!agent?.onProgress) return;
    return agent.onProgress((p) => {
      if (p.id) runIdRef.current = p.id;
      if (p.kind === "general-search-request" && p.requestId && typeof p.query === "string") {
        void handleResearch(p.requestId, p.query, p.mode === "islamic" ? "islamic" : "general");
        return;
      }
      if (p.kind === "artifact" && p.artifact) {
        setArtifacts((prev) => applyArtifactEvent(prev, p.artifact!));
        return;
      }
      if (p.kind === "plan-pending") {
        setPlanPending(true);
        if (p.label) setProgress((prev) => [...prev, { step: 0, label: p.label!, kind: "plan-pending" }]);
        return;
      }
      setProgress((prev) => [...prev, { step: p.step ?? 0, label: p.label ?? "", kind: p.kind, detail: p.detail }]);
    });
  }, [agent, handleResearch]);

  const decidePlan = useCallback(async (decision: "approved" | "rejected") => {
    setPlanPending(false);
    const id = runIdRef.current;
    if (id && agent?.approvePlan) { try { await agent.approvePlan(id, decision); } catch (err) { log.error("approvePlan failed", { err }); } }
  }, [agent]);

  const mentions = useMemo<Mention[]>(
    () => buildMentions({
      chapters: pf.chapters.map((c) => c.name),
      outline: ws?.documentOutline ?? [],
      shamelaBooks,
    }),
    [pf.chapters, ws?.documentOutline, shamelaBooks],
  );

  // Shamela-book mentions are looked up lazily: the local library holds
  // thousands of titles, so we only query once the `@` token is specific
  // enough (≥ 2 chars), debounced.
  useEffect(() => {
    const shamela = typeof window !== "undefined" ? window.electronAPI?.shamela : undefined;
    if (!shamela || picker?.kind !== "mention") return;
    const q = picker.query.trim();
    if (q.length < 2) { setShamelaBooks([]); return; }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        if (shamelaDbRef.current === undefined) {
          const det = await shamela.detect();
          shamelaDbRef.current = det.masterDbPath ?? null;
        }
        if (!shamelaDbRef.current || cancelled) return;
        const hits = await shamela.searchBooks(shamelaDbRef.current, q, 6);
        if (!cancelled) setShamelaBooks(hits.map((b) => ({ id: String(b.id), title: b.title })));
      } catch (err) {
        log.debug("shamela mention lookup failed", { err });
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [picker]);

  const updateInput = useCallback((text: string, caret: number) => {
    setInput(text);
    if (text.startsWith("/")) {
      setPicker({ kind: "command", query: text.slice(1) });
      return;
    }
    const active = activeMentionQuery(text, caret);
    setPicker(active ? { kind: "mention", query: active.query } : null);
  }, []);

  const pickerItems = useMemo<Array<{ kind: "mention" | "command"; label: string; apply: () => void }>>(() => {
    if (!picker) return [];
    if (picker.kind === "command") {
      const q = picker.query.toLowerCase();
      return PLAYBOOKS
        .filter((p) => p.title.toLowerCase().includes(q) || p.id.includes(q))
        .map((p) => ({
          kind: "command" as const,
          label: p.trigger ? `/${p.trigger} — ${p.title}` : p.title,
          apply: () => { setInput(p.trigger ? `/${p.trigger} ` : `${p.title} `); setPicker(null); taRef.current?.focus(); },
        }));
    }
    return filterMentions(mentions, picker.query).map((m) => ({
      kind: "mention" as const,
      label: m.label,
      apply: () => {
        const ta = taRef.current;
        const value = ta?.value ?? input;
        const caret = ta?.selectionStart ?? value.length;
        const next = applyMention(value, caret, m);
        setInput(next.text);
        setPicker(null);
        requestAnimationFrame(() => { ta?.focus(); ta?.setSelectionRange(next.caret, next.caret); });
      },
    }));
  }, [picker, mentions, input]);

  const send = useCallback(async () => {
    const instruction = input.trim();
    if (!instruction || !agent || !projectRoot || running) return;
    setRunning(true);
    setProgress([]);
    setResult(null);
    setArtifacts([]);
    setPlanPending(false);
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
      setPlanPending(false);
    }
  }, [input, agent, projectRoot, running, mode, pf]);

  const cancel = useCallback(() => { void agent?.cancel(); }, [agent]);

  // ── Voice dictation (existing local Whisper via electron/voice) ───────────
  const voice = typeof window !== "undefined" ? window.electronAPI?.voice : undefined;
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const toggleRecord = useCallback(async () => {
    if (recording) { recorderRef.current?.stop(); return; }
    if (!voice?.transcribe) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size === 0) return;
        setTranscribing(true);
        try {
          const audioBuffer = await decodeAudioFile(blob);
          const wav = await encodeChunkToWav(audioBuffer);
          const segments = await voice.transcribe({ audio: await wav.arrayBuffer(), lang: language });
          const text = segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
          if (text) {
            setInput((prev) => (prev ? `${prev.trimEnd()} ${text}` : text));
            requestAnimationFrame(() => taRef.current?.focus());
          }
        } catch (err) {
          log.error("voice transcription failed", { err });
        } finally {
          setTranscribing(false);
        }
      };
      recorder.start();
      setRecording(true);
    } catch (err) {
      log.error("microphone access failed", { err });
    }
  }, [recording, voice, language]);

  useEffect(() => () => { try { recorderRef.current?.stop(); } catch { /* not recording */ } }, []);

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

  // §3 gate #5 — set_global_option never applies itself; it returns a consent
  // request the scholar approves here, and every applied change is revertible.
  interface OptionConsent { needsConsent?: boolean; option?: string; value?: string; current?: string; message?: string }
  const pendingOptions = useMemo<OptionConsent[]>(() => {
    if (!result) return [];
    return result.toolCalls
      .filter((tc) => tc.name === "set_global_option")
      .map((tc) => tc.result as OptionConsent)
      .filter((r) => r?.needsConsent && r.option && r.value);
  }, [result]);
  const [optionsApplied, setOptionsApplied] = useState(false);
  useEffect(() => { setOptionsApplied(false); }, [result]);
  const applyOptions = useCallback(async () => {
    if (!agent?.applyGlobalOption || !projectRoot) return;
    for (const o of pendingOptions) {
      try { await agent.applyGlobalOption(projectRoot, o.option!, o.value!); }
      catch (err) { log.error("apply global option failed", { err }); }
    }
    setOptionsApplied(true);
  }, [agent, projectRoot, pendingOptions]);
  const revertOptions = useCallback(async () => {
    if (!agent?.revertGlobalOptions || !projectRoot) return;
    try { await agent.revertGlobalOptions(projectRoot); setOptionsApplied(false); }
    catch (err) { log.error("revert global options failed", { err }); }
  }, [agent, projectRoot]);

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
      {/* Mode toggle — Ask (read-only) / Plan (approve first) / Auto (M9 ADR-0026) */}
      <div className="flex items-center gap-1 border-b border-border p-2 shrink-0">
        {(["ask", "plan", "auto"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            disabled={running}
            className={`rounded px-2.5 py-1 text-xs font-medium ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            {m === "ask" ? t("agent.mode_ask", "Ask") : m === "plan" ? t("agent.mode_plan", "Plan") : t("agent.mode_auto", "Auto")}
          </button>
        ))}
        <button
          className="ms-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground truncate max-w-[55%] disabled:opacity-60"
          title={`${pf.folder?.path ?? ""} — ${t("projectfolder.change", "Change folder")}`}
          onClick={pf.openFolder}
          disabled={running || pf.busy}
        >
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{pf.folder?.manifest.title}</span>
        </button>
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
                : mode === "plan"
                  ? t("agent.hint_plan", "Describe a task. The agent lays out its steps and waits for your approval before changing anything.")
                  : t("agent.hint_auto", "Describe a task. Every edit lands as a tracked change you review in Word.")}
            </p>
          )}

          {artifacts.length > 0 && <AgentArtifactPanel artifacts={artifacts} />}

          {planPending && (
            <div className="rounded border border-primary/40 bg-primary/5 p-2 text-xs space-y-2">
              <p className="font-medium">{t("agent.plan_ready", "Review the plan above, then approve it to continue.")}</p>
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={() => void decidePlan("approved")}>{t("agent.plan_approve", "Approve & run")}</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void decidePlan("rejected")}>{t("agent.plan_reject", "Cancel")}</Button>
              </div>
            </div>
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
              ) : result.stopReason === "needs-input" && result.question ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-primary">{t("agent.needs_input", "The agent needs a clarification:")}</p>
                  <p className="whitespace-pre-wrap">{result.question}</p>
                  <p className="text-xs text-muted-foreground">{t("agent.needs_input_hint", "Reply below to continue.")}</p>
                </div>
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
              {pendingOptions.length > 0 && (
                <div className="rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs space-y-1.5">
                  <p className="font-medium text-amber-700 dark:text-amber-400">
                    {t("agent.global_option_consent", "This changes a Word setting for every document — approve it?")}
                  </p>
                  <ul className="space-y-0.5 font-mono">
                    {pendingOptions.map((o, i) => (
                      <li key={i}>{o.option}: {o.current} → {o.value}</li>
                    ))}
                  </ul>
                  {optionsApplied ? (
                    <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => void revertOptions()}>
                      <Undo2 className="h-3.5 w-3.5" />
                      {t("agent.revert_settings", "Revert Word settings")}
                    </Button>
                  ) : (
                    <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void applyOptions()}>
                      {t("agent.apply_settings", "Apply {n} change(s)").replace("{n}", String(pendingOptions.length))}
                    </Button>
                  )}
                </div>
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
        {picker && pickerItems.length > 0 && (
          <div className="absolute bottom-full start-2 end-2 mb-1 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
            {pickerItems.map((it, i) => (
              <button key={i} className="flex w-full items-center gap-2 px-2 py-1.5 text-start text-xs hover:bg-muted" onClick={it.apply}>
                {it.kind === "command" ? <ScrollText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <span className="text-muted-foreground">@</span>}
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
          {voice?.transcribe && (
            <Button
              size="icon"
              variant={recording ? "default" : "outline"}
              className="h-9 w-9 shrink-0"
              onClick={() => void toggleRecord()}
              disabled={running || transcribing}
              aria-label={recording ? t("agent.voice_stop", "Stop dictation") : t("agent.voice_start", "Dictate")}
              title={recording ? t("agent.voice_stop", "Stop dictation") : t("agent.voice_start", "Dictate")}
            >
              {transcribing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className={`h-4 w-4 ${recording ? "animate-pulse" : ""}`} />}
            </Button>
          )}
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
