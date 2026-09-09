/**
 * Connectors Hub (Phase 7, ADR-0042) — the agent's bridge to the Urdu prosody
 * engine and the bundled verse corpus.
 *
 * `scan_urdu_prosody` is pure computation (`shared/prosody/scan.ts`) — no data,
 * no network. `lookup_urdu_verse` reads a bundled JSON at
 * `resources/prosody/urdu-verses.json` (shipped via electron-builder
 * `extraResources`); it ships EMPTY — Ghālib is public domain but a verified
 * text has to be added deliberately, and Iqbāl's Urdu work carries special
 * protection under Pakistani law. When the file has verses the tool just works;
 * until then it returns a clear "no corpus bundled" note.
 */
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../lib/logger.js';
import { scanProsody, type ProsodyScan } from '../../../shared/prosody/scan.js';
import type { RetrievedChunk } from '../../../shared/agent/grounding.js';

const log = logger.child('agent/urduProsody');

export type { ProsodyScan };

export interface UrduVerse {
  id: string;
  poet: string;
  work?: string;
  ghazal?: string | number;
  text: string;
}

export function scanUrduProsody(text: string): ProsodyScan {
  return scanProsody((text ?? '').trim());
}

// ── the bundled verse corpus ──────────────────────────────────────────────

let cache: UrduVerse[] | null = null;

async function corpusPath(): Promise<string> {
  let appPath = process.cwd();
  try {
    const { app } = await import('electron');
    appPath = app.getAppPath();
  } catch { /* not in an electron context (tests) */ }
  const candidates = [
    path.join(process.resourcesPath || '', 'prosody', 'urdu-verses.json'),
    path.join(appPath, 'resources', 'prosody', 'urdu-verses.json'),
    path.join(process.cwd(), 'resources', 'prosody', 'urdu-verses.json'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* keep looking */ }
  }
  return '';
}

async function loadCorpus(): Promise<UrduVerse[]> {
  if (cache) return cache;
  const p = await corpusPath();
  if (!p) { cache = []; return cache; }
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as { verses?: unknown };
    cache = Array.isArray(parsed.verses)
      ? (parsed.verses as UrduVerse[]).filter((v) => v && typeof v.text === 'string' && typeof v.id === 'string')
      : [];
  } catch (err) {
    log.warn('could not read the Urdu verse corpus', { message: (err as Error).message });
    cache = [];
  }
  return cache;
}

/** For tests — drop the memoised corpus. */
export function _resetCorpusCache(): void {
  cache = null;
}

export interface UrduVerseResult {
  chunks: RetrievedChunk[];
  note?: string;
  error?: string;
}

export async function lookupUrduVerse(query: string): Promise<UrduVerseResult> {
  const q = (query ?? '').trim();
  if (!q) return { chunks: [], error: 'a search phrase is required' };
  const corpus = await loadCorpus();
  if (corpus.length === 0) {
    return {
      chunks: [],
      note: 'No Urdu verse corpus is bundled yet — add resources/prosody/urdu-verses.json. Metre scanning (scan_urdu_prosody) still works.',
    };
  }
  const needle = q.toLowerCase();
  const hits = corpus
    .filter((v) => v.text.toLowerCase().includes(needle) || (v.poet ?? '').toLowerCase().includes(needle))
    .slice(0, 8);
  if (hits.length === 0) return { chunks: [], note: 'No matching verse in the bundled Urdu corpus.' };
  return {
    chunks: hits.map((v) => ({
      id: `urdu:${v.id}`,
      reference: [v.poet, v.work, v.ghazal ? `غزل ${v.ghazal}` : ''].filter(Boolean).join('، ') || 'شعر اردو',
      content: v.text.slice(0, 800),
    })),
  };
}
