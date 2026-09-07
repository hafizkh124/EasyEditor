import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useProjectFolderContext } from "@/core/projectFolder/context";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { logger } from "@/lib/logger";
import { decodeAudioFile, encodeChunkToWav, chunkAudioBuffer } from "@/lib/audio/chunker";
import { streamResearchQuery, streamIslamicQuery } from "@/lib/research/streamers";
import { useSubscription } from "@/contexts/SubscriptionContext";
import type { CitationItem } from "~shared/research/citationTypes";
import { buildMentions, filterMentions, activeMentionQuery, applyMention, type Mention } from "../../shared/mentions";
import { PLAYBOOKS } from "../../shared/playbooks/registry";
import { applyArtifactEvent, type ArtifactState } from "@/components/workspace/agentArtifactState";

const log = logger.child("useAgentRun");

export type AgentMode = "ask" | "plan" | "auto";
export interface ProgressLine { step: number; label: string; kind: string; detail?: string }
export interface RunResult {
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
export interface OptionConsent { needsConsent?: boolean; option?: string; value?: string; current?: string; message?: string }
export interface OcrConsent { needsConsent?: boolean; scanPath?: string; message?: string }
export type PickerItem = { kind: "mention" | "command"; label: string; apply: () => void };

/**
 * SPEC-M8 Layer 6 / P8b, extracted for SPEC M10 §1.2 — every stateful line
 * `AgentPanel.tsx` used to own, unchanged, so the merged research+agent
 * surface (and eventually a web dispatcher, once Phase 2 lands) can drive
 * the same engine a thin render layer used to embed directly. Pure
 * extraction: no behavior change, verified against the pre-existing
 * `agentPanel.test.tsx` (15 cases) without touching that file.
 */
export function useAgentRun() {
  const { t, language } = useLanguage();
  const pf = useProjectFolderContext();
  const ws = useOptionalWorkspace();
  const { subscription } = useSubscription();
  const agent = typeof window !== "undefined" ? window.electronAPI?.agent : undefined;

  const [mode, setMode] = useState<AgentMode>("ask");
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
          // The full in-project path (e.g. "media/dars-01.mp3"), not just the
          // basename — this is what gets @mentioned, and transcribe_media /
          // ocr_document need the real path to find the file.
          added.push(asset.name);
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

  const onDragOver = useCallback((e: DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes("Files")) { e.preventDefault(); setIsDragOver(true); }
  }, []);
  const onDragLeave = useCallback((e: DragEvent) => { e.preventDefault(); setIsDragOver(false); }, []);
  const onDrop = useCallback((e: DragEvent) => {
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

  const pickerItems = useMemo<PickerItem[]>(() => {
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

  // Each agent.run() is a fresh, memory-less run — there is no session-level
  // history. When a run stops with `needs-input`, the scholar's next message
  // is really a reply to that one clarifying question, not a new topic; the
  // UI's own "Reply below to continue" promises exactly that. Since the
  // model itself carries no memory of the question it asked, we compose the
  // continuation ourselves rather than sending the bare reply text.
  const [pendingClarification, setPendingClarification] = useState<{ instruction: string; question: string } | null>(null);
  useEffect(() => { setPendingClarification(null); }, [mode]);
  useEffect(() => { setPendingClarification(null); }, [projectRoot]);

  const send = useCallback(async () => {
    const typed = input.trim();
    if (!typed || !agent || !projectRoot || running) return;
    const instruction = pendingClarification
      ? `Original request: "${pendingClarification.instruction}"\nYou (the agent) asked: "${pendingClarification.question}"\nMy reply: "${typed}"`
      : typed;
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
      setPendingClarification(
        res.stopReason === "needs-input" && res.question ? { instruction, question: res.question } : null,
      );
      setInput("");
      void pf.refresh();
    } catch (err) {
      log.error("agent run failed", { err });
      setResult({ answer: "", stopReason: "error", steps: 0, toolCalls: [], error: err instanceof Error ? err.message : String(err) });
      setPendingClarification(null);
    } finally {
      setRunning(false);
      setPlanPending(false);
    }
  }, [input, agent, projectRoot, running, mode, pf, pendingClarification]);

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

  return {
    t, language, pf, agent, projectRoot,
    mode, setMode,
    input, setInput,
    running,
    progress,
    result,
    artifacts,
    planPending,
    showTools, setShowTools,
    caps,
    picker, setPicker,
    pickerItems,
    isDragOver,
    importing,
    hubOpen, setHubOpen,
    connectors,
    toggleConnector,
    progressExpanded, setProgressExpanded,
    taRef,
    fileInputRef,
    importFiles,
    onDragOver, onDragLeave, onDrop,
    decidePlan,
    updateInput,
    send,
    cancel,
    voice,
    recording,
    transcribing,
    toggleRecord,
    undone,
    undoTask,
    pendingOptions,
    optionsApplied,
    applyOptions,
    revertOptions,
    pendingOcr,
    ocrGranted,
    grantOcr,
  };
}
