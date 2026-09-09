/**
 * Connectors Hub (Phase 4, ADR-0040) — الدرر السنية (dorar.net) hadith grading.
 *
 * Dorar's own public endpoint, `dorar.net/dorar_api.json?skey=…`, returns
 * `{ ahadith: { result: "<html>" } }` — rendered HTML in a JSON envelope. We
 * hit it DIRECTLY in the main process (no MCP intermediary, no auth), exactly
 * like `adapters/repositories.ts` (ADR-0028): the URL is built here from the
 * hadith text and nothing else.
 *
 * The parse is ported verbatim from `supabase/functions/islamic-api-fetch/
 * index.ts` `fetchDorar` (the header shape that clears Cloudflare, the
 * `hadith` / `hadith-info` block regex). The grading is reported EXACTLY as
 * Dorar states it — الراوي / المحدث / المصدر / الحكم — never our own verdict.
 */
import { createHash } from 'node:crypto';
import { logger } from '../../lib/logger.js';
import type { RetrievedChunk } from '../../../shared/agent/grounding.js';

const log = logger.child('agent/dorar');

const ENDPOINT = 'https://dorar.net/dorar_api.json';
const TIMEOUT_MS = 12_000;

/** A real browser's headers — a bare fetch trips dorar.net's Cloudflare check. */
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'ar,en;q=0.9',
  Referer: 'https://dorar.net/',
};

export interface HadithGrading {
  matn: string;
  rawi?: string;
  mohdith?: string;
  source?: string;
  number?: string;
  grade?: string;
}

export interface GradeHadithResult {
  chunks: RetrievedChunk[];
  note?: string;
  error?: string;
}

const stripTags = (s: string): string => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Parse dorar.net's `ahadith.result` HTML into gradings. Pure — unit-tested. */
export function parseDorarHtml(html: string, limit: number): HadithGrading[] {
  const out: HadithGrading[] = [];
  const pairRe =
    /<div[^>]*class="hadith"[^>]*>([\s\S]*?)<\/div>\s*(?:<[^>]*>\s*)*<div[^>]*class="hadith-info"[^>]*>([\s\S]*?)<\/div>/gi;

  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(html)) !== null && out.length < limit) {
    const matn = stripTags(m[1]).replace(/^\d+\s*-\s*/, '').trim();
    const info = stripTags(m[2]);
    if (!matn || matn.length < 10) continue;

    const grab = (label: string): string => {
      const re = new RegExp(
        label +
          '\\s*:?\\s*([^:]*?)(?=\\s*(?:الراوي|المحدث|المصدر|الصفحة أو الرقم|الرقم|خلاصة حكم المحدث|التخريج|$))',
      );
      return info.match(re)?.[1]?.trim() ?? '';
    };

    out.push({
      matn,
      rawi: grab('الراوي') || undefined,
      mohdith: grab('المحدث') || undefined,
      source: grab('المصدر') || grab('الكتاب') || undefined,
      number: grab('الصفحة أو الرقم') || grab('الرقم') || undefined,
      grade: grab('خلاصة حكم المحدث') || grab('درجة الحديث') || undefined,
    });
  }
  return out;
}

/** Build the citable reference line — the source's own verdict, kept separate. */
function toChunk(g: HadithGrading): RetrievedChunk {
  const src = [g.source, g.number ? `رقم ${g.number}` : ''].filter(Boolean).join('، ') || 'الدرر السنية';
  const bits = [
    src,
    g.rawi ? `الراوي: ${g.rawi}` : '',
    g.mohdith ? `المحدث: ${g.mohdith}` : '',
    g.grade ? `الحكم: ${g.grade}` : '',
  ].filter(Boolean);
  return {
    id: `dorar:${createHash('sha1').update(g.matn.slice(0, 200)).digest('hex').slice(0, 12)}`,
    reference: `${bits.join(' — ')} (الدرر السنية)`,
    content: g.matn.slice(0, 2000),
    grade: g.grade,
  };
}

export async function gradeHadith(input: { text: string; limit?: number }): Promise<GradeHadithResult> {
  const query = (input.text ?? '').trim();
  if (!query) {
    return { chunks: [], error: 'grade_hadith needs the hadith text (or a distinctive phrase from it)' };
  }
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 15);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let html = '';
  try {
    const res = await fetch(`${ENDPOINT}?skey=${encodeURIComponent(query)}`, {
      signal: controller.signal,
      headers: BROWSER_HEADERS,
    });
    if (!res.ok) return { chunks: [], error: `الدرر السنية returned HTTP ${res.status}` };
    const data = (await res.json()) as { ahadith?: { result?: string } };
    html = data?.ahadith?.result ?? '';
  } catch (err) {
    const aborted = controller.signal.aborted;
    log.warn('dorar lookup failed', { message: (err as Error).message });
    return {
      chunks: [],
      error: aborted
        ? 'الدرر السنية did not respond in time'
        : `الدرر السنية lookup failed: ${(err as Error).message}`,
    };
  } finally {
    clearTimeout(timer);
  }

  if (!html) return { chunks: [], note: 'الدرر السنية returned no matching narrations for that text.' };
  const graded = parseDorarHtml(html, limit);
  if (graded.length === 0) {
    return { chunks: [], note: 'الدرر السنية returned a result, but no narrations could be read from it.' };
  }
  return { chunks: graded.map(toChunk) };
}
