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
import { isAllowedOption } from './globalOptions.js';
import { chapterPath, backupChapter, refreshChapters } from '../fs/projectFolder.js';
import { getWorkspaceDbService } from '../ipc/workspaceHandlers.js';
import { searchShamelaNative } from '../shamela/shamelaNative.js';
import { generateContentStream } from '../ai/geminiClient.js';
import { RetrievalLedger, assertClaimSupported, type RetrievedChunk, type ClaimCheckFn } from '../../shared/agent/grounding.js';
import { summariseCapabilities } from '../../shared/agent/capabilities.js';
import { resolveTaskSlug, taskOutputIsHtml, RUN_TASK_NAMES } from '../../shared/agent/textTasks.js';
import { getRefineTextPrompt } from '../../shared/ai/prompts/refineText.js';
import { recordWrite } from './checkpoint.js';
import { getDraftMode, buildDraftInput, type DraftMode } from '../../shared/ai/prompts/draftSection.js';
import { queryTafseer, type TafseerMode } from './adapters/tafsir.js';
import { formatScholarlyRef } from '../../shared/research/citationTypes.js';
import type { DispatchFn, EmitArtifactFn } from '../../shared/agent/types.js';
import type { GeneralSearchResult } from './generalSearch.js';
import type { ResearchMode, ResearchResult } from './researchBridge.js';

const log = logger.child('agent/dispatch');

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`${name} must be a non-empty string`);
  return v;
};
const num = (v: unknown, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);

/** ADR-0027 F4 — no single tool result floods the context window. */
const MAX_TOOL_RESULT_CHARS = 6000;
const capResult = (text: string): string =>
  text.length <= MAX_TOOL_RESULT_CHARS ? text : `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n…[truncated]`;

export interface AgentSession {
  /** Absolute path to the open project folder. */
  projectRoot: string;
  /** Task checkpoint id — every edit is snapshotted under it (ADR-0019 item 5). */
  checkpointId?: string;
  /** The optional claim-check tier for insert_footnote (ADR-0019 item 6). */
  claimCheck?: ClaimCheckFn | null;
  /**
   * Runs one General-channel search via the renderer (ADR-0019 item 7). Absent
   * in a headless context — `search_general` then returns a clear message.
   */
  generalSearch?: ((query: string) => Promise<GeneralSearchResult>) | null;
  /**
   * Runs a research query via the renderer — `mode: 'islamic'` returns
   * page-precise citations (M9 Phase 1, ADR-0022). Absent in a headless
   * context — `search_hadith` then returns a clear message.
   */
  researchSearch?: ((mode: ResearchMode, query: string) => Promise<ResearchResult>) | null;
  /** Emits a live artifact event (M9 ADR-0024). No-op when absent. */
  emitArtifact?: EmitArtifactFn | null;
  /**
   * Runs a whole playbook nested inside the free loop (`run_playbook` tool,
   * M9 ADR-0020). Set by `run.ts` after the dispatcher exists. Absent ⇒ the
   * tool returns a clear message.
   */
  runPlaybookRef?: ((ref: string, chapter?: string) => Promise<unknown>) | null;
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
  const generalSearch = session.generalSearch ?? null;
  const researchSearch = session.researchSearch ?? null;
  const emitArtifact: EmitArtifactFn = (ev) => { try { session.emitArtifact?.(ev); } catch { /* non-fatal */ } };

  /** Snapshot any in-project write (chapter or not) into the task checkpoint. */
  const guardWrite = (relPath: string): void => {
    if (checkpointId) recordWrite(root, checkpointId, relPath);
  };

