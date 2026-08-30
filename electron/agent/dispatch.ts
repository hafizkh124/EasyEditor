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
import { logger } from '../lib/logger.js';
import { detectTools } from '../host/index.js';
import * as word from '../adapters/word.js';
import { chapterPath, backupChapter } from '../fs/projectFolder.js';
import { getWorkspaceDbService } from '../ipc/workspaceHandlers.js';
import { searchShamelaNative } from '../shamela/shamelaNative.js';
import { RetrievalLedger, type RetrievedChunk } from '../../shared/agent/grounding.js';
import { summariseCapabilities } from '../../shared/agent/capabilities.js';
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
}

export interface Dispatcher {
  dispatch: DispatchFn;
  ledger: RetrievalLedger;
}

export function createDispatcher(session: AgentSession): Dispatcher {
  const ledger = new RetrievalLedger();
  const root = session.projectRoot;

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
        const svc = await getWorkspaceDbService();
        const hits = await svc.searchChunks(query, limit);
        const chunks: RetrievedChunk[] = hits.map((h) => ({
          id: `corpus:${h.itemId}:${h.pageNumber ?? 0}`,
          reference: h.pageNumber ? `${h.title}, p. ${h.pageNumber}` : h.title,
          content: h.content,
        }));
        ledger.add(chunks);
        return { count: chunks.length, results: chunks.map((c) => ({ id: c.id, reference: c.reference, excerpt: (c.content ?? '').slice(0, 400) })) };
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
        const chunk = ledger.resolveOrThrow(args.source_id); // the integrity gate
        const dest = chapterPath(root, chapter);
        const backup = backupChapter(root, chapter);
        const res = await word.applyCitations(
          { sourcePath: dest },
          [{ marker, text: ledger.footnoteText(chunk) }],
          dest,
          { trackChanges: true },
        );
        return { applied: res.applied, notFound: res.notFound, reference: chunk.reference, backedUp: Boolean(backup) };
      }

      case 'set_page_layout': {
        const chapter = str(args.chapter, 'chapter');
        const dest = chapterPath(root, chapter);
        const backup = backupChapter(root, chapter);
        await word.setChapterLayout(dest);
        return { ok: true, chapter, backedUp: Boolean(backup) };
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
