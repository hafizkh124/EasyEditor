/**
 * M8 Layer 6 — agent tool dispatch (SPEC-M8 §3).
 *
 * Maps a tool call from the closed registry to the real implementation:
 * the Word adapter, the local corpus, the Shamela library, `detectTools`.
 * Every parameter arrives as JSON (security gate 1); every file path is
 * resolved inside the open project folder (gate 2); every edit backs the
 * chapter up first (gate 3) and lands as a tracked change (ADR-0016 c2).
 *
 * P8a scope: `run_task` and `search_general` return a clear "not in this
 * build" error — they need the text-task pipeline / the General-mode edge
 * function, which are later slices.
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { logger } from '../lib/logger.js';
import { detectTools } from '../host/index.js';
import * as word from '../adapters/word.js';
import { chapterPath, backupChapter, refreshChapters } from '../fs/projectFolder.js';
import { getWorkspaceDbService } from '../ipc/workspaceHandlers.js';
import { searchShamelaNative } from '../shamela/shamelaNative.js';
import { RetrievalLedger, assertClaimSupported, type RetrievedChunk, type ClaimCheckFn } from '../../shared/agent/grounding.js';
import { summariseCapabilities } from '../../shared/agent/capabilities.js';
import { recordEdit } from './checkpoint.js';
import type { DispatchFn } from '../../shared/agent/types.js';

const log = logger.child('agent/dispatch');

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`${name} must be a non-empty string`);
  return v;
};
const num = (v: unknown, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);

export interface AgentSession {
  /** Absolute path to the open project folder. */
  projectRoot: string;
  /** Task checkpoint id — every edit is snapshotted under it (ADR-0019 item 5). */
  checkpointId?: string;
  /** The optional claim-check tier for insert_footnote (ADR-0019 item 6). */
  claimCheck?: ClaimCheckFn | null;
}

export interface Dispatcher {
  dispatch: DispatchFn;
  ledger: RetrievalLedger;
}

