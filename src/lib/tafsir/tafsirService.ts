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
import { callEdgeFunction } from "@/core/ai/aiAdapter";


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
    "تفسیر (Tafsir MCP) کا یہ حصہ صرف ڈیسک ٹاپ ورژن میں دستیاب ہے (مقامی موڈ)۔",
  );
}

function api(): NonNullable<typeof window.electronAPI>["tafsir"] | null {
  if (!isDesktop() || !window.electronAPI?.tafsir) return null;
  return window.electronAPI.tafsir;
}

export function hasTafsirNative(): boolean {
  return api() !== null;
}

/** Web builds get remote-only Tafsir through the `tafsir-proxy` edge function. */
export function hasTafsirWeb(): boolean {
  return api() === null;
}

/** Available in this runtime at all — used to gate the connector UI. */
export function hasTafsir(): boolean {
  return true;
}

async function proxy<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await callEdgeFunction("tafsir-proxy", body);
  if (error) {
    throw new Error(error.message || "Tafsir سرور تک رسائی ناکام۔");
  }
  const payload = data as (T & { error?: string }) | null;
  if (payload && typeof payload === "object" && "error" in payload && payload.error) {
    throw new Error(String(payload.error));
  }
  if (!payload) throw new Error("Tafsir سرور سے کوئی جواب نہیں ملا۔");
  return payload;
}

export async function tafsirPing(mode: TafsirMode = "remote"): Promise<TafsirPingResult> {
  const a = api();
  if (!a) {
    if (mode === "local") throw desktopOnlyError();
    const r = await proxy<{ ok: boolean; latencyMs: number | null; error?: string }>({ action: "ping" });
    return { ok: r.ok, mode: "remote", latencyMs: r.latencyMs, error: r.error };
  }
  return a.ping(mode);
}

export async function tafsirDetect(): Promise<TafsirDetectResult> {
  const a = api();
  if (!a) throw desktopOnlyError();
  return a.detect();
}

export async function tafsirDiagnose(): Promise<TafsirDiagnostics> {
  const a = api();
  if (!a) {
    const ping = await tafsirPing("remote").catch(() => ({
      ok: false,
      latencyMs: null,
    } as TafsirPingResult));
    return {
      pythonFound: false,
      pythonVersion: null,
      uvFound: false,
      uvVersion: null,
      dbFound: false,
      dbPath: null,
      errors: [],
      remoteReachable: ping.ok,
      remoteLatencyMs: ping.latencyMs,
    };
  }
  return a.diagnose();
}

export async function tafsirConnect(mode: TafsirMode): Promise<TafsirConnectResult> {
  const a = api();
  if (!a) {
    if (mode === "local") throw desktopOnlyError();
    const r = await proxy<{ connected: boolean; server?: string; version?: string; tools: TafsirToolInfo[] }>({
      action: "connect",
    });
    return { mode: "remote", connected: r.connected, server: r.server, version: r.version, tools: r.tools ?? [] };
  }
  return a.connect(mode);
}

export async function tafsirDisconnect(): Promise<void> {
  const a = api();
  // The web proxy is session-less — there is nothing to tear down.
  if (!a) return;
  await a.disconnect();
}

export async function tafsirTools(): Promise<TafsirToolInfo[]> {
  const a = api();
  if (!a) {
    const r = await proxy<{ tools: TafsirToolInfo[] }>({ action: "tools" });
    return r.tools ?? [];
  }
  return a.tools();
}

export async function tafsirCall(tool: string, args?: Record<string, unknown>): Promise<TafsirCallResult> {
  const a = api();
  if (!a) return proxy<TafsirCallResult>({ action: "call", tool, args: args ?? {} });
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
