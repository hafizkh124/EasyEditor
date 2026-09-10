/**
 * Project-folder IPC (SPEC-M8 Layer 5 / P7, ADR-0018).
 *
 * The project folder is an ordinary folder of `.docx` / `.rtf` files. This is
 * the import/export bridge: the user pulls a chapter into the editor (read via
 * the Word adapter), edits in the SQLite workspace as normal, and saves back
 * into the folder as a real `.docx` — with a timestamped backup taken first.
 * `getBackend()` is unchanged; `cloudBackend` and the web app are untouched.
 *
 * One `FS_INVOKE` channel, action-dispatched (the Shamela/Tafsir pattern).
 * `FS_CHANGED` is main → renderer, for spotting an externally-edited file
 * (a "conflicted copy" from drive sync, or an edit made in Word directly).
 */
import { ipcMain, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { ALLOWED_IPC_CHANNELS } from './registry.js';
import { logger } from '../lib/logger.js';
import {
  createProjectFolder,
  openProjectFolder,
  refreshChapters,
  backupChapter,
  registerChapter,
  chapterPath,
  listAssets,
  importDroppedFile,
  resolveAsset,
  readConnectors,
  setConnector,
  listProjectTree,
  readProjectText,
  renameInProject,
  trashInProject,
  createFolderInProject,
  createTextFileInProject,
} from '../fs/projectFolder.js';
import * as word from '../adapters/word.js';

const log = logger.child('ipc/fsHandlers');

/** One folder watcher at a time — the app has one open project. */
let watcher: fs.FSWatcher | null = null;
let watchedRoot: string | null = null;

function stopWatch(): void {
  try { watcher?.close(); } catch { /* ignore */ }
  watcher = null;
  watchedRoot = null;
}

export function terminateFsWatch(): void {
  stopWatch();
}

export function registerFsHandlers(): void {
  ipcMain.handle(
    ALLOWED_IPC_CHANNELS.FS_INVOKE,
    async (event, payload: { action: string; [key: string]: unknown }) => {
      switch (payload?.action) {
        case 'pickFolder': {
          const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openDirectory', 'createDirectory'],
          });
          if (canceled || filePaths.length === 0) return { cancelled: true as const };
          return { cancelled: false as const, path: filePaths[0] };
        }

        case 'createProject':
          return createProjectFolder(String(payload.path), String(payload.title ?? ''));

        case 'openProject':
          return openProjectFolder(String(payload.path));

        case 'listChapters':
          return refreshChapters(String(payload.root));

        // ── M9 Phase 1b: per-project source connectors ──
        case 'getConnectors':
          return readConnectors(String(payload.root));

        case 'setConnector':
          return setConnector(String(payload.root), String(payload.id ?? ''), payload.on !== false);

        // ── M9 Phase 3: non-chapter assets (recordings, scans, fonts, templates) ──
        case 'listAssets':
          return listAssets(String(payload.root));

        // M9 Phase 5 — the renderer needs a recording's bytes to decode it
        // (Web Audio), since whisper.cpp only reads 16 kHz mono WAV.
        case 'readAssetBytes': {
          const abs = resolveAsset(String(payload.root), String(payload.name ?? ''));
          const buf = fs.readFileSync(abs);
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        }

        case 'importAsset': {
          const root = String(payload.root);
          const name = String(payload.name ?? '');
          const raw = payload.bytes;
          const bytes =
            raw instanceof Uint8Array ? raw
            : raw instanceof ArrayBuffer ? new Uint8Array(raw)
            : ArrayBuffer.isView(raw) ? new Uint8Array((raw as ArrayBufferView).buffer)
            : Array.isArray(raw) ? Uint8Array.from(raw as number[])
            : null;
          if (!bytes || bytes.byteLength === 0) throw new Error('the dropped file was empty');
          const MAX_BYTES = 500 * 1024 * 1024; // a 45-min lecture is well under this
          if (bytes.byteLength > MAX_BYTES) throw new Error('that file is too large to import (500 MB max)');
          return importDroppedFile(root, name, bytes);
        }

        case 'readChapterHtml': {
          // Chapter -> editor: convert the .docx/.rtf to HTML through Word and
          // hand the renderer the markup + a structure summary.
          const root = String(payload.root);
          const name = String(payload.name);
          const src = chapterPath(root, name);
          const tmp = path.join(os.tmpdir(), `easyeditor-chapter-${Date.now()}.html`);
          try {
            await word.fromWord(src, 'html', tmp);
            const html = fs.readFileSync(tmp, 'utf8');
            const structure = await word.readStructure(src);
            return { html, structure, name };
          } finally {
            try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
          }
        }

        case 'saveChapter': {
          // Editor -> chapter: back up the existing file, then write the new
          // .docx from the editor HTML.
          const root = String(payload.root);
          const name = String(payload.name);
          const dest = chapterPath(root, name);
          const backupPath = backupChapter(root, name);

          const win = BrowserWindow.fromWebContents(event.sender);
          win?.webContents.send(ALLOWED_IPC_CHANNELS.FS_CHANGED, { name, kind: 'saving' });
          await word.toWord({ html: String(payload.html ?? '') }, dest, {
            rtlPageSetup: Boolean((payload.options as Record<string, unknown>)?.rtlPageSetup),
            trackChanges: Boolean((payload.options as Record<string, unknown>)?.trackChanges),
          });
          const { bytes } = registerChapter(root, name);
          return { name, backupPath, bytes };
        }

        // ── Plan §3.4: the Project Explorer tree + editable file ops ──
        case 'listTree':
          return listProjectTree(String(payload.root));

        case 'readText':
          return { text: readProjectText(String(payload.root), String(payload.name ?? '')) };

        case 'rename': {
          const r = renameInProject(String(payload.root), String(payload.from ?? ''), String(payload.to ?? ''));
          BrowserWindow.fromWebContents(event.sender)?.webContents.send(ALLOWED_IPC_CHANNELS.FS_CHANGED, { name: String(payload.to ?? ''), kind: 'external' });
          return r;
        }

        case 'trash': {
          const r = trashInProject(String(payload.root), String(payload.name ?? ''));
          BrowserWindow.fromWebContents(event.sender)?.webContents.send(ALLOWED_IPC_CHANNELS.FS_CHANGED, { name: String(payload.name ?? ''), kind: 'external' });
          return r;
        }

        case 'mkdir':
          return createFolderInProject(String(payload.root), String(payload.dir ?? ''));

        case 'createFile': {
          const r = createTextFileInProject(String(payload.root), String(payload.name ?? ''), String(payload.seed ?? ''));
          BrowserWindow.fromWebContents(event.sender)?.webContents.send(ALLOWED_IPC_CHANNELS.FS_CHANGED, { name: String(payload.name ?? ''), kind: 'external' });
          return r;
        }

        case 'watch': {
          const root = path.resolve(String(payload.root));
          if (watchedRoot === root && watcher) return { watching: true };
          stopWatch();
          try {
            watcher = fs.watch(root, { persistent: false }, (_evt, filename) => {
              if (!filename) return;
              const fname = String(filename);
              const ext = path.extname(fname).toLowerCase();
              if (ext !== '.docx' && ext !== '.rtf') return;
              if (fname.startsWith('~$')) return;
              const win = BrowserWindow.getAllWindows()[0];
              win?.webContents.send(ALLOWED_IPC_CHANNELS.FS_CHANGED, { name: fname, kind: 'external' });
            });
            watchedRoot = root;
            return { watching: true };
          } catch (err) {
            log.warn('could not watch project folder', { root, message: (err as Error).message });
            return { watching: false };
          }
        }

        case 'unwatch':
          stopWatch();
          return { watching: false };

        default:
          throw new Error(`نامعلوم fs عمل: ${payload?.action}`);
      }
    },
  );
}
