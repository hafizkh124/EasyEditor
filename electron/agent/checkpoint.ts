/**
 * M8 Layer 6 — task-level checkpoints (SPEC-M8 §3, ADR-0019 item 5).
 *
 * Distinct from the per-write backup in electron/fs/projectFolder.ts
 * (`backupChapter`, security gate 3 — for corruption recovery). This groups
 * ALL of one agent task's writes under `.easyeditor/history/<checkpointId>/`
 * so a single "Undo this task" button walks the whole task back at once —
 * for the researcher's peace of mind, not corruption.
 *
 * A chapter is snapshotted at most once per checkpoint (its pre-task state);
 * later edits in the same task overwrite the live file, not the snapshot.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../lib/logger.js';
import { EASYEDITOR_DIR } from '../../shared/fs/projectTypes.js';
import { resolveInProject } from '../fs/projectFolder.js';

const log = logger.child('agent/checkpoint');

const HISTORY_DIR = 'history';

function historyRoot(root: string): string {
  return path.join(root, EASYEDITOR_DIR, HISTORY_DIR);
}
function checkpointDir(root: string, id: string): string {
  return path.join(historyRoot(root), id);
}
function metaPath(root: string, id: string): string {
  return path.join(checkpointDir(root, id), 'checkpoint.json');
}

export interface CheckpointMeta {
  id: string;
  createdAt: string;
  /** The agent instruction that opened this checkpoint. */
  label: string;
  /** Chapter file names snapshotted under this checkpoint. */
  files: string[];
  /** Set once "Undo this task" has been used. */
  undoneAt?: string;
}

/** Open a checkpoint for one agent task. Nothing is copied yet. */
export function beginCheckpoint(root: string, label: string): string {
  const id = `cp_${new Date().toISOString().replace(/[:.]/g, '-')}_${randomUUID().slice(0, 8)}`;
  const dir = checkpointDir(root, id);
  fs.mkdirSync(dir, { recursive: true });
  const meta: CheckpointMeta = { id, createdAt: new Date().toISOString(), label: label.slice(0, 300), files: [] };
  fs.writeFileSync(metaPath(root, id), JSON.stringify(meta, null, 2), 'utf8');
  return id;
}

function readMeta(root: string, id: string): CheckpointMeta | null {
  try {
    return JSON.parse(fs.readFileSync(metaPath(root, id), 'utf8')) as CheckpointMeta;
  } catch {
    return null;
  }
}

/**
 * Snapshot `<chapter>` into this checkpoint, once. Call before an edit. A
 * no-op if the file was already snapshotted in this checkpoint, or does not
 * exist yet (a brand-new chapter — undo deletes it, see undoCheckpoint).
 */
export function recordEdit(root: string, id: string, chapter: string): void {
  const meta = readMeta(root, id);
  if (!meta) { log.warn('recordEdit: no such checkpoint', { id }); return; }
  if (meta.files.includes(chapter)) return;

  const dir = checkpointDir(root, id);
  const src = resolveInProject(root, chapter);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(dir, chapter));
  } else {
    // Marker: the chapter did not exist before this task; undo removes it.
    fs.writeFileSync(path.join(dir, `${chapter}.was-new`), '', 'utf8');
  }
  meta.files.push(chapter);
  fs.writeFileSync(metaPath(root, id), JSON.stringify(meta, null, 2), 'utf8');
}

/** Restore every file this checkpoint touched to its pre-task state. */
export function undoCheckpoint(root: string, id: string): { restored: string[]; removed: string[] } {
  const meta = readMeta(root, id);
  if (!meta) throw new Error(`no such checkpoint: ${id}`);
  const dir = checkpointDir(root, id);
  const restored: string[] = [];
  const removed: string[] = [];

  for (const chapter of meta.files) {
    const dest = resolveInProject(root, chapter);
    const snap = path.join(dir, chapter);
    if (fs.existsSync(snap)) {
      fs.copyFileSync(snap, dest);
      restored.push(chapter);
    } else if (fs.existsSync(path.join(dir, `${chapter}.was-new`))) {
      fs.rmSync(dest, { force: true });
      removed.push(chapter);
    }
  }

  meta.undoneAt = new Date().toISOString();
  fs.writeFileSync(metaPath(root, id), JSON.stringify(meta, null, 2), 'utf8');
  log.info('undid task checkpoint', { id, restored: restored.length, removed: removed.length });
  return { restored, removed };
}

/** All checkpoints for a project, newest first. */
export function listCheckpoints(root: string): CheckpointMeta[] {
  let ids: string[];
  try {
    ids = fs.readdirSync(historyRoot(root)).filter((n) => n.startsWith('cp_'));
  } catch {
    return [];
  }
  return ids
    .map((id) => readMeta(root, id))
    .filter((m): m is CheckpointMeta => m !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
