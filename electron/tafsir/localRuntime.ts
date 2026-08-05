/**
 * Tafsir MCP — local runtime (SPEC-TAFSIR §FR-3).
 *
 * Detects the Python / `uvx` toolchain, builds the stdio server parameters for
 * `uvx tafsir-mcp`, and drives the ~214 MB database download (first run).
 *
 * The official `tafsir-mcp` package auto-downloads the DB on first run into
 * `~/.cache/tafsir-mcp/` (§FR-3.2). To honour principle 5 (never a silent
 * download; estimate + progress + cancel first) we download the same asset
 * ourselves with a progress report, verify its SHA256 given below, and place it
 * at the app-managed path so it is passed via `TAFSIR_DB_PATH` and the package
 * never triggers its own hidden download.
 */
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { TafsirDetectResult } from './types.js';

/** Hugging Face dataset the shipped `quran.db` lives on. */
export const TAFSIR_DB_REPO = 'tafsircenter/tafsir-mcp-data';
export const TAFSIR_DB_FILENAME = 'quran.db';
export const TAFSIR_DB_SHA256 =
  '10e61f615ab5e6a3440e8ecc8ba1dc2273d12cd9048752760fe53a44d191cc27';
export const TAFSIR_DB_SIZE_MB = 214;
export const TAFSIR_DB_URL =
  `https://huggingface.co/datasets/${TAFSIR_DB_REPO}/resolve/main/${TAFSIR_DB_FILENAME}`;

export interface TafsirDownloadProgress {
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  state: 'downloading' | 'verifying';
}

export interface RuntimePaths {
  baseDir: string;
  dbPath: string;
}

export interface LocalRuntime {
  detect: () => TafsirDetectResult;
  buildStdioParams: () => StdioServerParameters | null;
  /**
   * Downloads the Quran DB (if absent) with progress, verifies SHA256, and
   * returns the final path. Resolves immediately when already present.
   */
  downloadDatabase: (opts?: {
    onProgress?: (p: TafsirDownloadProgress) => void;
    signal?: AbortSignal;
  }) => Promise<string>;
  /** Kill any spawned tafsir subprocess. Safe to call repeatedly. */
  cleanup: () => void;
}

function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => h.update(Buffer.from(chunk)))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

const MB = 1024 * 1024;

function runVersion(cmd: string, args: string[]): { found: boolean; version: string | null } {
  try {
    const r = spawnSync(cmd, args, { timeout: 8000, encoding: 'utf8' });
    if (r.status !== 0 || r.error) return { found: false, version: null };
    const line = (r.stdout || '').trim() || (r.stderr || '').trim();
    return { found: true, version: line.slice(0, 120) || 'present' };
  } catch {
    return { found: false, version: null };
  }
}

function buildRuntime(paths: RuntimePaths): LocalRuntime {
  let spawned: ReturnType<typeof spawn> | null = null;

  const detect = (): TafsirDetectResult => {
    const python = runVersion('python', ['--version']);
    const python3 = runVersion('python3', ['--version']);
    const uv = runVersion('uv', ['--version']);
    const uvx = runVersion('uvx', ['--version']);
    const pythonFound = python.found || python3.found;
    const uvFound = uv.found || uvx.found;
    const dbFound = fs.existsSync(paths.dbPath);

    const errors: string[] = [];
    if (!pythonFound) errors.push('Python نصب نہیں ہے — tafsir-mcp کے لیے درکار ہے۔');
    if (!uvFound) errors.push('uv/uvx نہیں ملا — tafsir-mcp چلانے کے لیے درکار ہے۔');
    if (!dbFound) errors.push('مقامی ڈیٹابیس موجود نہیں — پہلے ڈاؤن لوڈ درکار ہے۔');

    return {
      pythonFound,
      pythonVersion: python.version ?? python3.version,
      uvFound,
      uvVersion: uv.version ?? uvx.version,
      dbFound,
      dbPath: paths.dbPath,
      errors,
    };
  };

  const buildStdioParams = (): StdioServerParameters | null => {
    const det = detect();
    if (!det.pythonFound) return null;
    // uvx is preferred (isolation + auto-install); falls back to a plain python module.
    const env = {
      ...process.env,
      ...(det.dbFound ? { TAFSIR_DB_PATH: paths.dbPath } : {}),
    } as Record<string, string>;
    if (det.uvFound) {
      return {
        command: process.platform === 'win32' ? 'uvx' : 'uvx',
        args: ['tafsir-mcp'],
        env,
        cwd: paths.baseDir,
      };
    }
    return {
      command: process.platform === 'win32' ? 'python' : 'python3',
      args: ['-m', 'tafsir_mcp'],
      env,
      cwd: paths.baseDir,
    };
  };

  const downloadDatabase: LocalRuntime['downloadDatabase'] = async (opts) => {
    const { onProgress, signal } = opts ?? {};
    const totalBytes = TAFSIR_DB_SIZE_MB * MB;

    if (fs.existsSync(paths.dbPath)) {
      onProgress?.({ downloadedBytes: totalBytes, totalBytes, percent: 100, state: 'verifying' });
      return paths.dbPath;
    }

    fs.mkdirSync(paths.baseDir, { recursive: true });
    const tempPath = paths.dbPath + '.download';
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });

    try {
      const response = await fetch(TAFSIR_DB_URL, { signal });
      if (!response.ok) {
        throw new Error(`ڈاؤن لوڈ ناکام: HTTP ${response.status} ${response.statusText}`);
      }
      const header = Number(response.headers.get('content-length') ?? 0);
      const expected = header || totalBytes;
      const reader = response.body!.getReader();
      const writer = fs.createWriteStream(tempPath);
      let downloaded = 0;

      await new Promise<void>((resolve, reject) => {
        writer.on('error', reject);
        const pump = async () => {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              writer.write(Buffer.from(value));
              downloaded += value.length;
              onProgress?.({
                downloadedBytes: downloaded,
                totalBytes: expected,
                percent: Math.min(100, Math.round((downloaded / expected) * 100)),
                state: 'downloading',
              });
            }
            writer.end();
          } catch (err) {
            reject(err);
          }
        };
        writer.on('finish', resolve);
        void pump();
      });

      onProgress?.({ downloadedBytes: expected, totalBytes: expected, percent: 100, state: 'verifying' });
      const actual = await hashFile(tempPath);
      if (actual !== TAFSIR_DB_SHA256) {
        throw new Error(`SHA256 تصدیق ناکام — متوقع ${TAFSIR_DB_SHA256}، ملا ${actual}`);
      }

      fs.renameSync(tempPath, paths.dbPath);
      return paths.dbPath;
    } catch (err) {
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
      throw err;
    }
  };

  const cleanup = () => {
    if (spawned) {
      try { spawned.kill(); } catch { /* ignore */ }
      spawned = null;
    }
  };

  return { detect, buildStdioParams, downloadDatabase, cleanup };
}

export function getLocalRuntime(baseDir?: string): LocalRuntime {
  const base = baseDir ?? path.join(process.env.TEMP ?? '.', 'tafsir-mcp');
  return buildRuntime({
    baseDir: base,
    dbPath: path.join(base, TAFSIR_DB_FILENAME),
  });
}
