import { contextBridge, ipcRenderer } from 'electron';
import { isAllowedIpcChannel, ALLOWED_IPC_CHANNELS } from './ipc/registry.js';
import type {
  VoiceSynthesizeRequest,
  VoiceSynthesizeResult,
  VoiceTranscribeRequest,
  VoiceModelInfo,
  TranscriptSegment,
  AudiobookExportRequest,
  AudiobookExportProgress,
  AudiobookExportResult,
} from '../src/core/voice/types.js';

/**
 * Preload script — the only bridge between renderer and main.
 *
 * `contextIsolation: true` keeps the renderer away from Node builtins, but it
 * does nothing about which IPC channels the renderer may reach. That is this
 * file's job, and it is why `invoke` validates against the registry rather
 * than forwarding whatever string it is handed (SPEC-M5 FR-2.2).
 *
 * The distinction matters as soon as M5.2 and M5.3 land: once `ai:*` and
 * `workspace:*` handlers exist, an unvalidated pass-through would let any
 * injected script in the renderer read the user's local database or drive
 * their BYOK-billed Gemini key. An allowlist that is written down but never
 * consulted is not an allowlist.
 */

const electronAPI = {
  isDesktop: true as const,

  getVersion: (): Promise<string> =>
    ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SYSTEM_GET_VERSION),

  openExternal: (url: string): Promise<boolean> =>
    ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL, url),
  setTitle: (title: string): Promise<void> =>
    ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SYSTEM_SET_TITLE, title),

  /**
   * Generic invoke, restricted to registered channels.
   *
   * Typed per-domain wrappers are added alongside their handlers in later
   * milestones; this keeps the surface honest until then.
   */
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> => {
    if (typeof channel !== 'string' || !isAllowedIpcChannel(channel)) {
      return Promise.reject(
        new Error(
          `IPC channel not allowed: ${String(channel)}. ` +
            'Register it in electron/ipc/registry.ts if it is genuinely needed.',
        ),
      );
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  byok: {
    saveKey: (key: string): Promise<boolean> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.AI_SAVE_KEY, key),
    getKeyStatus: (): Promise<{ hasKey: boolean; lastFour: string | null }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.AI_GET_KEY_STATUS),
    deleteKey: (): Promise<boolean> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.AI_DELETE_KEY),
    testKey: (key?: string): Promise<{ success: boolean; message: string }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.AI_TEST_KEY, key),
    onStreamChunk: (channelId: string, callback: (data: { chunk?: string; done?: boolean; error?: string }) => void) => {
      const listener = (_event: unknown, data: { chunk?: string; done?: boolean; error?: string }) => callback(data);
      ipcRenderer.on(channelId, listener);
      return () => {
        ipcRenderer.removeListener(channelId, listener);
      };
    },
  },

  auth: {
    /**
     * Fires when the OS hands the app an `easyeditor://` OAuth callback. The
     * renderer owns the Supabase client, so it — not main — completes the
     * session from the URL. Returns an unsubscribe function, same shape as
     * `voice.onDownloadProgress`.
     */
    onDeepLink: (callback: (url: string) => void): (() => void) => {
      const listener = (_event: unknown, url: string) => callback(url);
      ipcRenderer.on(ALLOWED_IPC_CHANNELS.AUTH_DEEP_LINK, listener);
      return () => {
        ipcRenderer.removeListener(ALLOWED_IPC_CHANNELS.AUTH_DEEP_LINK, listener);
      };
    },
  },

  voice: {
    synthesize: (request: VoiceSynthesizeRequest): Promise<VoiceSynthesizeResult> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.VOICE_SYNTHESIZE, request),
    transcribe: (request: VoiceTranscribeRequest): Promise<TranscriptSegment[]> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.VOICE_TRANSCRIBE, request),
    getModels: (): Promise<VoiceModelInfo[]> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.VOICE_GET_MODELS),
    downloadModel: (modelId: string): Promise<string> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.VOICE_DOWNLOAD_MODEL, modelId),
    onDownloadProgress: (callback: (progress: { modelId: string; downloadedBytes: number; totalBytes: number; percent: number }) => void): (() => void) => {
      const listener = (_event: unknown, progress: { modelId: string; downloadedBytes: number; totalBytes: number; percent: number }) => callback(progress);
      ipcRenderer.on(ALLOWED_IPC_CHANNELS.VOICE_DOWNLOAD_MODEL_PROGRESS, listener);
      return () => {
        ipcRenderer.removeListener(ALLOWED_IPC_CHANNELS.VOICE_DOWNLOAD_MODEL_PROGRESS, listener);
      };
    },
    deleteModel: (modelId: string): Promise<void> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.VOICE_DELETE_MODEL, modelId),
    getSidecarStatus: (): Promise<{ installed: boolean; version?: string; modelsAvailable: string[] }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.VOICE_SIDECAR_STATUS),
    installSidecar: (): Promise<{ success: boolean; message: string }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.VOICE_SIDECAR_INSTALL),
    saveCloneSample: (buffer: ArrayBuffer, filename: string): Promise<string> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.VOICE_SAVE_CLONE_SAMPLE, buffer, filename),
    exportAudiobook: (request: AudiobookExportRequest): Promise<AudiobookExportResult> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.VOICE_EXPORT_AUDIOBOOK, request),
    cancelAudiobook: (): Promise<void> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.VOICE_CANCEL_AUDIOBOOK),
    onAudiobookProgress: (callback: (progress: AudiobookExportProgress) => void): (() => void) => {
      const listener = (_event: unknown, progress: AudiobookExportProgress) => callback(progress);
      ipcRenderer.on(ALLOWED_IPC_CHANNELS.VOICE_EXPORT_AUDIOBOOK_PROGRESS, listener);
      return () => {
        ipcRenderer.removeListener(ALLOWED_IPC_CHANNELS.VOICE_EXPORT_AUDIOBOOK_PROGRESS, listener);
      };
    },
  },

  shamela: {
    detect: (): Promise<{ installed: boolean; path: string | null; version?: string; reason?: string; masterDbPath?: string | null; s2DbPath?: string | null }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'detect' }),
    diagnose: (): Promise<{ jreFound: boolean; jreVersion: string | null; luceneJarsFound: boolean; luceneVersion: string | null; masterDbFound: boolean; storeIndexFound: boolean; bookCount: number; errors: string[] }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'diagnose' }),
    savePath: (path: string): Promise<{ installed: boolean; path: string | null; version?: string; reason?: string }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'savePath', path }),
    search: (query: string, limit?: number): Promise<Array<{ bookId: string; bookTitle: string; pageNumber: number; snippet: string; score: number }>> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'search', query, limit }),
    readPage: (bookId: string, pageNumber: number): Promise<{ bookId: string; pageNumber: number; text: string; footnotes?: string }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'readPage', bookId, pageNumber }),
    readToc: (bookId: string): Promise<Array<{ titleId: string; text: string; page: number; parent: string; depth: number }>> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'readToc', bookId }),
    pageCount: (bookId: string): Promise<number> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'pageCount', bookId }),
    readBook: (bookId: string): Promise<{ bookId: string; pageCount: number; pages: Array<{ page: string; text: string; footnotes?: string }> }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'readBook', bookId }),

    // ── Catalogue (master.db metadata) ────────────────────────────
    catalogueStats: (masterDbPath: string): Promise<{ totalBooks: number; totalAuthors: number; totalCategories: number }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'catalogue:stats', masterDbPath }),
    searchBooks: (masterDbPath: string, query: string, limit?: number, offset?: number): Promise<Array<{ id: number; title: string; author: string | null; category: string | null; deathYear: number | null; bookType: number | null; info: string | null }>> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'catalogue:searchBooks', masterDbPath, query, limit, offset }),
    listCategories: (masterDbPath: string): Promise<Array<{ id: number; name: string; parentId: number | null; bookCount: number }>> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'catalogue:listCategories', masterDbPath }),
    booksByCategory: (masterDbPath: string, categoryId: number, limit?: number, offset?: number): Promise<Array<{ id: number; title: string; author: string | null; category: string | null; deathYear: number | null; bookType: number | null; info: string | null }>> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'catalogue:booksByCategory', masterDbPath, categoryId, limit, offset }),
    authors: (masterDbPath: string, limit?: number, offset?: number): Promise<Array<{ id: number; name: string; deathNumber: number | null; deathText: string | null; bookCount: number; alpha: number | null }>> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'catalogue:authors', masterDbPath, limit, offset }),
    searchAuthors: (masterDbPath: string, query: string, limit?: number, offset?: number): Promise<Array<{ id: number; name: string; deathNumber: number | null; deathText: string | null; bookCount: number; alpha: number | null }>> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'catalogue:searchAuthors', masterDbPath, query, limit, offset }),
    booksByAuthor: (masterDbPath: string, authorId: number, limit?: number, offset?: number): Promise<Array<{ id: number; title: string; author: string | null; category: string | null; deathYear: number | null; bookType: number | null; info: string | null }>> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'catalogue:booksByAuthor', masterDbPath, authorId, limit, offset }),
    periods: (masterDbPath: string): Promise<Array<{ century: number; label: string; bookCount: number }>> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'catalogue:periods', masterDbPath }),
    booksByPeriod: (masterDbPath: string, century: number, limit?: number, offset?: number): Promise<Array<{ id: number; title: string; author: string | null; category: string | null; deathYear: number | null; bookType: number | null; info: string | null }>> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'catalogue:booksByPeriod', masterDbPath, century, limit, offset }),

    // ── PDF / covers (SPEC-M6 Phase 10) ─────────────────────────
    bookPdfInfo: (masterDbPath: string, bookId: number): Promise<{ available: boolean; files: Array<{ fileIndex: number; name: string; path: string; size: number }>; coverPage: number | null }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'pdf:info', masterDbPath, bookId }),
    readBookPdf: (masterDbPath: string, filePath: string): Promise<Uint8Array> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'pdf:read', masterDbPath, filePath }),

    // ── Import (SPEC-M5.9 FR-2) ───────────────────────────────────
    estimateImport: (masterDbPath: string, bookIds: number[]): Promise<{ books: Array<{ bookId: number; title: string; author: string | null; pageCount: number; estimatedChunks: number }>; totalBooks: number; totalPages: number; totalChunks: number; approximate: boolean }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'import:estimate', masterDbPath, bookIds }),
    alreadyImported: (bookIds: number[]): Promise<number[]> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'import:alreadyImported', bookIds }),
    importBooks: (books: Array<{ id: number; title: string; author?: string | null }>): Promise<{ imported: number; cancelled: boolean; items: Array<{ bookId: number; libraryItemId: string; chunks: number }> }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'import:books', books }),
    cancelImport: (): Promise<{ cancelled: boolean }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_CANCEL_IMPORT),
    onImportProgress: (callback: (p: { bookId: number; title: string; bookIndex: number; totalBooks: number; pagesRead: number; chunksStored: number; status: string; error?: string }) => void): (() => void) => {
      const listener = (_e: unknown, data: Parameters<typeof callback>[0]) => callback(data);
      ipcRenderer.on(ALLOWED_IPC_CHANNELS.SHAMELA_IMPORT_PROGRESS, listener);
      return () => {
        ipcRenderer.removeListener(ALLOWED_IPC_CHANNELS.SHAMELA_IMPORT_PROGRESS, listener);
      };
    },
  },

  tafsir: {
    // SPEC-TAFSIR §FR-4 — all actions travel a single allowlisted channel.
    ping: (mode?: 'remote' | 'local'): Promise<{ ok: boolean; mode: 'remote' | 'local'; latencyMs: number | null; error?: string }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.TAFSIR_INVOKE, { action: 'ping', mode: mode ?? 'remote' }),
    detect: (): Promise<{ pythonFound: boolean; pythonVersion: string | null; uvFound: boolean; uvVersion: string | null; dbFound: boolean; dbPath: string | null; errors: string[] }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.TAFSIR_INVOKE, { action: 'detect' }),
    diagnose: (): Promise<{ pythonFound: boolean; pythonVersion: string | null; uvFound: boolean; uvVersion: string | null; dbFound: boolean; dbPath: string | null; errors: string[]; remoteReachable: boolean; remoteLatencyMs: number | null }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.TAFSIR_INVOKE, { action: 'diagnose' }),
    connect: (mode: 'remote' | 'local'): Promise<{ mode: 'remote' | 'local'; connected: boolean; server?: string; version?: string; tools: Array<{ name: string; title?: string; description?: string; inputSchema?: Record<string, unknown> }>; error?: string }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.TAFSIR_INVOKE, { action: 'connect', mode }),
    disconnect: (): Promise<{ disconnected: boolean }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.TAFSIR_INVOKE, { action: 'disconnect' }),
    tools: (): Promise<Array<{ name: string; title?: string; description?: string; inputSchema?: Record<string, unknown> }>> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.TAFSIR_INVOKE, { action: 'tools' }),
    call: (tool: string, args?: Record<string, unknown>): Promise<{ tool: string; text: string; length: number; truncated: boolean; structured?: unknown }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.TAFSIR_INVOKE, { action: 'call', tool, arguments: args }),
    onInstallProgress: (callback: (p: { downloadedBytes: number; totalBytes: number; percent: number; state: 'downloading' | 'verifying' }) => void): (() => void) => {
      const listener = (_e: unknown, data: Parameters<typeof callback>[0]) => callback(data);
      ipcRenderer.on(ALLOWED_IPC_CHANNELS.TAFSIR_INSTALL_PROGRESS, listener);
      return () => {
        ipcRenderer.removeListener(ALLOWED_IPC_CHANNELS.TAFSIR_INSTALL_PROGRESS, listener);
      };
    },
    installStatus: (): Promise<{ state: 'idle' | 'downloading' | 'verifying' | 'done' | 'error'; downloadedBytes: number; totalBytes: number; percent: number; error?: string }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.TAFSIR_INVOKE, { action: 'install:status' }),
    installStart: (): Promise<{ state: 'idle' | 'downloading' | 'verifying' | 'done' | 'error'; downloadedBytes: number; totalBytes: number; percent: number; error?: string }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.TAFSIR_INVOKE, { action: 'install:start' }),
    installCancel: (): Promise<{ cancelled: boolean }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.TAFSIR_INVOKE, { action: 'install:cancel' }),
  },

  docBridge: {
    // SPEC-M8 — all actions travel the single allowlisted channel.
    // P1: tool detection + host ping. P2: the Word adapter.
    detectTools: (): Promise<{ powershell: boolean; word: boolean; wordVersion: string | null; windows: boolean; reason?: string }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.DOC_BRIDGE_INVOKE, { action: 'detectTools' }),
    ping: (): Promise<{ ok: boolean; latencyMs: number | null; error?: string }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.DOC_BRIDGE_INVOKE, { action: 'ping' }),

    // ── P2: Word adapter ────────────────────────────────────────────────
    wordDescriptor: (): Promise<{ descriptor: unknown; availability: { available: boolean; version: string | null; reason?: string } }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.DOC_BRIDGE_INVOKE, { action: 'word:descriptor' }),
    toWord: (
      input: { sourcePath?: string; html?: string },
      outputPath: string,
      options?: { rtlPageSetup?: boolean; trackChanges?: boolean },
    ): Promise<{ outputPath: string; ms: number }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.DOC_BRIDGE_INVOKE, { action: 'word:toWord', input, outputPath, options }),
    fromWord: (sourcePath: string, to: 'pdf' | 'rtf' | 'html' | 'txt', outputPath: string): Promise<{ outputPath: string; ms: number }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.DOC_BRIDGE_INVOKE, { action: 'word:fromWord', sourcePath, to, outputPath }),
    reflowPdf: (pdfPath: string, outputPath: string): Promise<{ outputPath: string; wordCount: number; ms: number }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.DOC_BRIDGE_INVOKE, { action: 'word:reflowPdf', pdfPath, outputPath }),
    readStructure: (docxPath: string): Promise<{ headings: string[]; footnotes: Array<{ index: number; text: string }>; trackedChanges: number; wordCount: number; readingOrder: 'rtl' | 'ltr' | 'mixed' }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.DOC_BRIDGE_INVOKE, { action: 'word:readStructure', docxPath }),
    installFont: (fontPath: string): Promise<{ fontName: string; verified: boolean; note?: string }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.DOC_BRIDGE_INVOKE, { action: 'word:installFont', fontPath }),

    // ── P3: convert dialog ─────────────────────────────────────────────
    planConversion: (
      from: 'docx' | 'pdf' | 'rtf' | 'html' | 'txt' | 'md' | 'inpage',
      to: 'docx' | 'pdf' | 'rtf' | 'html' | 'txt' | 'md' | 'inpage',
    ): Promise<{ ok: true; steps: unknown[]; losses: string[] } | { ok: false; reason: string }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.DOC_BRIDGE_INVOKE, { action: 'word:plan', from, to }),
    exportDocument: (
      html: string,
      title: string,
      to: 'docx' | 'pdf' | 'rtf' | 'txt',
      options?: { rtlPageSetup?: boolean; trackChanges?: boolean },
    ): Promise<{ cancelled: true } | { cancelled: false; outputPath: string; losses: string[]; ms: number }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.DOC_BRIDGE_INVOKE, { action: 'word:export', html, title, to, options }),
    openPath: (path: string): Promise<{ opened: boolean }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.DOC_BRIDGE_INVOKE, { action: 'openPath', path }),
    applyCitations: (
      html: string,
      documentText: string,
      sources: Array<{ reference: string; source_url?: string | null }>,
      title: string,
      options?: { rtlPageSetup?: boolean; trackChanges?: boolean; stripMarkers?: boolean },
    ): Promise<
      | { cancelled: true }
      | { cancelled: false; outputPath: string; applied: number; notFound: string[]; unresolved: number[]; ms: number }
    > =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.DOC_BRIDGE_INVOKE, {
        action: 'word:applyCitations', html, documentText, sources, title, options,
      }),

    onProgress: (callback: (p: { op: string; phase: string; percent: number }) => void): (() => void) => {
      const listener = (_e: unknown, data: Parameters<typeof callback>[0]) => callback(data);
      ipcRenderer.on(ALLOWED_IPC_CHANNELS.DOC_BRIDGE_PROGRESS, listener);
      return () => {
        ipcRenderer.removeListener(ALLOWED_IPC_CHANNELS.DOC_BRIDGE_PROGRESS, listener);
      };
    },
  },

  projectFolder: {
    // SPEC-M8 Layer 5 / P7 — the .docx import/export bridge (ADR-0018).
    pickFolder: (): Promise<{ cancelled: true } | { cancelled: false; path: string }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.FS_INVOKE, { action: 'pickFolder' }),
    create: (path: string, title: string): Promise<import("../shared/fs/projectTypes").ProjectFolder> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.FS_INVOKE, { action: 'createProject', path, title }),
    open: (path: string): Promise<import("../shared/fs/projectTypes").ProjectFolder> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.FS_INVOKE, { action: 'openProject', path }),
    listChapters: (root: string): Promise<import("../shared/fs/projectTypes").ChapterFile[]> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.FS_INVOKE, { action: 'listChapters', root }),
    readChapterHtml: (root: string, name: string): Promise<{
      html: string;
      name: string;
      structure: { headings: string[]; footnotes: Array<{ index: number; text: string }>; trackedChanges: number; wordCount: number; readingOrder: 'rtl' | 'ltr' | 'mixed' };
    }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.FS_INVOKE, { action: 'readChapterHtml', root, name }),
    saveChapter: (
      root: string,
      name: string,
      html: string,
      options?: { rtlPageSetup?: boolean; trackChanges?: boolean },
    ): Promise<{ name: string; backupPath: string | null; bytes: number }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.FS_INVOKE, { action: 'saveChapter', root, name, html, options }),
    watch: (root: string): Promise<{ watching: boolean }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.FS_INVOKE, { action: 'watch', root }),
    unwatch: (): Promise<{ watching: boolean }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.FS_INVOKE, { action: 'unwatch' }),
    onChanged: (callback: (p: { name: string; kind: 'external' | 'saving' }) => void): (() => void) => {
      const listener = (_e: unknown, data: Parameters<typeof callback>[0]) => callback(data);
      ipcRenderer.on(ALLOWED_IPC_CHANNELS.FS_CHANGED, listener);
      return () => {
        ipcRenderer.removeListener(ALLOWED_IPC_CHANNELS.FS_CHANGED, listener);
      };
    },
  },

  agent: {
    // SPEC-M8 Layer 6 / P8a — the multi-step tool loop (ADR-0016).
    run: (
      instruction: string,
      mode: 'ask' | 'do',
      projectRoot: string,
    ): Promise<{
      id: string;
      answer: string;
      stopReason: 'done' | 'step-limit' | 'cancelled' | 'error';
      steps: number;
      toolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown }>;
      playbook?: string;
      checkpointId?: string;
      error?: string;
    }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.AGENT_INVOKE, { action: 'run', instruction, mode, projectRoot }),
    cancel: (): Promise<{ cancelled: boolean }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.AGENT_INVOKE, { action: 'cancel' }),
    undoTask: (projectRoot: string, checkpointId: string): Promise<{ restored: string[]; removed: string[] }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.AGENT_INVOKE, { action: 'undoTask', projectRoot, checkpointId }),
    status: (): Promise<{ busy: boolean; running: { id: string; startedAt: number } | null }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.AGENT_INVOKE, { action: 'status' }),
    onProgress: (callback: (p: { id: string; step: number; label: string; kind: string; detail?: string }) => void): (() => void) => {
      const listener = (_e: unknown, data: Parameters<typeof callback>[0]) => callback(data);
      ipcRenderer.on(ALLOWED_IPC_CHANNELS.AGENT_PROGRESS, listener);
      return () => {
        ipcRenderer.removeListener(ALLOWED_IPC_CHANNELS.AGENT_PROGRESS, listener);
      };
    },
  },

};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
