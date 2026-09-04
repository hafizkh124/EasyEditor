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
import { saveTranscript, transcriptPathFor } from './adapters/transcribe.js';
import { readAssetText, registerChapter } from '../fs/projectFolder.js';
import { formatScholarlyRef } from '../../shared/research/citationTypes.js';
import { buildApparatus, apparatusTable } from '../../shared/research/apparatus.js';
import { resolveTrim, PRINT_LAYOUT_LOSS } from '../../shared/print/trimSizes.js';
import { buildIndexExtractionInstruction, parseIndexEntries, INDEX_KINDS, type IndexKind } from '../../shared/ai/prompts/indexEntries.js';
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
  /**
   * Decodes + transcribes an in-project recording via the renderer's Whisper
   * pipeline (M9 Phase 5). Absent in a headless context — `transcribe_media`
   * then returns a clear message.
   */
  transcribeMedia?: ((mediaPath: string, lang: string) => Promise<{ segments?: Array<{ start: number; end: number; text: string }>; error?: string }>) | null;
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
  const transcribeMedia = session.transcribeMedia ?? null;
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

      case 'transcribe_media': {
        const mediaPath = str(args.media_path, 'media_path');
        const lang = typeof args.lang === 'string' && args.lang.trim() ? args.lang : 'auto';
        if (!transcribeMedia) {
          return { error: 'transcribe_media is only available from the Agent panel (it uses the local Whisper engine there).' };
        }
        const artifactId = `transcript-${Date.now().toString(36)}`;
        emitArtifact({ op: 'open', artifactId, title: `Transcript — ${mediaPath.split('/').pop()}`, artifactType: 'transcript' });
        const r = await transcribeMedia(mediaPath, lang);
        if (r.error) {
          emitArtifact({ op: 'close', artifactId, status: 'aborted' });
          return { error: r.error };
        }
        const segments = r.segments ?? [];
        if (segments.length === 0) {
          emitArtifact({ op: 'close', artifactId, status: 'aborted' });
          return { count: 0, note: 'The recording produced no speech — check that it has an audio track.' };
        }
        // The transcript is a project write, so it is undoable with the task.
        guardWrite(transcriptPathFor(mediaPath));
        const out = saveTranscript(root, mediaPath, segments);
        emitArtifact({ op: 'delta', artifactId, mode: 'replace', text: out.text });
        emitArtifact({ op: 'close', artifactId, status: 'final' });
        return {
          transcriptPath: out.transcriptPath,
          segments: out.segments,
          durationSeconds: out.durationSeconds,
          preview: capResult(out.text.slice(0, 1500)),
          note: `Saved to ${out.transcriptPath}. Pass that path to create_chapter's from_source — do not paste the transcript back through a tool call.`,
        };
      }

      case 'create_chapter': {
        const name = str(args.name, 'name');
        const title = typeof args.title === 'string' ? args.title.trim() : '';
        const fromSource = typeof args.from_source === 'string' && args.from_source.trim() ? args.from_source.trim() : null;
        const rawHtml = typeof args.html === 'string' ? args.html : '';

        let body = rawHtml;
        if (fromSource) {
          let text: string;
          try { text = readAssetText(root, fromSource); }
          catch (err) { return { error: `could not read from_source "${fromSource}": ${(err as Error).message}` }; }
          body = text
            .split(/\n{2,}|\r?\n/)
            .map((p) => p.trim())
            .filter(Boolean)
            .map((p) => `<p>${p.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))}</p>`)
            .join('\n');
        }
        const html = (title ? `<h1>${title}</h1>\n` : '') + body;

        // guardWrite BEFORE the file exists, so the checkpoint records it as new
        // and "Undo this task" deletes it (M9 defect note).
        const backedUp = guardEdit(name);
        const dest = chapterPath(root, name);
        const r = await word.createChapter(dest, { html: html || undefined, rtl: true });
        let registered = false;
        try { registerChapter(root, name); registered = true; } catch (err) { log.warn('registerChapter failed', { name, message: (err as Error).message }); }
        return { chapter: name, outputPath: r.outputPath, seededFrom: fromSource ?? (rawHtml ? 'html' : 'blank'), registered, backedUp };
      }

      case 'typeset_print_ready': {
        const chapter = str(args.chapter, 'chapter');
        const trim = str(args.trim, 'trim');
        const size = resolveTrim(
          trim,
          typeof args.trim_width_cm === 'number' ? args.trim_width_cm : undefined,
          typeof args.trim_height_cm === 'number' ? args.trim_height_cm : undefined,
        );
        if (!size) {
          return { error: `unknown trim "${trim}" — one of: a5, b5, 6x9, waziri, digest, or custom with trim_width_cm + trim_height_cm` };
        }
        const backedUp = guardEdit(chapter);
        const r = await word.setPrintLayout(chapterPath(root, chapter), {
          trimWidthCm: size.w,
          trimHeightCm: size.h,
          gutterCm: typeof args.gutter_cm === 'number' ? args.gutter_cm : 1.2,
          mirrorMargins: args.mirror_margins !== false,
          oddEvenHeaders: args.odd_even_headers !== false,
          differentFirstPage: true,
          startRecto: Boolean(args.start_recto),
          headerOdd: typeof args.header_odd === 'string' ? args.header_odd : undefined,
          headerEven: typeof args.header_even === 'string' ? args.header_even : undefined,
        });
        const cm = 28.3464567;
        return {
          chapter,
          trim: size.label,
          pageSizeCm: { width: +(r.pageWidth / cm).toFixed(2), height: +(r.pageHeight / cm).toFixed(2), gutter: +(r.gutter / cm).toFixed(2) },
          backedUp,
          loss: PRINT_LAYOUT_LOSS,
          note: `Applied the ${size.label} layout. Export the PDF with convert_document(to:"pdf"). Review it before sending to a press — see the loss list.`,
        };
      }

      case 'compare_manuscript_variants': {
        const baseChapter = str(args.base_chapter, 'base_chapter');
        const witnessChapter = str(args.witness_chapter, 'witness_chapter');
        const siglum = typeof args.siglum === 'string' && args.siglum.trim() ? args.siglum.trim() : 'ب';
        const r = await word.compareManuscripts(chapterPath(root, baseChapter), chapterPath(root, witnessChapter));
        const loci = buildApparatus(r.revisions);
        const artifactId = `apparatus-${Date.now().toString(36)}`;
        emitArtifact({ op: 'open', artifactId, title: `فروق النسخ — ${baseChapter} / ${witnessChapter}`, artifactType: 'comparison' });
        const tbl = apparatusTable(loci, siglum);
        emitArtifact({ op: 'table', artifactId, columns: tbl.columns, rows: tbl.rows, caption: `${loci.length} موضع اختلاف` });
        emitArtifact({ op: 'close', artifactId, status: 'final' });
        return {
          count: loci.length,
          base: baseChapter,
          witness: witnessChapter,
          siglum,
          loci: loci.slice(0, 40).map((l) => ({ index: l.index, page: l.page, base: l.base, witness: l.witness, kind: l.kind, context: l.context.slice(0, 100) })),
          note: loci.length === 0 ? 'The two witnesses are identical.' : `${loci.length} loci. Act on each with insert_footnote (a فروق النسخ note) or add_document_comment.`,
        };
      }

      case 'build_scholarly_indexes': {
        const chapter = str(args.chapter, 'chapter');
        const kindsIn = Array.isArray(args.kinds) ? args.kinds.filter((k): k is string => typeof k === 'string') : [];
        const kinds = kindsIn.filter((k): k is IndexKind => (INDEX_KINDS as string[]).includes(k));
        if (kinds.length === 0) return { error: `build_scholarly_indexes needs at least one of: ${INDEX_KINDS.join(', ')}` };

        // Pre-built entries ("find||entry"), or extract them from the chapter.
        let entries: Array<{ find: string; entry: string }> = [];
        if (Array.isArray(args.entries) && args.entries.length) {
          entries = (args.entries as unknown[])
            .filter((s): s is string => typeof s === 'string' && s.includes('||'))
            .map((s) => { const [find, entry] = s.split('||'); return { find: find.trim(), entry: entry.trim() }; })
            .filter((e) => e.find && e.entry);
        } else {
          let text = '';
          try { text = await chapterText(chapter); } catch { /* fall through to the empty check */ }
          if (!text.trim()) return { error: `chapter "${chapter}" has no text to index` };
          const raw = (await generateContentStream({
            prompt: `CHAPTER TEXT:\n${text.slice(0, 12000)}`,
            systemInstruction: buildIndexExtractionInstruction(kinds),
          })).trim();
          entries = parseIndexEntries(raw);
        }
        if (entries.length === 0) return { count: 0, note: 'No index entries could be extracted for those kinds — the chapter may not mention them substantively.' };

        const artifactId = `index-${Date.now().toString(36)}`;
        emitArtifact({ op: 'open', artifactId, title: `فہارس — ${chapter}`, artifactType: 'index' });
        emitArtifact({ op: 'table', artifactId, columns: ['المدخل', 'يُوجد عند'], rows: entries.slice(0, 60).map((e) => [e.entry, e.find]) });

        const heading = typeof args.heading === 'string' && args.heading.trim() ? args.heading.trim() : undefined;
        const backedUp = guardEdit(chapter);
        const res = await word.buildIndexes(chapterPath(root, chapter), entries, { heading });
        emitArtifact({ op: 'close', artifactId, status: 'final', targetChapter: chapter });
        return { chapter, kinds, entryCount: entries.length, marked: res.marked, backedUp };
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
