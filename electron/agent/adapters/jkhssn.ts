/**
 * ADR-0045 — the ONLY place that stitches جوامع الكلم-local structure together
 * with Supabase-resolved narrator names / matn text. Runs in the Electron main
 * process; the Supabase side is reached through the `researchSearch` bridge
 * (main can't hit the signed-in edge functions directly — ADR-0019 #7).
 */
import {
  axisSanadTree,
  axisNarrator,
  axisTakhrij,
  axisJudgments,
  axisThematic,
} from '../../jkhssn/axes.js';
import { detectJkhssnInstallation } from '../../jkhssn/jkhssnNative.js';
import { buildJkhssnNarratorQuery, type JkhssnNarratorAspect } from '../../../shared/agent/jkhssnQuery.js';
import type { RetrievedChunk } from '../../../shared/agent/grounding.js';
import { logger } from '../../lib/logger.js';

const log = logger.child('agent/jkhssn');

type ResearchSearch = ((mode: 'islamic' | 'general', query: string) => Promise<{ answer?: string; citations?: Array<{ domain: string; url?: string | null; citation_ref: Record<string, unknown> }>; error?: string }>) | null;

/** A soft "not available" result pointing the model at the online counterpart. */
function unavailable(alt: string): { error: string } {
  return { error: `جوامع الكلم کا مقامی انڈیکس دستیاب نہیں (${alt} استعمال کریں یا ترتیبات → کنیکٹرز سے انڈیکس بنائیں)` };
}

async function ensureIndex(): Promise<boolean> {
  try {
    const s = await detectJkhssnInstallation();
    return s.indexBuilt && !s.indexStale;
  } catch {
    return false;
  }
}

export interface JkhssnAdapterResult {
  chunks: RetrievedChunk[];
  answer?: string;
  data?: unknown;
  note?: string;
  error?: string;
}

// ── narrator ─────────────────────────────────────────────────────────────────

export async function jkhssnNarrator(
  args: { name: string; aspect?: JkhssnNarratorAspect },
  bridge: { researchSearch: ResearchSearch },
): Promise<JkhssnAdapterResult> {
  if (!(await ensureIndex())) return { chunks: [], ...unavailable('lookup_narrator') };
  const card = axisNarrator({ nameQuery: args.name });
  if (!card) return { chunks: [], note: `«${args.name}» جوامع الكلم کے رواۃ میں نہیں ملا — lookup_narrator آزمائیں۔` };

  // Supabase side: an Arabic rijāl query keyed to the local name shapes, so the
  // bridge supplies verifiable citations + prose the local card lacks.
  const chunks: RetrievedChunk[] = [];
  let answer: string | undefined;
  if (bridge.researchSearch && card.nameShapes.length) {
    try {
      const r = await bridge.researchSearch('islamic', buildJkhssnNarratorQuery(card.nameShapes, args.aspect ?? 'all'));
      if (!r.error) {
        answer = (r.answer ?? '').trim() || undefined;
        for (const c of r.citations ?? []) {
          if (c.domain !== 'classical-rijal' && c.domain !== 'islamicurdubooks-rijal' && c.domain !== 'shamela') continue;
          const ref = refString(c.citation_ref);
          if (!ref) continue;
          chunks.push({ id: `${c.domain}:jkhssn-rijal:${chunks.length + 1}`, reference: ref, source_url: c.url ?? null });
        }
      }
    } catch (err) {
      log.warn('narrator bridge lookup failed', { err: (err as Error).message });
    }
  }

  return {
    chunks,
    answer,
    data: card,
    note: chunks.length === 0 ? 'مقامی جوامع الكلم سے ساخت (مرتبہ، جرح و تعدیل) ملی؛ حوالہ جات کے لیے lookup_narrator بھی چلائیں۔' : undefined,
  };
}

// ── sanad tree ───────────────────────────────────────────────────────────────

