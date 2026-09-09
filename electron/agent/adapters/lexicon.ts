/**
 * Connectors Hub (Phase 6, ADR-0043) — the printed-dictionary page index.
 *
 * `resources/lexicon/root-page-map.json` maps an Arabic root (or headword) to
 * its page in *Miṣbāḥ al-Lughāt* / *al-Qāmūs al-Wāḥid*. It ships **EMPTY** — a
 * structured page index of those specific printed editions does not exist
 * online, and we will not stamp a `[مصباح اللغات، ص N]` citation on a page we
 * have not indexed. When a real map is added (via electron-builder
 * `extraResources`), `lookup_lexicon` starts emitting those citations; until
 * then it returns null and the tool relies on the corpus + the al-Maany link.
 */
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../lib/logger.js';
import { normaliseArabicWord } from '../../../shared/agent/lexiconQuery.js';
import type { RetrievedChunk } from '../../../shared/agent/grounding.js';

const log = logger.child('agent/lexicon');

interface RootPageEntry {
  root?: string;
  headword?: string;
  misbah_page?: number;
  qamus_page?: number;
}

let cache: RootPageEntry[] | null = null;

async function mapPath(): Promise<string> {
  let appPath = process.cwd();
  try {
    const { app } = await import('electron');
    appPath = app.getAppPath();
  } catch { /* not in electron (tests) */ }
  const candidates = [
    path.join(process.resourcesPath || '', 'lexicon', 'root-page-map.json'),
    path.join(appPath, 'resources', 'lexicon', 'root-page-map.json'),
    path.join(process.cwd(), 'resources', 'lexicon', 'root-page-map.json'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* keep looking */ }
  }
  return '';
}

async function loadMap(): Promise<RootPageEntry[]> {
  if (cache) return cache;
  const p = await mapPath();
  if (!p) { cache = []; return cache; }
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as { roots?: unknown };
    cache = Array.isArray(parsed.roots) ? (parsed.roots as RootPageEntry[]) : [];
  } catch (err) {
    log.warn('could not read root-page-map.json', { message: (err as Error).message });
    cache = [];
  }
  return cache;
}

/** For tests — drop the memoised map. */
export function _resetPageMapCache(): void {
  cache = null;
}

/**
 * A citable printed-page reference for `word`, or null when no index is
 * bundled (the default) or the word is not in it.
 */
export async function printedPageCitation(word: string): Promise<RetrievedChunk | null> {
  const map = await loadMap();
  if (map.length === 0) return null;
  const w = normaliseArabicWord(word);
  const hit = map.find(
    (e) => normaliseArabicWord(e.headword ?? '') === w || normaliseArabicWord(e.root ?? '') === w,
  );
  if (!hit || (!hit.misbah_page && !hit.qamus_page)) return null;
  const bits = [
    hit.misbah_page ? `مصباح اللغات، ص ${hit.misbah_page}` : '',
    hit.qamus_page ? `القاموس الوحيد، ص ${hit.qamus_page}` : '',
  ].filter(Boolean);
  return {
    id: `lexicon:page:${w}`,
    reference: `${hit.root ? `الجذر «${hit.root}» — ` : ''}${bits.join(' | ')}`,
    content: '',
  };
}
