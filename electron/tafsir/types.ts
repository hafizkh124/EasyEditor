/**
 * Tafsir MCP — shared types (SPEC-TAFSIR).
 * Pure data contract shared by the IPC handlers, preload bridge and renderer.
 * No electron imports here so the file stays importable in unit tests.
 */

export type TafsirMode = 'remote' | 'local';

export interface TafsirToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface TafsirConnectResult {
  mode: TafsirMode;
  connected: boolean;
  server?: string;
  version?: string;
  tools: TafsirToolInfo[];
  error?: string;
}

export interface TafsirDetectResult {
  pythonFound: boolean;
  pythonVersion: string | null;
  uvFound: boolean;
  uvVersion: string | null;
  dbFound: boolean;
  dbPath: string | null;
  errors: string[];
}

export interface TafsirDiagnostics extends TafsirDetectResult {
  remoteReachable: boolean;
  remoteLatencyMs: number | null;
}

export interface TafsirCallResult {
  tool: string;
  /** JSON.stringify'd tool output content blocks joined. */
  text: string;
  /** Number of characters returned, before truncation. */
  length: number;
  /** True when the text was truncated to the configured cap. */
  truncated: boolean;
  /** Raw MCP result object when structured content is present. */
  structured?: unknown;
}

export interface TafsirPingResult {
  ok: boolean;
  mode: TafsirMode;
  latencyMs: number | null;
  error?: string;
}

export interface TafsirInstallStatus {
  state: 'idle' | 'downloading' | 'verifying' | 'done' | 'error';
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  error?: string;
}

export interface TafsirInstallProgress {
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  state: 'downloading' | 'verifying';
}

/** Renderer-facing result types mirror the MCP tool outputs the app displays. */
export type TafsirSearchResult = {
  surah: number;
  ayah: number;
  text: string;
  snippet?: string;
  score?: number;
};