export async function jkhssnSanadTree(args: { hadithMainId?: number; hadithText?: string }): Promise<JkhssnAdapterResult> {
  if (!(await ensureIndex())) return { chunks: [], ...unavailable('search_hadith') };
  if (args.hadithMainId == null) {
    return { chunks: [], note: 'شجرۂ اسناد کے لیے حدیث کی مجموعہ + مطبوعہ نمبر درکار ہے (پہلے jkhssn_takhrij چلائیں)۔' };
  }
  const tree = axisSanadTree({ hadithMainId: args.hadithMainId });
  if (!tree.chains.length) return { chunks: [], note: 'اس حدیث کے لیے جوامع الكلم میں کوئی سند درج نہیں۔' };
  return {
    chunks: [],
    data: tree,
    note: `${tree.chains.length} سند، ${tree.rawyIds.length} رواۃ — نام Supabase سے حل کیے جائیں گے۔`,
  };
}

// ── takhrīj ──────────────────────────────────────────────────────────────────

export async function jkhssnTakhrij(args: { hadithMainId?: number; hadithText?: string; bookIds?: number[] }): Promise<JkhssnAdapterResult> {
  if (!(await ensureIndex())) return { chunks: [], ...unavailable('grade_hadith') };
  if (args.hadithMainId == null) {
    return { chunks: [], note: 'تخریج کے لیے حدیث کی مجموعہ + مطبوعہ نمبر درکار ہے۔' };
  }
  const full = axisTakhrij(args.hadithMainId);
  const scope = (args.bookIds ?? []).filter((n) => Number.isFinite(n));
  const t = scope.length
    ? { ...full, entries: full.entries.filter((e) => e.bookId != null && scope.includes(e.bookId)), bookIds: full.bookIds.filter((b) => scope.includes(b)) }
    : full;
  return {
    chunks: [],
    data: t,
    note: `${t.entries.length} مواضع، ${t.bookIds.length} کتب${scope.length ? ' (دائرہ محدود)' : ''}${full.serviceState?.degree != null ? `، درجہ کوڈ ${full.serviceState.degree}` : ''}۔`,
  };
}

// ── judgments / ʿilal ────────────────────────────────────────────────────────

export async function jkhssnJudgments(args: { hadithMainId?: number; hadithText?: string }): Promise<JkhssnAdapterResult> {
  if (!(await ensureIndex())) return { chunks: [], ...unavailable('grade_hadith') };
  if (args.hadithMainId == null) return { chunks: [], note: 'احکامِ ائمہ کے لیے حدیث کی شناخت (hadithMainId) درکار ہے۔' };
  const j = axisJudgments(args.hadithMainId);
  if (!j.judgments.length) return { chunks: [], note: 'اس حدیث پر جوامع الكلم میں کوئی حکم درج نہیں — grade_hadith آزمائیں۔' };
  const chunks: RetrievedChunk[] = j.judgments.map((jd, i) => ({
    id: `jkhssn:judgment:${jd.id}:${i}`,
    reference: 'جوامع الكلم — أحكام الأئمة',
    content: jd.say,
  }));
  return { chunks, data: j, answer: j.judgments.map((x) => `• ${x.say}`).join('\n') };
}

// ── thematic ─────────────────────────────────────────────────────────────────

export async function jkhssnThematic(args: { query?: string; subjectId?: number }): Promise<JkhssnAdapterResult> {
  if (!(await ensureIndex())) return { chunks: [], ...unavailable('search_hadith') };
  const r = axisThematic({ query: args.query, subjectId: args.subjectId });
  return {
    chunks: [],
    data: r,
    note: r.matches.length
      ? `${r.matches.length} ذیلی ابواب${r.hadithIds?.length ? `، ${r.hadithIds.length} احادیث` : ''}۔`
      : 'کوئی مماثل باب نہیں ملا۔',
  };
}

function refString(cr: Record<string, unknown>): string | null {
  const book = (cr.book ?? cr.collection ?? cr.name_ar ?? cr.shuhra_ar) as string | undefined;
  const page = (cr.page ?? cr.hadith_number) as string | number | undefined;
  if (!book) return null;
  return page != null ? `${book}، ${page}` : String(book);
}
