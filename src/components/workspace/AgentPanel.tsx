import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Send, Loader2, Square, FolderOpen, Wrench, ScrollText, ChevronRight, ChevronDown, AlertTriangle, CheckCircle2, Undo2, Mic, Plus, Paperclip, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLanguage } from "@/contexts/LanguageContext";
import { useProjectFolderContext } from "@/core/projectFolder/context";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { logger } from "@/lib/logger";
import { decodeAudioFile, encodeChunkToWav, chunkAudioBuffer } from "@/lib/audio/chunker";
import { streamResearchQuery, streamIslamicQuery } from "@/lib/research/streamers";
import { useSubscription } from "@/contexts/SubscriptionContext";
import type { CitationItem } from "~shared/research/citationTypes";
import { buildMentions, filterMentions, activeMentionQuery, applyMention, type Mention } from "../../../shared/mentions";
import { PLAYBOOKS } from "../../../shared/playbooks/registry";
import { CONNECTORS, isConnectorOn } from "../../../shared/agent/connectors";
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
  const [assets, setAssets] = useState<Array<{ name: string; kind: "media" | "scan" | "asset" }>>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [hubOpen, setHubOpen] = useState(false);
  const [connectors, setConnectors] = useState<Record<string, boolean>>({});
  const [progressExpanded, setProgressExpanded] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shamelaDbRef = useRef<string | null | undefined>(undefined);

  const projectRoot = pf.folder?.path ?? null;

  const refreshAssets = useCallback(async () => {
    const fsApi = window.electronAPI?.projectFolder;
    if (!fsApi?.listAssets || !projectRoot) return;
    try { setAssets((await fsApi.listAssets(projectRoot)).map((a) => ({ name: a.name, kind: a.kind }))); }
    catch (err) { log.debug("listAssets failed", { err }); }
  }, [projectRoot]);

  useEffect(() => { void refreshAssets(); }, [refreshAssets]);

  useEffect(() => {
    const fsApi = window.electronAPI?.projectFolder;
    if (!fsApi?.getConnectors || !projectRoot) return;
    fsApi.getConnectors(projectRoot).then(setConnectors).catch(() => setConnectors({}));
  }, [projectRoot]);

  const toggleConnector = useCallback(async (id: string, on: boolean) => {
    const fsApi = window.electronAPI?.projectFolder;
    if (!fsApi?.setConnector || !projectRoot) return;
    setConnectors((prev) => ({ ...prev, [id]: on }));
    try { setConnectors(await fsApi.setConnector(projectRoot, id, on)); }
    catch (err) { log.warn("setConnector failed", { err }); }
  }, [projectRoot]);

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

  // M9 Phase 5 — the agent asks the renderer to transcribe an in-project
  // recording: whisper.cpp only reads 16 kHz mono WAV and the decode/chunk
  // pipeline (ADR-0001) is Web Audio, so it can only run here.
  const handleTranscribe = useCallback(async (requestId: string, mediaPath: string, lang: string) => {
    const submit = agent?.submitTranscription;
    const fsApi = window.electronAPI?.projectFolder;
    const voiceApi = window.electronAPI?.voice;
    if (!submit) return;
    if (!fsApi?.readAssetBytes || !voiceApi?.transcribe || !projectRoot) {
      void submit(requestId, { error: "Transcription needs the desktop app's local Whisper engine." });
      return;
    }
    try {
      const bytes = await fsApi.readAssetBytes(projectRoot, mediaPath);
      const buffer = await decodeAudioFile(new Blob([bytes]));
      const chunks = chunkAudioBuffer(buffer);
      const segments: Array<{ start: number; end: number; text: string }> = [];
      for (const chunk of chunks) {
        const wav = await encodeChunkToWav(chunk.buffer);
        const part = await voiceApi.transcribe({ audio: await wav.arrayBuffer(), lang });
        for (const s of part) {
          segments.push({ start: s.start + chunk.startSeconds, end: s.end + chunk.startSeconds, text: s.text });
        }
      }
      void submit(requestId, { segments });
    } catch (err) {
      void submit(requestId, { error: err instanceof Error ? err.message : String(err) });
    }
  }, [agent, projectRoot]);

  // M9 Phase 7 — the agent asks the renderer to OCR an in-project scan. The
  // consent gate is upstream (dispatch checks the per-project flag); by the
  // time a request lands here the scholar has approved the cloud upload.
  // pdf.js rasterisation and the signed-in process-ocr call are both browser
  // APIs, so this can only run renderer-side (like transcribe / research).
  const handleOcr = useCallback(async (requestId: string, scanPath: string, lang: string, pagesSpec?: string) => {
    const submit = agent?.submitOcr;
    const fsApi = window.electronAPI?.projectFolder;
    if (!submit) return;
    if (!fsApi?.readAssetBytes || !projectRoot) {
      void submit(requestId, { error: "OCR needs the desktop app." });
      return;
    }
    void lang; // the cloud OCR model is language-agnostic; hint kept for the schema
    const wanted = (() => {
      const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec((pagesSpec ?? "").trim());
      if (!m) return null;
      const from = Number(m[1]);
      const to = m[2] ? Number(m[2]) : from;
      return { from, to };
    })();
    try {
      // Lazy — pdfjs-dist pulls DOM globals (DOMMatrix) that a jsdom test env lacks.
      const [{ renderPdfPages }, { ocrPageImage }] = await Promise.all([
        import("@/lib/ocr/pdfRenderer"),
        import("@/lib/ocr/ocrClient"),
      ]);
      const bytes = await fsApi.readAssetBytes(projectRoot, scanPath);
      const name = scanPath.split("/").pop() ?? "scan";
      const isPdf = name.toLowerCase().endsWith(".pdf");
      const pages: Array<{ page: number; text: string }> = [];

      if (isPdf) {
        const file = new File([bytes], name, { type: "application/pdf" });
        for await (const rendered of renderPdfPages(file)) {
          if (wanted && (rendered.pageNum < wanted.from || rendered.pageNum > wanted.to)) continue;
          const text = await ocrPageImage(rendered.imageBase64, rendered.mimeType);
          pages.push({ page: rendered.pageNum, text });
        }
      } else {
        let binary = "";
        const view = new Uint8Array(bytes);
        for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
        const text = await ocrPageImage(btoa(binary), "image/jpeg");
        pages.push({ page: 1, text });
      }
      void submit(requestId, { pages });
    } catch (err) {
      void submit(requestId, { error: err instanceof Error ? err.message : String(err) });
    }
  }, [agent, projectRoot]);

  useEffect(() => {
    if (!agent?.onProgress) return;
    return agent.onProgress((p) => {
      if (p.id) runIdRef.current = p.id;
      if (p.kind === "general-search-request" && p.requestId && typeof p.query === "string") {
        void handleResearch(p.requestId, p.query, p.mode === "islamic" ? "islamic" : "general");
        return;
      }
      if (p.kind === "transcribe-request" && p.requestId && typeof p.mediaPath === "string") {
        void handleTranscribe(p.requestId, p.mediaPath, typeof p.lang === "string" ? p.lang : "auto");
        return;
      }
      if (p.kind === "ocr-request" && p.requestId && typeof p.scanPath === "string") {
        void handleOcr(p.requestId, p.scanPath, typeof p.lang === "string" ? p.lang : "auto", typeof p.pages === "string" ? p.pages : undefined);
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
  }, [agent, handleResearch, handleTranscribe, handleOcr]);

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
      assets,
    }),
    [pf.chapters, ws?.documentOutline, shamelaBooks, assets],
  );

  // ── M9 Phase 3: drag a recording / scan / font onto the panel ──────────
  const importFiles = useCallback(async (files: FileList | File[]) => {
    const fsApi = window.electronAPI?.projectFolder;
    if (!fsApi?.importAsset || !projectRoot) return;
    setImporting(true);
    const added: string[] = [];
    try {
      for (const file of Array.from(files)) {
        try {
          const asset = await fsApi.importAsset(projectRoot, file.name, await file.arrayBuffer());
          added.push(asset.name.split("/").pop() ?? asset.name);
        } catch (err) {
          log.warn("importAsset failed", { name: file.name, err });
        }
      }
      if (added.length) {
        await refreshAssets();
        setInput((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}${added.map((n) => `@${n}`).join(" ")} `);
        requestAnimationFrame(() => taRef.current?.focus());
      }
    } finally {
      setImporting(false);
    }
  }, [projectRoot, refreshAssets]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes("Files")) { e.preventDefault(); setIsDragOver(true); }
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files?.length) void importFiles(e.dataTransfer.files);
  }, [importFiles]);

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
    setProgressExpanded(false);
    setHubOpen(false);
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

  // M9 Phase 7 — ocr_document is consent-gated: its first call returns
  // `needsConsent` and uploads nothing. The scholar approves the cloud upload
  // for this project here, then re-runs the task (ADR-0023).
  interface OcrConsent { needsConsent?: boolean; scanPath?: string; message?: string }
  const pendingOcr = useMemo<OcrConsent[]>(() => {
    if (!result) return [];
    return result.toolCalls
      .filter((tc) => tc.name === "ocr_document")
      .map((tc) => tc.result as OcrConsent)
      .filter((r) => r?.needsConsent);
  }, [result]);
  const [ocrGranted, setOcrGranted] = useState(false);
  useEffect(() => { setOcrGranted(false); }, [result]);
  const grantOcr = useCallback(async () => {
    if (!agent?.grantOcrConsent || !projectRoot) return;
    try { await agent.grantOcrConsent(projectRoot); setOcrGranted(true); }
    catch (err) { log.error("grant OCR consent failed", { err }); }
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
    <div
      className="flex flex-col h-full relative"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {(isDragOver || importing) && (
        <div className="absolute inset-0 z-30 m-1 flex items-center justify-center rounded border border-dashed border-primary bg-primary/10 text-sm font-medium text-primary">
          {importing
            ? t("agent.importing", "Adding files to the project…")
            : t("agent.drop_files", "Drop recordings, scans, fonts, or templates to add them")}
        </div>
      )}
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

          {(() => {
            const stepLines = progress.filter((p) => p.label && p.kind !== "thinking");
            // While running, the live lines ARE the trust surface — show them all.
            // Once done, collapse a long run into one "Ran N steps ›" card.
            const collapsed = !running && !!result && stepLines.length > 3 && !progressExpanded;
            if (stepLines.length === 0) return null;
            if (collapsed) {
              const errs = stepLines.filter((p) => p.kind === "error").length;
              return (
                <button
                  className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setProgressExpanded(true)}
                >
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  {t("agent.ran_steps", "Ran {n} steps").replace("{n}", String(stepLines.length))}
                  {errs > 0 && <span className="text-amber-600">· {errs}</span>}
                </button>
              );
            }
            return (
              <div className="space-y-1.5">
                {!running && result && stepLines.length > 3 && (
                  <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setProgressExpanded(false)}>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    {t("agent.collapse_steps", "Hide steps")}
                  </button>
                )}
                {stepLines.map((p, i) => (
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
              </div>
            );
          })()}

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
              {pendingOcr.length > 0 && (
                <div className="rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs space-y-1.5">
                  <p className="font-medium text-amber-700 dark:text-amber-400">
                    {t("agent.ocr_consent", "OCR sends the page images to the EasyEditor cloud OCR service — this is not a local reading. Approve it for this project?")}
                  </p>
                  {pendingOcr[0]?.scanPath && <p className="font-mono opacity-80">{pendingOcr[0].scanPath}</p>}
                  {ocrGranted ? (
                    <p className="text-muted-foreground">{t("agent.ocr_consent_granted", "OCR approved for this project — run the task again.")}</p>
                  ) : (
                    <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void grantOcr()}>
                      {t("agent.ocr_consent_approve", "Approve cloud OCR for this project")}
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
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          accept=".mp3,.m4a,.wav,.ogg,.flac,.mp4,.mkv,.mov,.webm,.pdf,.png,.jpg,.jpeg,.tif,.tiff,.ttf,.otf,.ttc,.dotx,.dotm,.txt,.md"
          onChange={(e) => { if (e.target.files?.length) void importFiles(e.target.files); e.target.value = ""; }}
        />
        {hubOpen && (
          <div className="absolute bottom-full start-2 mb-1 w-64 rounded-md border border-border bg-popover p-1 text-xs shadow-md">
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start hover:bg-muted" onClick={() => { setHubOpen(false); fileInputRef.current?.click(); }}>
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {t("agent.hub_add_files", "Add recordings, scans, fonts…")}
            </button>
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start hover:bg-muted" onClick={() => { setHubOpen(false); pf.openFolder(); }}>
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {t("agent.hub_change_folder", "Change project folder")}
            </button>
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start hover:bg-muted" onClick={() => { setHubOpen(false); updateInput("/", 1); taRef.current?.focus(); }}>
              <ScrollText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {t("agent.hub_playbooks", "Playbooks  (/)")}
            </button>
            <div className="my-1 border-t border-border" />
            <p className="flex items-center gap-1.5 px-2 pb-1 pt-0.5 text-muted-foreground">
              <Plug className="h-3.5 w-3.5 shrink-0" />
              {t("agent.hub_connectors", "Source connectors")}
            </p>
            {CONNECTORS.map((c) => {
              const on = isConnectorOn(connectors, c.id);
              return (
                <label key={c.id} className="flex cursor-pointer items-center justify-between rounded px-2 py-1 hover:bg-muted">
                  <span>{c.label}</span>
                  <input type="checkbox" className="accent-primary" checked={on} onChange={(e) => void toggleConnector(c.id, e.target.checked)} />
                </label>
              );
            })}
          </div>
        )}
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
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9 shrink-0"
            onClick={() => setHubOpen((v) => !v)}
            disabled={running}
            aria-label={t("agent.hub_open", "Add files, folders, playbooks, connectors")}
            title={t("agent.hub_open", "Add files, folders, playbooks, connectors")}
          >
            <Plus className={`h-4 w-4 transition-transform ${hubOpen ? "rotate-45" : ""}`} />
          </Button>
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
        {/* Context stats pill — where the work is going and what's connected. */}
        <div className="mt-1 flex items-center gap-1 overflow-hidden text-xs text-muted-foreground" title={t("agent.caps_title", "This machine's capabilities")}>
          <FolderOpen className="h-3 w-3 shrink-0 opacity-60" />
          <span className="truncate max-w-[38%]">{pf.folder?.manifest.title}</span>
          <span className="opacity-40">·</span>
          <span className="shrink-0">{t("agent.pill_chapters", "{n} ch").replace("{n}", String(pf.chapters.length))}</span>
          {(() => { const off = CONNECTORS.filter((c) => !isConnectorOn(connectors, c.id)).length; return off > 0 ? (
            <><span className="opacity-40">·</span><span className="shrink-0 text-amber-600">{t("agent.pill_connectors_off", "{n} source off").replace("{n}", String(off))}</span></>
          ) : null; })()}
          <span className="opacity-40">·</span>
          <span className="truncate">{caps ?? t("agent.pill_word_off", "Word off")}</span>
        </div>
      </div>
    </div>
  );
};
