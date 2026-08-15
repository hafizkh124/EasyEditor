/**
 * Tafsir MCP — renderer service (SPEC-TAFSIR §FR-5.6, §FR-6 / ADR-0012).
 *
 * One facade for both runtimes:
 *   desktop → window.electronAPI.tafsir (main-process MCP client, §FR-4.3)
 *   web     → the `tafsir-proxy` edge function (remote mode only; local/stdio
 *             stays desktop-only per the spec's Non-Goals)
 *
 * The renderer never touches the remote MCP endpoint directly (NFR-2).
 */
import { isDesktop } from "@/core/backend";
import { supabase } from "@/integrations/supabase/client";


export type TafsirMode = "remote" | "local";

export interface TafsirToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface TafsirPingResult {
  ok: boolean;
  mode: TafsirMode;
  latencyMs: number | null;
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

export interface TafsirConnectResult {
  mode: TafsirMode;
  connected: boolean;
  server?: string;
  version?: string;
  tools: TafsirToolInfo[];
  error?: string;
}

export interface TafsirCallResult {
  tool: string;
  text: string;
  length: number;
  truncated: boolean;
  structured?: unknown;
}

export type TafsirInstallState = 'idle' | 'downloading' | 'verifying' | 'done' | 'error';

export interface TafsirInstallStatus {
  state: TafsirInstallState;
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

function desktopOnlyError(): Error {
  return new Error(
    "تفسیر (Tafsir MCP) کا یہ مقامی انٹرفیس صرف ڈیسک ٹاپ ورژن میں دستیاب ہے — ویب پر آن لائن رستہ جلد آئے گا۔",
  );
}

function api(): NonNullable<typeof window.electronAPI>["tafsir"] | null {
  if (!isDesktop() || !window.electronAPI?.tafsir) return null;
  return window.electronAPI.tafsir;
}

export function hasTafsirNative(): boolean {
  return api() !== null;
}

export async function tafsirPing(mode: TafsirMode = "remote"): Promise<TafsirPingResult> {
  const a = api();
  if (!a) throw desktopOnlyError();
  return a.ping(mode);
}

export async function tafsirDetect(): Promise<TafsirDetectResult> {
  const a = api();
  if (!a) throw desktopOnlyError();
  return a.detect();
}

export async function tafsirDiagnose(): Promise<TafsirDiagnostics> {
  const a = api();
  if (!a) throw desktopOnlyError();
  return a.diagnose();
}

export async function tafsirConnect(mode: TafsirMode): Promise<TafsirConnectResult> {
  const a = api();
  if (!a) throw desktopOnlyError();
  return a.connect(mode);
}

export async function tafsirDisconnect(): Promise<void> {
  const a = api();
  if (!a) throw desktopOnlyError();
  await a.disconnect();
}

export async function tafsirTools(): Promise<TafsirToolInfo[]> {
  const a = api();
  if (!a) throw desktopOnlyError();
  return a.tools();
}

export async function tafsirCall(tool: string, args?: Record<string, unknown>): Promise<TafsirCallResult> {
  const a = api();
  if (!a) throw desktopOnlyError();
  return a.call(tool, args);
}

/** Convenience for the search dialog: fetch an ayah and normalize to text. */
export async function fetchAyahText(surah: number, ayah: number): Promise<TafsirCallResult> {
  return tafsirCall("fetch_ayah", { surah, ayah });
}

export async function tafsirInstallStatus(): Promise<TafsirInstallStatus> {
  const a = api();
  if (!a) throw desktopOnlyError();
  return a.installStatus();
}

export async function tafsirInstallStart(): Promise<TafsirInstallStatus> {
  const a = api();
  if (!a) throw desktopOnlyError();
  return a.installStart();
}

export async function tafsirInstallCancel(): Promise<{ cancelled: boolean }> {
  const a = api();
  if (!a) throw desktopOnlyError();
  return a.installCancel();
}

/** Subscribes to install progress events. Returns an unsubscribe fn. */
export function onTafsirInstallProgress(cb: (p: TafsirInstallProgress) => void): () => void {
  if (!isDesktop() || !window.electronAPI?.tafsir) return () => {};
  return window.electronAPI.tafsir.onInstallProgress(cb);
}
