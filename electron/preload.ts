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
    detect: (): Promise<{ installed: boolean; path: string | null; version?: string; reason?: string; masterDbPath?: string | null }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'detect' }),
    diagnose: (): Promise<{ jreFound: boolean; jreVersion: string | null; luceneJarsFound: boolean; luceneVersion: string | null; masterDbFound: boolean; storeIndexFound: boolean; bookCount: number; errors: string[] }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'diagnose' }),
    savePath: (path: string): Promise<{ installed: boolean; path: string | null; version?: string; reason?: string }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'savePath', path }),
    search: (query: string, limit?: number): Promise<Array<{ bookId: string; bookTitle: string; pageNumber: number; snippet: string; score: number }>> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'search', query, limit }),
    readPage: (bookId: string, pageNumber: number): Promise<{ bookId: string; pageNumber: number; text: string; volume?: string }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'readPage', bookId, pageNumber }),

    // ── Catalogue (master.db metadata) ────────────────────────────
    catalogueStats: (masterDbPath: string): Promise<{ totalBooks: number; totalAuthors: number; totalCategories: number }> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'catalogue:stats', masterDbPath }),
    searchBooks: (masterDbPath: string, query: string, limit?: number, offset?: number): Promise<Array<{ id: number; title: string; author: string | null; category: string | null; pageCount: number | null; volumeCount: number | null; info: string | null }>> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'catalogue:searchBooks', masterDbPath, query, limit, offset }),
    listCategories: (masterDbPath: string): Promise<Array<{ id: number; name: string; parentId: number | null; bookCount: number }>> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'catalogue:listCategories', masterDbPath }),
    booksByCategory: (masterDbPath: string, categoryId: number, limit?: number, offset?: number): Promise<Array<{ id: number; title: string; author: string | null; category: string | null; pageCount: number | null; volumeCount: number | null; info: string | null }>> =>
      ipcRenderer.invoke(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE, { action: 'catalogue:booksByCategory', masterDbPath, categoryId, limit, offset }),
  },

};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
