import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useProjectFolderContext } from "@/core/projectFolder/context";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { logger } from "@/lib/logger";
import { decodeAudioFile, encodeChunkToWav, chunkAudioBuffer } from "@/lib/audio/chunker";
import { streamResearchQuery, streamIslamicQuery } from "@/lib/research/streamers";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useWebAgentEngine } from "@/hooks/useWebAgentEngine";
import type { CitationItem } from "~shared/research/citationTypes";
import type { AgentArtifactEvent } from "~shared/agent/types";
import {
  buildMentions, filterMentions, activeTriggerQuery, applyMention, applyLibraryTag,
  type Mention, type ScopeKind,
} from "../../shared/mentions";
import { PLAYBOOKS } from "../../shared/playbooks/registry";
import { applyArtifactEvent, type ArtifactState } from "@/components/workspace/agentArtifactState";
import { getShamelaClient } from "@/core/shamela/shamelaClient";
import { deriveRunStats } from "~shared/agent/runStats";
import { recommendActions, RECOMMENDATION_PROMPT, type RecommendedAction } from "~shared/agent/recommendations";

const log = logger.child("useAgentRun");

const mkTurnId = (): string =>
  `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export type AgentMode = "ask" | "plan" | "auto";
export interface ProgressLine { step: number; label: string; labelKey?: string; kind: string; detail?: string }
/**
 * M11 Phase 1 — one finished exchange in the conversation. `agent.run()` is
 * memory-less, so the renderer keeps the thread: past turns render as bubbles
 * in the timeline AND are handed back to the engine as `history` on the next
 * send (shared/agent/history.ts turns them into user/model messages).
 */
export interface AgentTurn {
  id: string;
  /** the user's message, verbatim */
  instruction: string;
  /** the finished run */
  result: RunResult;
}
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
export type PickerItem = { kind: "mention" | "command" | "library"; label: string; sublabel?: string; section?: string; apply: () => void };

/** Plan §4.4 — a removable scope chip. Multi-book (`#` group) chips carry the
 *  concrete pruned book list; `/` and `@` chips carry a single ref. */
export interface ScopeTag {
  kind: "#" | "/" | "@";
  id: string;
  label: string;
  ref: string;
  scopeType?: ScopeKind;
  /** '#' author/category/century — every concrete book ref after review. */
  resolvedBookRefs?: string[];
  /** So the review dialog can re-open on the same filter. */
  sourceFilter?: { authorId?: number; categoryId?: number; century?: number; query?: string };
  /** null | 'per-book' | 'per-author' — chosen in the review dialog. */
  execMode?: "search" | "per-book" | "per-author";
}

/** What `send()` hands the engine (plan §4.4). `scope` is optional everywhere. */
export interface AgentScope {
  books: string[];
  groups: Array<{ type: ScopeKind; ref: string; label: string; bookRefs: string[] }>;
  playbook: string | null;
  mentions: string[];
  batch: { granularity: "per-book" | "per-author" } | null;
}

/** A pending "review this group's books" request the composer opens a dialog for. */
export interface ScopeReviewRequest {
  scopeType: Exclude<ScopeKind, "book">;
  ref: string;
  label: string;
  filter: { authorId?: number; categoryId?: number; century?: number };
}

export type LibraryPickerRow = {
  section: "book" | "author" | "category" | "century";
  label: string;
  sublabel?: string;
  ref: string;
  source: "shamela" | "jkhssn" | "corpus";
  /** For author/category/century — opens the review dialog instead of applying. */
  review?: ScopeReviewRequest;
};

/**
 * The progress-callback shape both platforms deliver: desktop's
 * `window.electronAPI.agent.onProgress` (preload.ts's own declared contract,
 * `kind: string`) and the web engine's `run()` (which only ever sends real
 * `AgentProgress` values, a strict subtype of this). Loosely typed on
 * purpose — see handleProgress's own comment. `id` is an IPC-envelope field
 * the web path never sends.
 */