export function createDispatcher(session: AgentSession): Dispatcher {
  const ledger = new RetrievalLedger();
  const root = session.projectRoot;
  const checkpointId = session.checkpointId;
  const claimCheck = session.claimCheck ?? null;

  /** Snapshot a chapter into the task checkpoint + take the per-write backup. */
  const guardEdit = (chapter: string): boolean => {
    if (checkpointId) recordEdit(root, checkpointId, chapter);
    return Boolean(backupChapter(root, chapter));
  };

  /** Plain text of a chapter, cached for the life of this dispatcher. */
  const textCache = new Map<string, string>();
  const chapterText = async (chapter: string): Promise<string> => {
    if (textCache.has(chapter)) return textCache.get(chapter)!;
    const tmp = path.join(os.tmpdir(), `easyeditor-consist-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    try {
      await word.fromWord(chapterPath(root, chapter), 'txt', tmp);
      const txt = fs.readFileSync(tmp, 'utf8');
      textCache.set(chapter, txt);
      return txt;
    } finally {
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    }
  };

  const dispatch: DispatchFn = async (name, args) => {
    switch (name) {
      case 'list_capabilities': {
        const t = detectTools();
        return { summary: summariseCapabilities({ ...t }), ...t };
      }

      case 'read_document': {
        const chapter = str(args.chapter, 'chapter');
        return word.readStructure(chapterPath(root, chapter));
      }

      case 'search_corpus': {
        const query = str(args.query, 'query');
        const limit = num(args.limit, 8);

        // (a) the imported personal corpus (FTS over library chunks)
        const svc = await getWorkspaceDbService();
        let hits: Awaited<ReturnType<typeof svc.searchChunks>> = [];
        try { hits = await svc.searchChunks(query, limit); } catch (err) { log.warn('corpus FTS failed', { message: (err as Error).message }); }
        const chunks: RetrievedChunk[] = hits.map((h) => ({
          id: `corpus:${h.itemId}:${h.pageNumber ?? 0}`,
          reference: h.pageNumber ? `${h.title}, p. ${h.pageNumber}` : h.title,
          content: h.content,
        }));

        // (b) the open project folder's OWN chapters — a lexical scan, so the
        // agent can answer questions about the document even before anything
        // has been imported into the corpus DB.
        for (const name of refreshChapters(root).map((c) => c.name)) {
          const text = await chapterText(name).catch(() => '');
          const idx = text.toLowerCase().indexOf(query.toLowerCase());
          if (idx === -1) continue;
          const excerpt = text.slice(Math.max(0, idx - 120), idx + query.length + 280).replace(/\s+/g, ' ').trim();
          chunks.push({ id: `chapter:${name}`, reference: name, content: excerpt });
        }

        ledger.add(chunks);
        return {
          count: chunks.length,
          note: chunks.length === 0 ? 'Nothing matched in the personal corpus or the open project chapters.' : undefined,
          results: chunks.slice(0, limit + 4).map((c) => ({ id: c.id, reference: c.reference, excerpt: (c.content ?? '').slice(0, 400) })),
        };
      }

      case 'search_shamela': {
        const query = str(args.query, 'query');
        const limit = num(args.limit, 8);
        const hits = await searchShamelaNative(query, limit);
        const chunks: RetrievedChunk[] = hits.map((h) => ({
          id: `shamela:${h.bookId}:${h.pageNumber}`,
          reference: `${h.bookTitle}، ص ${h.pageNumber}`,
          content: h.snippet,
        }));
        ledger.add(chunks);
        return { count: chunks.length, results: chunks.map((c) => ({ id: c.id, reference: c.reference, excerpt: (c.content ?? '').slice(0, 400) })) };
      }

      case 'insert_footnote': {
        const chapter = str(args.chapter, 'chapter');
        const marker = str(args.marker, 'marker');
        const chunk = ledger.resolveOrThrow(args.source_id); // tier 1: integrity gate
        const verdict = await assertClaimSupported(args.claim, chunk.content, claimCheck); // tier 2: claim check
        const dest = chapterPath(root, chapter);
        const backedUp = guardEdit(chapter);
        const res = await word.applyCitations(
          { sourcePath: dest },
          [{ marker, text: ledger.footnoteText(chunk) }],
          dest,
          { trackChanges: true },
        );
        return {
          applied: res.applied, notFound: res.notFound, reference: chunk.reference, backedUp,
          ...(verdict ? { claimCheck: verdict.note } : {}),
        };
      }

      case 'set_page_layout': {
        const chapter = str(args.chapter, 'chapter');
        const backedUp = guardEdit(chapter);
        await word.setChapterLayout(chapterPath(root, chapter));
        return { ok: true, chapter, backedUp };
      }

      case 'check_consistency': {
        const term = str(args.term, 'term');
        const exclude = typeof args.exclude_chapter === 'string' ? args.exclude_chapter : null;
        const names = refreshChapters(root).map((c) => c.name).filter((n) => n !== exclude);
        const found: Array<{ chapter: string; count: number; snippet: string }> = [];
        for (const name of names) {
          const text = await chapterText(name).catch(() => '');
          const idx = text.indexOf(term);
          if (idx === -1) continue;
          const count = text.split(term).length - 1;
          found.push({ chapter: name, count, snippet: text.slice(Math.max(0, idx - 60), idx + term.length + 60).replace(/\s+/g, ' ').trim() });
        }
        return { term, appearsIn: found, suggestion: found.length ? `"${term}" also appears in ${found.map((f) => f.chapter).join(', ')} — consider reviewing those for consistency.` : `"${term}" does not appear in the other chapters.` };
      }

      case 'convert_document': {
        const chapter = str(args.chapter, 'chapter');
        const to = str(args.to, 'to') as 'docx' | 'pdf' | 'rtf' | 'txt';
        const src = chapterPath(root, chapter);
        const base = path.basename(chapter, path.extname(chapter));
        const outDir = path.join(root, 'export');
        if (path.extname(chapter).toLowerCase() === '.pdf' && to === 'docx') {
          const r = await word.reflowPdf(src, path.join(outDir, `${base}.docx`));
          return { outputPath: r.outputPath, wordCount: r.wordCount };
        }
        const r = await word.fromWord(src, to === 'docx' ? 'rtf' : to, path.join(outDir, `${base}.${to}`));
        return { outputPath: r.outputPath };
      }

      case 'run_task':
        return { error: 'run_task is not available in this build yet — apply built-in text tasks from the editor for now' };

      default:
        log.warn('unknown tool', { name });
        return { error: `unknown tool: ${name}` };
    }
  };

  return { dispatch, ledger };
}
