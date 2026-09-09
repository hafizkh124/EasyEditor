/**
 * Connectors Hub (Phase 7, ADR-0042) — normalise Ganjoor poem-search results
 * into citable Persian-verse chunks.
 *
 * `api.ganjoor.net/api/ganjoor/poems/search` returns an ARRAY of poem objects;
 * each carries `category.poet` (name / nickname), `category.cat` (bookName /
 * title), `verses[]` (the lines), and a `fullUrl` back to ganjoor.net.
 *
 * Pure — no runtime globals. Defensive: any missing field just drops the poem.
 */
import type { RetrievedChunk } from '../agent/grounding.js';

const GANJOOR_WEB = 'https://ganjoor.net';

interface GanjoorVerse {
  vOrder?: number;
  text?: string;
}

export interface GanjoorPoem {
  id?: number;
  title?: string;
  fullTitle?: string;
  fullUrl?: string;
  plainText?: string;
  verses?: GanjoorVerse[];
  category?: {
    poet?: { name?: string; nickname?: string };
    cat?: { title?: string; bookName?: string };
  };
}

function versesToText(verses: GanjoorVerse[] | undefined): string {
  if (!Array.isArray(verses) || verses.length === 0) return '';
  return verses
    .filter((v) => typeof v.text === 'string' && v.text.trim())
    .sort((a, b) => (a.vOrder ?? 0) - (b.vOrder ?? 0))
    .slice(0, 12)
    .map((v) => v.text!.trim())
    .join('\n');
}

export function normaliseGanjoor(json: unknown, limit: number): RetrievedChunk[] {
  const poems = Array.isArray(json) ? (json as GanjoorPoem[]) : [];
  const out: RetrievedChunk[] = [];
  for (const p of poems.slice(0, Math.max(1, limit))) {
    if (typeof p?.id !== 'number') continue;
    const poet = (p.category?.poet?.nickname || p.category?.poet?.name || '').trim();
    const work = (p.category?.cat?.bookName || p.category?.cat?.title || '').trim();
    const title = (p.title || p.fullTitle || '').trim();
    const body = versesToText(p.verses) || (p.plainText ?? '').trim();
    if (!body) continue;
    const refBits = [poet, work, title].filter(Boolean);
    out.push({
      id: `ganjoor:${p.id}`,
      reference: `${refBits.join(' — ') || 'شعر فارسی'} (گنجور / Ganjoor)`,
      content: body.slice(0, 2000),
      source_url: p.fullUrl ? `${GANJOOR_WEB}${p.fullUrl}` : undefined,
    });
  }
  return out;
}

/** Best-effort poet-id resolution from `/api/ganjoor/poets`. */
export function findPoetId(json: unknown, name: string): number {
  const poets = Array.isArray(json) ? (json as Array<{ id?: number; name?: string; nickname?: string }>) : [];
  const lower = name.trim().toLowerCase();
  if (!lower) return 0;
  const hit = poets.find(
    (p) => (p.name ?? '').toLowerCase().includes(lower) || (p.nickname ?? '').toLowerCase().includes(lower),
  );
  return typeof hit?.id === 'number' ? hit.id : 0;
}