interface ProgressEvent {
  id?: string; step?: number; label?: string; labelKey?: string; kind: string; detail?: string;
  requestId?: string; query?: string; question?: string;
  mode?: "general" | "islamic";
  mediaPath?: string; lang?: string;
  scanPath?: string; pages?: string;
  artifact?: AgentArtifactEvent;
}

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
  // M10 Phase 2.1 — the web counterpart of `agent` above. Mutually exclusive
  // by construction: `available` is false whenever `agent` exists.
  const webAgent = useWebAgentEngine();

  const [mode, setMode] = useState<AgentMode>("ask");
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ProgressLine[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactState[]>([]);
  // Plan §5.1 — which artifact the stage is showing (defaults to last-opened).
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const [planPending, setPlanPending] = useState(false);
  // M11 Phase 1 — the conversation so far. `result`/`progress`/`artifacts`
  // above describe the CURRENT (or most recent) run; `turns` holds every
  // finished run before it, both to render and to feed back as `history`.
  const [turns, setTurns] = useState<AgentTurn[]>([]);
  // M11 Phase 2 — a message typed while a run is in flight (one slot).
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);
  const lastInstructionRef = useRef<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [caps, setCaps] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ kind: "mention" | "command" | "library"; query: string } | null>(null);
  const [pickerActiveIndex, setPickerActiveIndex] = useState(0);
  const [shamelaBooks, setShamelaBooks] = useState<Array<{ id: string; title: string }>>([]);
  const [libraryRows, setLibraryRows] = useState<LibraryPickerRow[]>([]);
  const [scopeTags, setScopeTags] = useState<ScopeTag[]>([]);
  const [scopeReview, setScopeReview] = useState<ScopeReviewRequest | null>(null);
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

  // `connectors` is the per-project map (what the `+` popover writes).
  // `connectorState` is the merged view (global ∩ project) the model actually
  // sees; `connectorGlobal` says whether a connector is off machine-wide, so
  // the popover can grey a row and point to Settings.
  const [connectorState, setConnectorState] = useState<Record<string, boolean>>({});
  const [connectorGlobal, setConnectorGlobal] = useState<Record<string, boolean>>({});

  const refreshConnectors = useCallback(async () => {
    const fsApi = window.electronAPI?.projectFolder;
    if (fsApi?.getConnectors && projectRoot) {
      fsApi.getConnectors(projectRoot).then(setConnectors).catch(() => setConnectors({}));
    }
    const hub = window.electronAPI?.connectors;
    if (hub?.list) {
      try {
        const r = await hub.list(projectRoot ?? undefined);
        setConnectorState(r.merged);
        setConnectorGlobal(r.global);
      } catch (err) { log.debug("connectors.list failed", { err }); }
    }
  }, [projectRoot]);

  useEffect(() => { void refreshConnectors(); }, [refreshConnectors]);

  const toggleConnector = useCallback(async (id: string, on: boolean) => {
    const fsApi = window.electronAPI?.projectFolder;
    if (!fsApi?.setConnector || !projectRoot) return;
    setConnectors((prev) => ({ ...prev, [id]: on }));
    setConnectorState((prev) => ({ ...prev, [id]: on }));
    try { setConnectors(await fsApi.setConnector(projectRoot, id, on)); }
    catch (err) { log.warn("setConnector failed", { err }); }
    void refreshConnectors();
  }, [projectRoot, refreshConnectors]);

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

  // Shared by desktop's IPC event subscription (below) AND the web engine's
  // direct callback (send(), further down) — same progress shape either way,
  // just delivered without an IPC hop on web.
  const handleProgress = useCallback((p: ProgressEvent) => {
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
      const ev = p.artifact;
      setArtifacts((prev) => applyArtifactEvent(prev, ev));
      // A freshly opened artifact becomes the active one on the stage.
      if (ev.op === "open") setActiveArtifactId(ev.artifactId);
      return;
    }
    if (p.kind === "plan-pending") {
      setPlanPending(true);
      if (p.label) setProgress((prev) => [...prev, { step: 0, label: p.label!, labelKey: p.labelKey, kind: "plan-pending" }]);
      return;
    }
    setProgress((prev) => [...prev, { step: p.step ?? 0, label: p.label ?? "", labelKey: p.labelKey, kind: p.kind, detail: p.detail }]);
  }, [handleResearch, handleTranscribe, handleOcr]);

  useEffect(() => {
    if (!agent?.onProgress) return;
    return agent.onProgress(handleProgress);
  }, [agent, handleProgress]);

  const decidePlan = useCallback(async (decision: "approved" | "rejected") => {
    setPlanPending(false);
    const id = runIdRef.current;
    if (id && agent?.approvePlan) { try { await agent.approvePlan(id, decision); } catch (err) { log.error("approvePlan failed", { err }); } }
    else webAgent.decidePlan(decision);
  }, [agent, webAgent]);

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
    setPickerActiveIndex(0);
    if (text.startsWith("/")) {
      setPicker({ kind: "command", query: text.slice(1) });
      return;
    }
    // `#` (mid-text, like `@`) opens the library scope picker — checked first.
    const hash = activeTriggerQuery(text, caret, "#");
    if (hash) { setPicker({ kind: "library", query: hash.query }); return; }
    const at = activeTriggerQuery(text, caret, "@");
    setPicker(at ? { kind: "mention", query: at.query } : null);
  }, []);

  // ── `#` library scope lookup (plan §4.1) — books + authors + categories +
  //    centuries, from Shamela + JKHSSN + the personal corpus. Debounced.
  const CENTURY_LABELS = useMemo(
    () => ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر"],
    [],
  );
  useEffect(() => {
    if (picker?.kind !== "library") { setLibraryRows([]); return; }
    const q = picker.query.trim();
    if (q.length < 2) { setLibraryRows([]); return; }
    let cancelled = false;
    const handle = setTimeout(async () => {
      const rows: LibraryPickerRow[] = [];
      const client = getShamelaClient();
      try {
        const [books, authors, cats] = await Promise.all([
          client.searchBooks(q, 6).catch(() => []),
          client.searchAuthors(q, 5).catch(() => []),
          client.listCategories().catch(() => []),
        ]);
        for (const b of books) rows.push({ section: "book", label: b.title, sublabel: b.author ?? undefined, ref: `shamela:${b.id}`, source: "shamela" });
        for (const a of authors) {
          rows.push({
            section: "author", label: a.name, sublabel: a.bookCount ? `${a.bookCount}` : undefined,
            ref: `author:${a.id}`, source: "shamela",
            review: { scopeType: "author", ref: `author:${a.id}`, label: a.name, filter: { authorId: a.id } },
          });
        }
        for (const c of cats.filter((x) => x.name.includes(q)).slice(0, 4)) {
          rows.push({
            section: "category", label: c.name, sublabel: `${c.bookCount}`, ref: `category:${c.id}`, source: "shamela",
            review: { scopeType: "category", ref: `category:${c.id}`, label: c.name, filter: { categoryId: c.id } },
          });
        }
        // Century: match the Arabic ordinal in the label (never a bare digit).
        CENTURY_LABELS.forEach((label, i) => {
          if (label.includes(q) || `القرن ${label}`.includes(q)) {
            rows.push({
              section: "century", label: `القرن ${label}`, ref: `century:${i + 1}`, source: "shamela",
              review: { scopeType: "century", ref: `century:${i + 1}`, label: `القرن ${label}`, filter: { century: i + 1 } },
            });
          }
        });
      } catch (err) {
        log.debug("library scope lookup failed", { err });
      }
      // JKHSSN authors (desktop) as extra `book`-ish entries.
      try {
        const jk = typeof window !== "undefined" ? window.electronAPI?.jkhssn : undefined;
        if (jk?.searchBooks) {
          const hits = await jk.searchBooks(q, 4);
          for (const h of hits) rows.push({ section: "book", label: h.title, sublabel: "جوامع الكلم", ref: `jkhssn:${h.id}`, source: "jkhssn" });
        }
      } catch { /* jkhssn optional */ }
      if (!cancelled) setLibraryRows(rows);
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [picker, CENTURY_LABELS]);

  const addScopeTag = useCallback((tag: Omit<ScopeTag, "id">) => {
    setScopeTags((prev) => {
      if (prev.some((t) => t.kind === tag.kind && t.ref === tag.ref)) return prev;
      return [...prev, { ...tag, id: `${tag.kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` }];
    });
  }, []);

  const removeScopeTag = useCallback((id: string) => {
    setScopeTags((prev) => {
      const tag = prev.find((t) => t.id === id);
      if (tag) {
        // Strip the cosmetic inline token from the input (chips are authoritative).
        const token = `${tag.kind === "@" ? "@" : tag.kind === "/" ? "/" : "#"}${tag.label}`;
        setInput((val) => val.replace(token, "").replace(/\s{2,}/g, " ").replace(/^\s+/, ""));
      }
      return prev.filter((t) => t.id !== id);
    });
  }, []);

  const clearScope = useCallback(() => setScopeTags([]), []);

  // Plan §5.1 — drop one artifact from the stage.
  const dismissArtifact = useCallback((id: string) => {
    setArtifacts((prev) => prev.filter((a) => a.id !== id));
    setActiveArtifactId((cur) => (cur === id ? null : cur));
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
          apply: () => {
            setInput(p.trigger ? `/${p.trigger} ` : `${p.title} `);
            addScopeTag({ kind: "/", label: p.trigger ?? p.id, ref: p.id });
            setPicker(null);
            taRef.current?.focus();
          },
        }));
    }
    if (picker.kind === "library") {
      const sectionOrder = { book: 0, author: 1, category: 2, century: 3 } as const;
      const sorted = [...libraryRows].sort((a, b) => sectionOrder[a.section] - sectionOrder[b.section]);
      return sorted.map((row) => ({
        kind: "library" as const,
        section: row.section,
        label: row.label,
        sublabel: row.sublabel,
        apply: () => {
          if (row.review) {
            setScopeReview(row.review);
            setPicker(null);
            return;
          }
          // A single book — apply immediately.
          const ta = taRef.current;
          const value = ta?.value ?? input;
          const caret = ta?.selectionStart ?? value.length;
          const next = applyLibraryTag(value, caret, row.label);
          setInput(next.text);
          addScopeTag({ kind: "#", label: row.label, ref: row.ref, scopeType: "book" });
          setPicker(null);
          requestAnimationFrame(() => { ta?.focus(); ta?.setSelectionRange(next.caret, next.caret); });
        },
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
        addScopeTag({ kind: "@", label: m.label, ref: m.ref });
        setPicker(null);
        requestAnimationFrame(() => { ta?.focus(); ta?.setSelectionRange(next.caret, next.caret); });
      },
    }));
  }, [picker, mentions, input, libraryRows, addScopeTag]);

  /** Called by the ScopeReviewDialog on confirm — creates the multi-book chip. */
  const confirmScopeReview = useCallback((tag: Omit<ScopeTag, "id">) => {
    setInput((val) => {
      const ta = taRef.current;
      const caret = ta?.selectionStart ?? val.length;
      // If the `#` token is still in the box, swap it for the label; else append.
      const hash = activeTriggerQuery(val, caret, "#");
      return hash ? applyLibraryTag(val, caret, tag.label).text : `${val}${val && !val.endsWith(" ") ? " " : ""}#${tag.label} `;
    });
    addScopeTag(tag);
    setScopeReview(null);
    requestAnimationFrame(() => taRef.current?.focus());
  }, [addScopeTag]);

  // M11 Phase 1 — a fresh project folder is a fresh conversation.
  const clearConversation = useCallback(() => {
    setTurns([]);
    setResult(null);
    setProgress([]);
    setArtifacts([]);
    setActiveArtifactId(null);
    setPlanPending(false);
    lastInstructionRef.current = null;
  }, []);
  useEffect(() => { clearConversation(); }, [projectRoot, clearConversation]);

  const send = useCallback(async (override?: string) => {
    const typed = (override ?? input).trim();
    const desktopReady = Boolean(agent && projectRoot);
    // M10 Phase 2.1 — the web path needs no project folder, only an open
    // document; `webAgent.available` already checks agent is absent so the
    // two paths can never both fire for the same send().
    if (!typed || !(desktopReady || webAgent.available)) return;
    // M11 Phase 2 — a run is in flight: queue this message and flush it when
    // the run finishes (the effect below). One slot — a second queued message
    // replaces the first.
    if (running) {
      if (!override) { setQueuedMessage(typed); setInput(""); }
      return;
    }
    const instruction = typed;

    // M11 Phase 1 — fold the previous finished run into the conversation, then
    // hand the whole thread to the engine as `history`. A `needs-input` run
    // contributes its clarifying question as the "answer" so the model sees
    // what it asked (this replaces the old string-concat `pendingClarification`
    // hack — real turns carry the same context, and more of it).
    const archived: AgentTurn[] =
      result && lastInstructionRef.current
        ? [...turns, { id: mkTurnId(), instruction: lastInstructionRef.current, result }]
        : turns;
    if (archived !== turns) setTurns(archived);
    const history = archived
      .map((tn) => ({
        instruction: tn.instruction,
        answer: (tn.result.question?.trim() || tn.result.answer || "").trim(),
      }))
      .filter((h) => h.instruction || h.answer);
    lastInstructionRef.current = instruction;

    setRunning(true);
    setProgress([]);
    setResult(null);
    setArtifacts([]);
    setActiveArtifactId(null);
    setPlanPending(false);
    setProgressExpanded(false);
    setHubOpen(false);
    setPicker(null);

    // Plan §4.4 — the structured scope the chips describe.
    const hashTags = scopeTags.filter((t) => t.kind === "#");
    const bookRefsOf = (t: ScopeTag): string[] => t.resolvedBookRefs ?? (t.scopeType === "book" || !t.scopeType ? [t.ref] : []);
    // Batch granularity comes off the chip's own execMode (chosen in the review
    // dialog), not a composer control (plan §4.2).
    const batchExec = hashTags.map((t) => t.execMode).find((m) => m === "per-book" || m === "per-author");
    const scope: AgentScope = {
      books: [...new Set(hashTags.flatMap(bookRefsOf))],
      groups: hashTags
        .filter((t) => t.scopeType && t.scopeType !== "book")
        .map((t) => ({ type: t.scopeType!, ref: t.ref, label: t.label, bookRefs: t.resolvedBookRefs ?? [] })),
      playbook: scopeTags.find((t) => t.kind === "/")?.ref ?? null,
      mentions: scopeTags.filter((t) => t.kind === "@").map((t) => t.ref),
      batch:
        desktopReady && batchExec && hashTags.some((t) => t.scopeType && t.scopeType !== "book")
          ? { granularity: batchExec as "per-book" | "per-author" }
          : null,
    };
    const hasScope = Boolean(scope.books.length || scope.groups.length || scope.playbook || scope.mentions.length || scope.batch);

    const historyArg = history.length ? history : undefined;
    const scopeArg = hasScope ? scope : undefined;
    try {
      const res = desktopReady
        ? await agent!.run(instruction, mode, projectRoot!, scopeArg, historyArg)
        : await webAgent.run(instruction, mode, handleProgress, scopeArg, historyArg);
      setResult(res as RunResult);
      // The turn goes into the conversation on the NEXT send (see `archived`
      // above) — until then it stays in the singleton `result`, which is what
      // renders the full interactive card (plan approval, consent, undo).
      setInput("");
      setScopeTags([]);
      if (desktopReady) void pf.refresh();
    } catch (err) {
      log.error("agent run failed", { err });
      setResult({ answer: "", stopReason: "error", steps: 0, toolCalls: [], error: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
      setPlanPending(false);
    }
  }, [input, agent, projectRoot, running, mode, pf, result, turns, webAgent, handleProgress, scopeTags]);

  const cancel = useCallback(() => { void agent?.cancel(); webAgent.cancel(); }, [agent, webAgent]);

  // M11 Phase 2 — flush the queued message once the current run finishes.
  // `send` is deliberately kept OUT of the deps (via a ref): it is recreated on
  // most renders, and depending on it would fire this effect every render —
  // an update loop, since the effect also triggers setState through `send`.
  const sendRef = useRef(send);
  useEffect(() => { sendRef.current = send; });
  useEffect(() => {
    if (running || !queuedMessage) return;
    const next = queuedMessage;
    setQueuedMessage(null);
    void sendRef.current(next);
  }, [running, queuedMessage]);

  const cancelQueued = useCallback(() => setQueuedMessage(null), []);
  const editQueued = useCallback(() => {
    if (queuedMessage) setInput(queuedMessage);
    setQueuedMessage(null);
    requestAnimationFrame(() => taRef.current?.focus());
  }, [queuedMessage]);
  // A fresh conversation drops any pending message too.
  useEffect(() => { setQueuedMessage(null); }, [projectRoot]);

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

  // M11 Phase 2 — live "⚙️ 3 tools · 2 sources" metrics, derived purely from
  // the progress lines already in state (no IPC change).
  const runStats = useMemo(() => deriveRunStats(progress), [progress]);

  // M11 Phase 2 — deterministic "what next?" chips after an answer (ADR-0049).
  const recommendations = useMemo<RecommendedAction[]>(() => {
    if (running || !result || result.error) return [];
    return recommendActions({
      artifacts: artifacts.map((a) => ({ id: a.id, type: a.type })),
      toolCalls: result.toolCalls,
      mode,
      hasProjectFolder: Boolean(projectRoot),
      activeArtifactId,
    });
  }, [running, result, artifacts, mode, projectRoot, activeArtifactId]);

  const applyRecommendation = useCallback((rec: RecommendedAction) => {
    if (rec.action === "open-artifact") {
      if (rec.artifactId) {
        setActiveArtifactId(rec.artifactId);
        ws?.setStageCollapsed?.(false);
      }
      return;
    }
    // Pre-fill only — the scholar reviews and sends.
    setInput(RECOMMENDATION_PROMPT[rec.action]);
    requestAnimationFrame(() => taRef.current?.focus());
  }, [ws]);

  return {
    t, language, pf, agent, projectRoot,
    // M10 Phase 2.1 — true when this hook can run a real agent turn on web
    // (no electronAPI.agent, and a document is open in the Canvas). The
    // capability's own on/off switch (registry.ts's wb.agent, VITE_AGENT_MODE)
    // is a separate, coarser gate the caller checks first.
    webAgentAvailable: webAgent.available,
    mode, setMode,
    input, setInput,
    running,
    progress,
    result,
    // M11 Phase 1 — the finished conversation before the current run.
    turns,
    clearConversation,
    // M11 Phase 2 — live metrics + deterministic follow-up chips + message queue.
    runStats,
    recommendations,
    applyRecommendation,
    queuedMessage,
    cancelQueued,
    editQueued,
    artifacts,
    activeArtifactId, setActiveArtifactId,
    dismissArtifact,
    planPending,
    showTools, setShowTools,
    caps,
    picker, setPicker,
    pickerItems,
    pickerActiveIndex, setPickerActiveIndex,
    // Plan §4 — the `#` / `/` / `@` scope chips + the review dialog + batch mode.
    scopeTags,
    removeScopeTag,
    clearScope,
    scopeReview,
    setScopeReview,
    confirmScopeReview,
    isDragOver,
    importing,
    hubOpen, setHubOpen,
    connectors,
    connectorState,
    connectorGlobal,
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

/**
 * SPEC M10 §1.2 — exactly the slice of `useAgentRun()`'s return value the
 * merged research+agent timeline needs to render a run's progress/result/
 * artifacts/plan-approval/consent cards. `Pick` against the hook's real
 * return type rather than a hand-duplicated interface, so this can never
 * silently drift out of sync with the hook it describes. Deliberately
 * excludes the composer-only fields (mode, input, picker, mentions,
 * dictation, drag-drop) — those stay in whatever renders the input box,
 * not the timeline.
 */
export type AgentRunView = Pick<
  ReturnType<typeof useAgentRun>,
  | "turns" | "clearConversation"
  | "runStats" | "recommendations" | "applyRecommendation"
  | "progress" | "result" | "artifacts" | "planPending"
  | "activeArtifactId" | "setActiveArtifactId" | "dismissArtifact"
  | "progressExpanded" | "setProgressExpanded"
  | "showTools" | "setShowTools"
  | "decidePlan"
  | "pendingOptions" | "optionsApplied" | "applyOptions" | "revertOptions"
  | "pendingOcr" | "ocrGranted" | "grantOcr"
  | "undone" | "undoTask"
>;