  /** guardWrite + the per-write corruption backup (chapters only). */
  const guardEdit = (chapter: string): boolean => {
    guardWrite(chapter);
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
        const limit = Math.min(num(args.limit, 8), 12); // ADR-0027 F4 — hard cap

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
          results: chunks.slice(0, limit).map((c) => ({ id: c.id, reference: c.reference, excerpt: (c.content ?? '').slice(0, 350) })),
        };
      }

      case 'search_shamela': {
        const query = str(args.query, 'query');
        const limit = Math.min(num(args.limit, 8), 12); // ADR-0027 F4 — hard cap
        const hits = await searchShamelaNative(query, limit);
        const chunks: RetrievedChunk[] = hits.map((h) => ({
          id: `shamela:${h.bookId}:${h.pageNumber}`,
          reference: `${h.bookTitle}، ص ${h.pageNumber}`,
          content: h.snippet,
        }));
        ledger.add(chunks);
        return { count: chunks.length, results: chunks.map((c) => ({ id: c.id, reference: c.reference, excerpt: (c.content ?? '').slice(0, 350) })) };
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

      case 'add_document_comment': {
        const chapter = str(args.chapter, 'chapter');
        const anchor = str(args.anchor_text, 'anchor_text');
        const comment = str(args.comment, 'comment');
        const author = typeof args.author === 'string' && args.author.trim() ? args.author : 'EasyEditor Agent';
        const backedUp = guardEdit(chapter);
        const r = await word.addComment(chapterPath(root, chapter), { anchorText: anchor, comment, author });
        return {
          chapter, added: r.added, notFound: r.notFound, backedUp,
          ...(r.notFound
            ? { note: `The anchor text "${anchor.slice(0, 50)}${anchor.length > 50 ? '…' : ''}" was not found in the chapter — no comment was added. Use a shorter exact phrase.` }
            : {}),
        };
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

      case 'query_tafseer': {
        const reference = str(args.reference, 'reference');
        const mode = str(args.mode, 'mode') as TafseerMode;
        const sources = Array.isArray(args.sources) ? args.sources.filter((s): s is string => typeof s === 'string') : undefined;
        const q = typeof args.query === 'string' ? args.query : undefined;
        const r = await queryTafseer({ reference, mode, sources, query: q });
        if (r.error) return { error: r.error };
        ledger.add(r.chunks);
        if (r.chunks.length) {
          const artifactId = `tafsir-${Date.now().toString(36)}`;
          emitArtifact({ op: 'open', artifactId, title: r.chunks[0].reference, artifactType: 'document' });
          emitArtifact({ op: 'delta', artifactId, mode: 'replace', text: r.text });
          emitArtifact({ op: 'citations', artifactId, entries: r.chunks.map((c, i) => ({ marker: String(i + 1), reference: c.reference, sourceId: c.id, supported: true, tier: 1 })) });
          emitArtifact({ op: 'close', artifactId, status: 'final' });
        }
        return {
          count: r.chunks.length,
          note: r.note,
          text: capResult(r.text),
          results: r.chunks.map((c) => ({ id: c.id, reference: c.reference, excerpt: (c.content ?? '').slice(0, 400) })),
        };
      }

      case 'search_hadith': {
        const query = str(args.query, 'query');
        if (!researchSearch) {
          return { error: 'search_hadith is only available from the Agent panel (it uses your signed-in research session).' };
        }
        const r = await researchSearch('islamic', query);
        if (r.error) return { error: r.error };
        const chunks: RetrievedChunk[] = [];
        for (const c of r.citations ?? []) {
          const ref = formatScholarlyRef(c.citation_ref, c.domain);
          if (!ref) continue;
          const num = c.citation_ref.hadith_number ?? c.citation_ref.fatwa_number ?? chunks.length + 1;
          chunks.push({
            id: `${c.domain}:${c.citation_ref.collection ?? c.citation_ref.book ?? 'x'}:${num}`,
            reference: ref,
            source_url: c.url ?? c.citation_ref.url ?? null,
          });
        }
        ledger.add(chunks);
        if (chunks.length) {
          const artifactId = `hadith-${Date.now().toString(36)}`;
          emitArtifact({ op: 'open', artifactId, title: `احادیث: ${query.slice(0, 40)}`, artifactType: 'citation-list' });
          emitArtifact({ op: 'citations', artifactId, entries: chunks.map((c, i) => ({ marker: String(i + 1), reference: c.reference, sourceId: c.id, supported: true, url: c.source_url ?? undefined, tier: 1 })) });
          emitArtifact({ op: 'close', artifactId, status: 'final' });
        }
        return {
          count: chunks.length,
          note: chunks.length === 0 ? 'The hadith channel returned an answer but no page-precise citations to cite.' : undefined,
          answer: capResult((r.answer ?? '').trim()),
          results: chunks.map((c) => ({ id: c.id, reference: c.reference, url: c.source_url ?? undefined })),
        };
      }

      case 'search_general': {
        const query = str(args.query, 'query');
        if (!generalSearch) {
          return { error: 'search_general is only available from the Agent panel (it uses your signed-in research session).' };
        }
        const r = await generalSearch(query);
        if (r.error) return { error: r.error };
        const answer = capResult((r.answer ?? '').trim());
        if (!answer) return { count: 0, channel: r.channel ?? 'general', note: 'The General research channel returned nothing.' };
        // Deliberately NOT added to the retrieval ledger: a General answer is
        // not page-precise, so insert_footnote must never be able to cite it.
        // The transcript still records this call via toolCalls.
        return { channel: r.channel ?? 'general', answer };
      }

      case 'run_task': {
        const chapter = str(args.chapter, 'chapter');
        const slug = resolveTaskSlug(str(args.task, 'task'));
        if (!slug) {
          return { error: `unknown task "${args.task}" — try one of: ${RUN_TASK_NAMES.join(', ')}` };
        }
        if (slug === 'citations') {
          return { error: 'for citations, use search_corpus / search_shamela then insert_footnote — run_task will not invent references' };
        }
        const prompt = getRefineTextPrompt(slug);
        if (!prompt) return { error: `task "${slug}" has no prompt` };

        const dest = chapterPath(root, chapter);
        const isHtml = taskOutputIsHtml(slug);

        // Read the chapter's current content (html for auto-format, else text).
        const tmp = path.join(os.tmpdir(), `easyeditor-run-${Date.now()}-${Math.random().toString(36).slice(2)}.${isHtml ? 'html' : 'txt'}`);
        let source: string;
        try {
          await word.fromWord(dest, isHtml ? 'html' : 'txt', tmp);
          source = fs.readFileSync(tmp, 'utf8');
        } finally {
          try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
        }
        if (isHtml) source = source.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '').trim();
        if (!source.trim()) return { error: `chapter "${chapter}" has no text to work on` };

        const refined = (await generateContentStream({ prompt: source, systemInstruction: prompt })).trim();
        if (!refined) return { error: 'the model returned nothing' };

        const backedUp = guardEdit(chapter);
        const res = await word.applyTextTask(dest, refined, { isHtml });
        return { chapter, task: slug, revisions: res.revisions, backedUp, changed: true };
      }

      case 'run_playbook': {
        const ref = str(args.playbook, 'playbook');
        const chapter = typeof args.chapter === 'string' && args.chapter.trim() ? args.chapter : undefined;
        if (!session.runPlaybookRef) {
          return { error: 'run_playbook is only available from the Agent panel — select the playbook from the / menu instead.' };
        }
        return session.runPlaybookRef(ref, chapter);
      }

      case 'draft_section': {
        const chapter = str(args.chapter, 'chapter');
        const mode = str(args.mode, 'mode') as DraftMode;
        const spec = getDraftMode(mode);
        if (!spec) return { error: `unknown draft mode "${mode}" — one of: outline, prose, column, translation, summary, literary-urdu` };

        const sourceIds = Array.isArray(args.source_ids) ? args.source_ids.filter((s): s is string => typeof s === 'string') : [];
        if (spec.grounded && sourceIds.length === 0) {
          return { error: `draft_section mode "${mode}" needs sources — call search_corpus / search_shamela first and pass their ids as source_ids` };
        }
        // Resolve every id through the ledger (same gate as insert_footnote).
        const sources: Array<{ marker: string; reference: string; excerpt: string }> = [];
        for (let i = 0; i < sourceIds.length; i += 1) {
          const chunk = ledger.resolveOrThrow(sourceIds[i]);
          sources.push({ marker: String(i + 1), reference: chunk.reference, excerpt: (chunk.content ?? '').slice(0, 1200) });
        }

        const dest = chapterPath(root, chapter);
        let chapterExcerpt = '';
        try { chapterExcerpt = (await chapterText(chapter)).slice(0, 3000); } catch { /* new/empty chapter */ }

        const sectionHeading = typeof args.section_heading === 'string' ? args.section_heading : undefined;
        const content = buildDraftInput({ mode, sectionHeading, chapterExcerpt, sources: sources.length ? sources : undefined });
        const draft = (await generateContentStream({ prompt: content, systemInstruction: spec.instruction })).trim();
        if (!draft) return { error: 'the model returned nothing' };

        const artifactId = `draft-${chapter}-${Date.now().toString(36)}`;
        emitArtifact({ op: 'open', artifactId, title: `Draft — ${sectionHeading ?? chapter}`, artifactType: 'document' });
        emitArtifact({ op: 'delta', artifactId, mode: 'replace', html: spec.html ? draft : undefined, text: spec.html ? undefined : draft });

        const backedUp = guardEdit(chapter);
        const labelled = spec.html
          ? `<p><em>[DRAFT — review every claim]</em></p>\n${draft}`
          : `[DRAFT — review every claim]\n${draft}`;
        const res = await word.applyTextTask(dest, labelled, { isHtml: spec.html });
        emitArtifact({ op: 'close', artifactId, status: 'final', targetChapter: chapter });
        return { chapter, mode, revisions: res.revisions, backedUp, grounded: spec.grounded, sourcesUsed: sources.length };
      }

      case 'install_font': {
        const fontPath = str(args.font_path, 'font_path');
        if (/^[a-z]+:\/\//i.test(fontPath)) {
          return { error: 'install_font needs a file already on this machine, not a URL — download it first and point me at the file' };
        }
        if (!path.isAbsolute(fontPath)) {
          return { error: 'install_font needs an absolute path to the font file' };
        }
        // word.installFont validates the extension (.ttf/.otf/.ttc) and existence.
        return word.installFont(fontPath);
      }

      case 'install_template': {
        const templatePath = str(args.template_path, 'template_path');
        if (/^[a-z]+:\/\//i.test(templatePath) || !path.isAbsolute(templatePath)) {
          return { error: 'install_template needs an absolute path to a .dotx/.dotm file already on this machine' };
        }
        const chapter = typeof args.chapter === 'string' && args.chapter.trim() ? args.chapter : null;
        let backedUp = false;
        if (chapter) backedUp = guardEdit(chapter);
        const r = await word.installTemplate(templatePath, chapter ? { chapterPath: chapterPath(root, chapter) } : {});
        return { ...r, ...(chapter ? { backedUp } : {}) };
      }

      case 'set_global_option': {
        const option = str(args.option, 'option');
        const value = args.value === 'false' ? 'false' : 'true';
        if (!isAllowedOption(option)) {
          return { error: `set_global_option only allows: check_spelling, check_grammar, smart_quotes (got "${option}")` };
        }
        const current = await word.getWordOption(option);
        if (current === value) {
          return { needsConsent: false, option, value, current, note: `Word's "${option}" is already ${value} — no change needed.` };
        }
        // Consent is required (§3 gate #5): return the request, do NOT apply.
        return {
          needsConsent: true,
          option,
          value,
          current,
          message: `Changing "${option}" affects every document you open in Word. Approve this in the Agent panel to apply it; every applied change is logged and can be reverted.`,
        };
      }

      default:
        log.warn('unknown tool', { name });
        return { error: `unknown tool: ${name}` };
    }
  };

  return { dispatch, ledger };
}
