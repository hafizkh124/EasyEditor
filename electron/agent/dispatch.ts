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
import * as excel from '../adapters/excel.js';
import { isAllowedOption } from './globalOptions.js';
import { chapterPath, backupChapter, refreshChapters } from '../fs/projectFolder.js';
import { getWorkspaceDbService } from '../ipc/workspaceHandlers.js';
import {
  routeShamelaSearch,
  routeShamelaReadPage,
  routeShamelaFindBook,
  type RouteOpts,
} from './adapters/shamelaRouter.js';
import { generateAgentText } from './modelRouter.js';
import { RetrievalLedger, assertClaimSupported, type RetrievedChunk, type ClaimCheckFn } from '../../shared/agent/grounding.js';
import { summariseCapabilities } from '../../shared/agent/capabilities.js';
import { runAgentLoop } from '../../shared/agent/loop.js';
import { buildResearchSubagentPrompt } from '../../shared/agent/systemPrompt.js';
import { AGENT_TOOLS } from '../../shared/agent/toolSchemas.js';
import { runCritique } from './critic.js';
import type { CritiqueKind } from '../../shared/ai/prompts/critique.js';
import type { ModelFn } from '../../shared/agent/types.js';
import { resolveTaskSlug, taskOutputIsHtml, RUN_TASK_NAMES } from '../../shared/agent/textTasks.js';
import { getRefineTextPrompt } from '../../shared/ai/prompts/refineText.js';
import { withAuthorVoice, VOICE_SHAPED_TASKS, AUTHOR_VOICE_FILES, AUTHOR_VOICE_PROPOSAL_FILE } from '../../shared/agent/authorVoice.js';
import { AUTHOR_VOICE_EXTRACT_INSTRUCTION } from '../../shared/ai/prompts/authorVoiceExtract.js';
import { AI_DISCLOSURE_FILE, buildDisclosureStatement } from '../../shared/agent/disclosure.js';
import { readDisclosureEntries } from './disclosure.js';
import { recordWrite } from './checkpoint.js';
import { getDraftMode, buildDraftInput, type DraftMode } from '../../shared/ai/prompts/draftSection.js';
import { buildFatwaHtml, resolveResultTable, resolveDisclaimer } from '../../shared/print/fatwaTemplate.js';
import { queryTafseer, type TafseerMode } from './adapters/tafsir.js';
import { saveTranscript, transcriptPathFor } from './adapters/transcribe.js';
import { saveOcrText, ocrTextPathFor } from './adapters/ocr.js';
import { readAssetText, writeAssetText, registerChapter } from '../fs/projectFolder.js';
import { formatScholarlyRef } from '../../shared/research/citationTypes.js';
import { buildApparatus, apparatusTable } from '../../shared/research/apparatus.js';
import { resolveTrim, PRINT_LAYOUT_LOSS } from '../../shared/print/trimSizes.js';
import { resolveLayoutPreset, LAYOUT_PRESET_IDS } from '../../shared/print/layoutPresets.js';
import { searchRepositories, type RepositoryQuery } from './adapters/repositories.js';
import { gradeHadith } from './adapters/dorar.js';
import * as jkhssnAdapter from './adapters/jkhssn.js';
import { buildRijalQuery, type NarratorAspect } from '../../shared/agent/rijalQuery.js';
import { buildLexiconQuery, almaanyUrl } from '../../shared/agent/lexiconQuery.js';
import { printedPageCitation } from './adapters/lexicon.js';
import { searchPersianPoetry } from './adapters/ganjoor.js';
import { scanUrduProsody, lookupUrduVerse } from './adapters/urduProsody.js';
import { calculateZakat } from '../../shared/zakat/calculator.js';
import type { ZakatInput } from '../../shared/zakat/types.js';
import { calculateFaraid, type FaraidInput } from '../../shared/faraid/calculator.js';
import { buildIndexExtractionInstruction, parseIndexEntries, INDEX_KINDS, type IndexKind } from '../../shared/ai/prompts/indexEntries.js';
import type { DispatchFn, EmitArtifactFn } from '../../shared/agent/types.js';
import type { GeneralSearchResult } from './generalSearch.js';
import type { ResearchMode, ResearchResult, ResearchFilter } from './researchBridge.js';

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
  /**
   * Absolute path to the open project folder, or `null` — Ask mode may run
   * with nothing open (M11). Plan/Auto always have one (gated upstream,
   * useAgentRun.ts's `send()`), so every write-tool case below may treat
   * `root` as present; only the read-tool cases that touch chapters
   * (`read_document`, `search_corpus`, `check_consistency`,
   * `compare_manuscript_variants`) check `hasRoot` explicitly.
   */
  projectRoot: string | null;
  /** Task checkpoint id — every edit is snapshotted under it (ADR-0019 item 5). */
  checkpointId?: string;
  /**
   * Contents of the project's طرز_تحریر.md (author voice, M9 Phase A), read
   * from the root by run.ts. Appended to draft_section's mode template and to
   * a voice-shaped run_task prompt so generated prose matches the scholar's
   * hand. Null / absent ⇒ generation runs on the fixed template alone.
   */
  authorVoice?: string | null;
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
  researchSearch?: ((mode: ResearchMode, query: string, filter?: ResearchFilter) => Promise<ResearchResult>) | null;
  /**
   * M11 — source/domain narrowing + the Arabic-matn requirement, set once
   * from the composer's `SourcePicker` state (`run.ts`, from `AgentScope`).
   * Only `search_hadith` applies it — the other `researchSearch('islamic', …)`
   * callers here (lookup_lexicon, lookup_narrator, grade_hadith) target one
   * specific entity, not a topical corpus search, so narrowing by domain
   * doesn't apply to them.
   */
  researchFilter?: ResearchFilter | null;
  /**
   * Decodes + transcribes an in-project recording via the renderer's Whisper
   * pipeline (M9 Phase 5). Absent in a headless context — `transcribe_media`
   * then returns a clear message.
   */
  transcribeMedia?: ((mediaPath: string, lang: string) => Promise<{ segments?: Array<{ start: number; end: number; text: string }>; error?: string }>) | null;
  /**
   * Consent-gated cloud OCR of an in-project scan via the renderer (M9 Phase 7,
   * ADR-0023). `ocrConsent` is the scholar's per-project approval, read from the
   * manifest by `run.ts`; when it is false `ocr_document` returns a consent
   * request and `ocrDocument` is never called. Absent in a headless context.
   */
  ocrConsent?: boolean;
  ocrDocument?: ((scanPath: string, lang: string, pages?: string) => Promise<{ pages?: Array<{ page: number; text: string }>; error?: string }>) | null;
  /** Emits a live artifact event (M9 ADR-0024). No-op when absent. */
  emitArtifact?: EmitArtifactFn | null;
  /**
   * Runs a whole playbook nested inside the free loop (`run_playbook` tool,
   * M9 ADR-0020). Set by `run.ts` after the dispatcher exists. Absent ⇒ the
   * tool returns a clear message.
   */
  runPlaybookRef?: ((ref: string, chapter?: string) => Promise<unknown>) | null;
  /**
   * The active provider's ModelFn (M9 Phase E) — drives the bounded research
   * SUB-RUN (`research_topic`). Absent in a headless context ⇒ the tool
   * returns a clear message.
   */
  model?: ModelFn | null;
  /** Resolves true to abort — passed through to the research sub-run. */
  isCancelled?: (() => boolean) | null;
  /** M11 Phase 2 — progress callback forwarded to sub-runs (research_topic). */
  onProgress?: ((p: { step: number; label: string; labelKey?: string; kind: string; detail?: string }) => void) | null;
  /**
   * ADR-0044 — the two Shamela transports' merged connector state, set by
   * `run.ts`. Absent (headless / eval) ⇒ local on, cloud off.
   */
  shamelaLocalEnabled?: boolean;
  shamelaCloudEnabled?: boolean;
  /** ADR-0054 — the Turath.io classical library connector's merged state (absent ⇒ on). */
  turathEnabled?: boolean;
  /** ADR-0045 — the جوامع الكلم connector's merged state (absent ⇒ on). */
  jkhssnEnabled?: boolean;
  /** Phase 4 — book/author/category/century scope for search tools (refs like
   *  'shamela:1681' | 'jkhssn:55' | 'corpus:<uuid>'). Absent ⇒ unscoped. */
  bookScope?: string[];
}

/** ADR-0044 / ADR-0054 — the local-first router's options for this run. */
function shamelaRouteOpts(session: AgentSession): RouteOpts {
  return {
    localEnabled: session.shamelaLocalEnabled !== false,
    cloudEnabled: session.shamelaCloudEnabled === true,
    turathEnabled: session.turathEnabled !== false,
  };
}

export interface Dispatcher {
  dispatch: DispatchFn;
  ledger: RetrievalLedger;
}

export function createDispatcher(session: AgentSession): Dispatcher {
  const ledger = new RetrievalLedger();
  // `root` is asserted non-null: every consumer below except the four
  // `hasRoot`-guarded read cases is a write-tool case, which is
  // structurally unreachable with no project open (see AgentSession.projectRoot's
  // doc comment). `hasRoot` is the real (nullable-aware) check those four use.
  const hasRoot = session.projectRoot !== null;
  const root = session.projectRoot as string;
  const checkpointId = session.checkpointId;
  const claimCheck = session.claimCheck ?? null;
  const authorVoice = session.authorVoice ?? null;
  const subModel = session.model ?? null;

  /** Read-only tools the research sub-run may use (never itself — no recursion). */
  const RESEARCH_SUBAGENT_TOOLS = new Set([
    'search_corpus', 'search_shamela', 'read_shamela_page', 'find_shamela_book', 'query_tafseer', 'search_hadith',
    'grade_hadith', 'lookup_narrator', 'lookup_lexicon', 'search_persian_poetry', 'lookup_urdu_verse',
    'search_general', 'search_repositories',
    'jkhssn_narrator', 'jkhssn_sanad_tree', 'jkhssn_takhrij', 'jkhssn_judgments', 'jkhssn_thematic',
  ]);
  const generalSearch = session.generalSearch ?? null;
  const researchFilter = session.researchFilter ?? undefined;
  const researchSearch = session.researchSearch ?? null;
  const transcribeMedia = session.transcribeMedia ?? null;
  const ocrDocument = session.ocrDocument ?? null;
  const ocrConsent = session.ocrConsent === true;
  const emitArtifact: EmitArtifactFn = (ev) => { try { session.emitArtifact?.(ev); } catch { /* non-fatal */ } };

  // Plan §4.5 — a `#` scope splits into three id spaces the search tools filter by.
  const scopeRefs = session.bookScope ?? [];
  const scopedShamelaIds = scopeRefs.filter((r) => r.startsWith('shamela:')).map((r) => Number(r.slice(8))).filter(Number.isFinite);
  const scopedCorpusIds = scopeRefs.filter((r) => r.startsWith('corpus:')).map((r) => r.slice(7)).filter(Boolean);
  const scopedJkhssnIds = scopeRefs.filter((r) => r.startsWith('jkhssn:')).map((r) => Number(r.slice(7))).filter(Number.isFinite);

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
        if (!hasRoot) return { error: 'No project folder is open — open one to read a chapter.' };
        const chapter = str(args.chapter, 'chapter');
        return word.readStructure(chapterPath(root, chapter));
      }

      case 'search_corpus': {
        const query = str(args.query, 'query');
        const limit = Math.min(num(args.limit, 8), 12); // ADR-0027 F4 — hard cap

        // (a) the imported personal corpus (FTS over library chunks)
        const svc = await getWorkspaceDbService();
        let hits: Awaited<ReturnType<typeof svc.searchChunks>> = [];
        const corpusOpts = scopedCorpusIds.length ? [{ libraryItemIds: scopedCorpusIds }] as const : [] as const;
        try {
          hits = await svc.searchChunks(query, limit, ...corpusOpts);
        } catch (err) { log.warn('corpus FTS failed', { message: (err as Error).message }); }
        const chunks: RetrievedChunk[] = hits.map((h) => ({
          id: `corpus:${h.itemId}:${h.pageNumber ?? 0}`,
          reference: h.pageNumber ? `${h.title}, p. ${h.pageNumber}` : h.title,
          content: h.content,
        }));

        // (b) the open project folder's OWN chapters — a lexical scan, so the
        // agent can answer questions about the document even before anything
        // has been imported into the corpus DB. Skipped with nothing open
        // (Ask mode may run that way, M11) — (a) above still runs.
        if (hasRoot) {
          for (const name of refreshChapters(root).map((c) => c.name)) {
            const text = await chapterText(name).catch(() => '');
            const idx = text.toLowerCase().indexOf(query.toLowerCase());
            if (idx === -1) continue;
            const excerpt = text.slice(Math.max(0, idx - 120), idx + query.length + 280).replace(/\s+/g, ' ').trim();
            chunks.push({ id: `chapter:${name}`, reference: name, content: excerpt });
          }
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
        const r = await routeShamelaSearch(query, limit, shamelaRouteOpts(session), scopedShamelaIds.length ? scopedShamelaIds : undefined);
        if (r.transport === 'none' && r.error) return { error: r.error, transport: 'none' };
        const prefix = r.transport === 'turath' ? 'turath' : r.transport === 'cloud' ? 'shamela-cloud' : 'shamela';
        const chunks: RetrievedChunk[] = r.hits.map((h) => ({
          id: `${prefix}:${h.bookId}:${h.pageNumber}`,
          // Turath addresses pages by a sequential index, but a scholar cites the
          // PRINTED volume/page — which the router result carries as `pageLabel`.
          reference: `${h.bookTitle || (prefix === 'turath' ? 'تراث' : 'الشاملة')}، ${(h as { pageLabel?: string }).pageLabel ?? `ص ${h.pageNumber}`}`,
          content: h.snippet,
          ...(r.transport === 'cloud' && !Number(h.bookId) ? { bibliographic: true } : {}),
        }));
        ledger.add(chunks);
        return {
          count: chunks.length,
          transport: r.transport,        // non-model-facing — read by connectorsUsed (ADR-0044)
          note: r.note,
          results: chunks.map((c) => ({ id: c.id, reference: c.reference, excerpt: (c.content ?? '').slice(0, 350) })),
        };
      }

      case 'read_shamela_page': {
        const sid = str(args.source_id, 'source_id');
        const m = /^(shamela(?:-cloud)?|turath):([^:]+):(\d+)$/.exec(sid);
        if (!m) return { error: 'read_shamela_page needs a shamela:<bookId>:<page> or turath:<bookId>:<page> id from search_shamela' };
        const [, pfx, bookId, pageStr] = m;
        const r = await routeShamelaReadPage(bookId, Number(pageStr), {
          ...shamelaRouteOpts(session),
          preferTransport: pfx === 'turath' ? 'turath' : pfx === 'shamela-cloud' ? 'cloud' : 'local',
        });
        if (!r.page) return { error: r.error ?? 'could not read the page', transport: r.transport };
        ledger.add([{ id: sid, reference: `${pfx === 'turath' ? 'تراث' : 'الشاملة'}، ${(r.page as { pageLabel?: string }).pageLabel ?? `ص ${r.page.pageNumber}`}`, content: r.page.text }]);
        return {
          transport: r.transport,
          bookId,
          page: r.page.pageNumber,
          text: capResult(r.page.text),
          footnotes: r.page.footnotes ? capResult(r.page.footnotes) : undefined,
        };
      }

      case 'find_shamela_book': {
        const query = str(args.query, 'query');
        const r = await routeShamelaFindBook(query, shamelaRouteOpts(session));
        if (r.transport === 'none' && r.error) return { error: r.error, transport: 'none' };
        return {
          transport: r.transport,
          note: r.books.length === 0 ? (r.note ?? 'No matching Shamela book or author.') : r.note,
          books: r.books.slice(0, 15),
        };
      }

      case 'insert_footnote': {
        const chapter = str(args.chapter, 'chapter');
        const marker = str(args.marker, 'marker');
        const chunk = ledger.resolveOrThrow(args.source_id); // tier 1: integrity gate
        // ADR-0028: a Tier-2 repository hit names a WORK the agent has not read.
        // It may be cited, but never with a `claim` — that would assert what a
        // page of it says.
        if (chunk.bibliographic && typeof args.claim === 'string' && args.claim.trim()) {
          throw new Error('insert_footnote: this is a bibliographic reference to a work you have not read — cite it WITHOUT a `claim`. To support a specific claim, find the passage in search_shamela or search_corpus.');
        }
        const verdict = await assertClaimSupported(args.claim, chunk.content, claimCheck); // tier 2: claim check
        const dest = chapterPath(root, chapter);
        const backedUp = guardEdit(chapter);
        const res = await word.applyCitations(
          { sourcePath: dest },
          [{ marker, text: ledger.footnoteText(chunk) }],
          dest,
          { trackChanges: true },
        );

        // Surface the source behind this footnote so the scholar can read the
        // actual passage BEFORE accepting the tracked change in Word (blueprint
        // §3 — "one-click open source passage").
        if (res.applied > 0) {
          const excerpt = (chunk.content ?? '').trim();
          const supported = args.claim && typeof args.claim === 'string' && args.claim.trim()
            ? (verdict ? verdict.supports : undefined)
            : undefined;
          const artifactId = `footnote-${chapter}-${Date.now().toString(36)}`;
          emitArtifact({ op: 'open', artifactId, title: `حاشیہ ${marker} — ${chapter}`, artifactType: 'citation-list' });
          emitArtifact({
            op: 'citations', artifactId,
            entries: [{
              marker,
              reference: chunk.reference,
              sourceId: typeof args.source_id === 'string' ? args.source_id : '',
              supported,
              url: chunk.source_url ?? undefined,
              tier: chunk.bibliographic ? 2 : 1,
              excerpt: excerpt || undefined,
              claim: typeof args.claim === 'string' && args.claim.trim() ? args.claim.trim() : undefined,
            }],
          });
          emitArtifact({ op: 'close', artifactId, status: 'final', targetChapter: chapter });
        }

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

      case 'ocr_document': {
        const scanPath = str(args.scan_path, 'scan_path');
        const lang = typeof args.lang === 'string' && args.lang.trim() ? args.lang : 'auto';
        const pages = typeof args.pages === 'string' && args.pages.trim() ? args.pages.trim() : undefined;

        // Consent gate (ADR-0023 / SPEC-M8 §3 gate #5 shape): the first call for
        // a project returns a request and uploads NOTHING. The scholar approves
        // it in the Agent panel; a re-run then proceeds.
        if (!ocrConsent) {
          return {
            needsConsent: true,
            scanPath,
            message: `OCR sends the page images of "${scanPath.split('/').pop()}" to the EasyEditor cloud OCR service — this is not a local reading. Approve OCR for this project in the Agent panel, then run this again. Nothing has been uploaded.`,
          };
        }
        if (!ocrDocument) {
          return { error: 'ocr_document is only available from the Agent panel (it renders and uploads the pages from there).' };
        }

        const artifactId = `ocr-${Date.now().toString(36)}`;
        emitArtifact({ op: 'open', artifactId, title: `OCR — ${scanPath.split('/').pop()}`, artifactType: 'document' });
        const r = await ocrDocument(scanPath, lang, pages);
        if (r.error) {
          emitArtifact({ op: 'close', artifactId, status: 'aborted' });
          return { error: r.error };
        }
        const ocrPages = (r.pages ?? []).filter((p) => p && typeof p.text === 'string');
        if (ocrPages.length === 0) {
          emitArtifact({ op: 'close', artifactId, status: 'aborted' });
          return { pageCount: 0, note: 'The OCR service read no text from that scan — check the pages are legible and right-side up.' };
        }
        // The .ocr.txt is a project write, so it is undoable with the task.
        guardWrite(ocrTextPathFor(scanPath));
        const out = saveOcrText(root, scanPath, ocrPages);
        emitArtifact({ op: 'delta', artifactId, mode: 'replace', text: out.text });
        emitArtifact({ op: 'close', artifactId, status: 'final' });
        return {
          ocrPath: out.ocrPath,
          pageCount: out.pageCount,
          preview: capResult(out.text.slice(0, 1500)),
          note: `Saved to ${out.ocrPath}. This is an unverified machine reading. Pass that path to create_chapter's from_source with a title like "[OCR — غير مدقّق]", and tell the scholar to proofread every page against the scan. Do not cite from it.`,
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

        // M12 Phase E (ADR-0050) — `preset` bundles trim + margins + gutter +
        // line spacing + header in one named choice (layoutPresets.ts, wired
        // in here for the first time — it shipped in M11 Phase 4 but nothing
        // ever called it). `trim` still works alone for a bare trim size.
        const presetId = typeof args.preset === 'string' ? args.preset : undefined;
        const preset = presetId ? resolveLayoutPreset(presetId) : undefined;
        if (presetId && !preset) {
          return { error: `unknown layout preset "${presetId}" — one of: ${LAYOUT_PRESET_IDS.join(', ')}` };
        }
        const size = preset
          ? { w: preset.trimWidthCm, h: preset.trimHeightCm, label: preset.label }
          : resolveTrim(
              str(args.trim, 'trim'),
              typeof args.trim_width_cm === 'number' ? args.trim_width_cm : undefined,
              typeof args.trim_height_cm === 'number' ? args.trim_height_cm : undefined,
            );
        if (!size) {
          return { error: 'unknown trim — one of: a5, b5, 6x9, waziri, digest, or custom with trim_width_cm + trim_height_cm (or pass "preset" instead of "trim")' };
        }
        const backedUp = guardEdit(chapter);
        const r = await word.setPrintLayout(chapterPath(root, chapter), {
          trimWidthCm: size.w,
          trimHeightCm: size.h,
          gutterCm: typeof args.gutter_cm === 'number' ? args.gutter_cm : (preset?.gutterCm ?? 1.2),
          mirrorMargins: typeof args.mirror_margins === 'boolean' ? args.mirror_margins : (preset?.mirrorMargins ?? true),
          oddEvenHeaders: args.odd_even_headers !== false,
          differentFirstPage: true,
          startRecto: Boolean(args.start_recto),
          headerOdd: typeof args.header_odd === 'string' ? args.header_odd : preset?.headerOdd,
          headerEven: typeof args.header_even === 'string' ? args.header_even : preset?.headerEven,
          marginTopCm: typeof args.margin_top_cm === 'number' ? args.margin_top_cm : preset?.marginTopCm,
          marginBottomCm: typeof args.margin_bottom_cm === 'number' ? args.margin_bottom_cm : preset?.marginBottomCm,
          marginLeftCm: typeof args.margin_left_cm === 'number' ? args.margin_left_cm : preset?.marginLeftCm,
          marginRightCm: typeof args.margin_right_cm === 'number' ? args.margin_right_cm : preset?.marginRightCm,
          lineSpacingPt: typeof args.line_spacing_pt === 'number' ? args.line_spacing_pt : preset?.lineSpacingPt,
        });
        const cm = 28.3464567;
        return {
          chapter,
          trim: size.label,
          preset: preset?.id,
          pageSizeCm: { width: +(r.pageWidth / cm).toFixed(2), height: +(r.pageHeight / cm).toFixed(2), gutter: +(r.gutter / cm).toFixed(2) },
          backedUp,
          loss: PRINT_LAYOUT_LOSS,
          note: `Applied the ${size.label} layout. Export the PDF with convert_document(to:"pdf"). Review it before sending to a press — see the loss list.`,
        };
      }

      case 'compare_manuscript_variants': {
        if (!hasRoot) return { error: 'No project folder is open — open one to compare chapters.' };
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
          const raw = (await generateAgentText({
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
        if (!hasRoot) return { term, appearsIn: [], suggestion: 'No project folder is open.' };
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
        const wordNo = typeof args.word_no === 'number' ? args.word_no : undefined;
        const r = await queryTafseer({ reference, mode, sources, query: q, word_no: wordNo });
        if (r.error) return { error: r.error };
        ledger.add(r.chunks);
        if (r.chunks.length) {
          const artifactId = `tafsir-${Date.now().toString(36)}`;
          emitArtifact({ op: 'open', artifactId, title: r.chunks[0].reference, artifactType: 'document' });
          emitArtifact({ op: 'delta', artifactId, mode: 'replace', text: r.text });
          emitArtifact({ op: 'citations', artifactId, entries: r.chunks.map((c, i) => ({ marker: String(i + 1), reference: c.reference, sourceId: c.id, supported: true, tier: 1, excerpt: (c.content ?? '').slice(0, 500) || undefined })) });
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
        const r = await researchSearch('islamic', query, researchFilter);
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

      case 'search_persian_poetry': {
        const query = str(args.query, 'query');
        const poet = typeof args.poet === 'string' ? args.poet : undefined;
        const r = await searchPersianPoetry({ query, poet });
        if (r.error) return { error: r.error };
        ledger.add(r.chunks);
        if (r.chunks.length) {
          const artifactId = `persian-${Date.now().toString(36)}`;
          emitArtifact({ op: 'open', artifactId, title: `شعر فارسی: ${query.slice(0, 40)}`, artifactType: 'citation-list' });
          emitArtifact({ op: 'citations', artifactId, entries: r.chunks.map((c, i) => ({ marker: String(i + 1), reference: c.reference, sourceId: c.id, supported: true, url: c.source_url ?? undefined, tier: 1, excerpt: (c.content ?? '').slice(0, 400) || undefined })) });
          emitArtifact({ op: 'close', artifactId, status: 'final' });
        }
        return {
          count: r.chunks.length,
          note: r.note,
          results: r.chunks.map((c) => ({ id: c.id, reference: c.reference, url: c.source_url ?? undefined, excerpt: (c.content ?? '').slice(0, 300) })),
        };
      }

      case 'scan_urdu_prosody': {
        const text = str(args.text, 'text');
        const scan = scanUrduProsody(text);
        const artifactId = `prosody-${Date.now().toString(36)}`;
        emitArtifact({ op: 'open', artifactId, title: `تقطیع: ${text.slice(0, 30)}…`, artifactType: 'table' });
        emitArtifact({
          op: 'table', artifactId,
          columns: ['مصرع', 'تقطیع', 'بحر (تخمینہ)', 'اعتماد'],
          rows: scan.lines.map((l) => [l.input, l.pattern || '—', l.bahr ?? '—', l.confidence]),
          caption: scan.note,
        });
        emitArtifact({ op: 'close', artifactId, status: 'final' });
        return {
          note: scan.note,
          lines: scan.lines.map((l) => ({
            line: l.input, pattern: l.pattern, feet: l.feet, bahr: l.bahr, confidence: l.confidence,
          })),
        };
      }

      case 'lookup_urdu_verse': {
        const query = str(args.query, 'query');
        const r = await lookupUrduVerse(query);
        if (r.error) return { error: r.error };
        ledger.add(r.chunks);
        if (r.chunks.length) {
          const artifactId = `urdu-${Date.now().toString(36)}`;
          emitArtifact({ op: 'open', artifactId, title: `شعر اردو: ${query.slice(0, 40)}`, artifactType: 'citation-list' });
          emitArtifact({ op: 'citations', artifactId, entries: r.chunks.map((c, i) => ({ marker: String(i + 1), reference: c.reference, sourceId: c.id, supported: true, tier: 1, excerpt: (c.content ?? '').slice(0, 400) || undefined })) });
          emitArtifact({ op: 'close', artifactId, status: 'final' });
        }
        return {
          count: r.chunks.length,
          note: r.note,
          results: r.chunks.map((c) => ({ id: c.id, reference: c.reference, excerpt: (c.content ?? '').slice(0, 300) })),
        };
      }

      case 'calculate_zakat': {
        // M12 Phase C — pure compute (ADR-0048): the model never does this
        // arithmetic, only supplies the JSON the scholar described.
        const raw = str(args.input, 'input');
        let parsed: ZakatInput;
        try { parsed = JSON.parse(raw) as ZakatInput; } catch {
          return { error: 'calculate_zakat: "input" درست JSON نہیں — ZakatInput کی شکل میں دیں۔' };
        }
        let result: ReturnType<typeof calculateZakat>;
        try { result = calculateZakat(parsed); } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
        const artifactId = `zakat-${Date.now().toString(36)}`;
        emitArtifact({ op: 'open', artifactId, title: 'حساب زکوٰۃ', artifactType: 'table' });
        emitArtifact({
          op: 'table', artifactId,
          columns: ['مد', 'رقم', 'قابلِ زکوٰۃ', 'دلیل'],
          rows: result.lines.map((l) => [l.label, String(l.value), String(l.zakatable), l.dalil]),
          caption: `نصاب: ${result.nisabThreshold} (${result.nisabStandardUsed === 'gold' ? 'سونا' : 'چاندی'}) — واجب الادا زکوٰۃ: ${result.zakatDue}${result.currency ? ` ${result.currency}` : ''}`,
        });
        emitArtifact({ op: 'close', artifactId, status: 'final' });
        return result;
      }

      case 'calculate_faraid': {
        // M12 Phase B/C — from-scratch Jumhūr fara'id engine, pure compute.
        const raw = str(args.input, 'input');
        let parsed: FaraidInput;
        try { parsed = JSON.parse(raw) as FaraidInput; } catch {
          return { error: 'calculate_faraid: "input" درست JSON نہیں — FaraidInput کی شکل میں دیں۔' };
        }
        let result: ReturnType<typeof calculateFaraid>;
        try { result = calculateFaraid(parsed); } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
        const artifactId = `faraid-${Date.now().toString(36)}`;
        emitArtifact({ op: 'open', artifactId, title: 'حساب فرائض', artifactType: 'table' });
        emitArtifact({
          op: 'table', artifactId,
          columns: ['وارث', 'تعداد', 'حصہ (کل)', 'فی کس', 'دلیل'],
          rows: result.lines.map((l) => [l.label, String(l.count), l.fraction, l.perPerson ?? l.fraction, l.dalil]),
          caption: `اصل المسئلہ: ${result.asl}${result.awlApplied ? ' (عول لاگو)' : ''}${result.raddApplied ? ' (رد لاگو)' : ''}`,
        });
        emitArtifact({ op: 'close', artifactId, status: 'final' });
        return result;
      }

      case 'lookup_lexicon': {
        const word = str(args.word, 'word');
        if (!researchSearch) {
          return { error: 'lookup_lexicon is only available from the Agent panel (it uses your signed-in research session).' };
        }
        const r = await researchSearch('islamic', buildLexiconQuery(word));
        const chunks: RetrievedChunk[] = [];
        if (!r.error) {
          for (const c of r.citations ?? []) {
            const ref = formatScholarlyRef(c.citation_ref, c.domain);
            if (!ref) continue;
            const key = c.citation_ref.hadith_number ?? c.citation_ref.page ?? chunks.length + 1;
            chunks.push({
              id: `${c.domain}:lex:${c.citation_ref.book ?? c.citation_ref.collection ?? 'x'}:${key}`,
              reference: ref,
              source_url: c.url ?? c.citation_ref.url ?? null,
            });
          }
        }
        // A printed-page citation ONLY when a real root→page index is bundled
        // (ADR-0043) — never a fabricated one.
        const printed = await printedPageCitation(word).catch(() => null);
        if (printed) chunks.push(printed);
        ledger.add(chunks);

        const almaany = almaanyUrl(word);
        const artifactId = `lexicon-${Date.now().toString(36)}`;
        emitArtifact({ op: 'open', artifactId, title: `لغت: ${word.slice(0, 40)}`, artifactType: 'citation-list' });
        emitArtifact({
          op: 'citations', artifactId,
          entries: [
            ...chunks.map((c, i) => ({ marker: String(i + 1), reference: c.reference, sourceId: c.id, supported: true, tier: 1 as const, url: c.source_url ?? undefined })),
            // al-Maany is a link to VERIFY, not a source we read — no ledger id.
            { marker: '↗', reference: 'المعاني (عربی–اردو) — رابط خارجي للتحقق', sourceId: 'almaany', url: almaany },
          ],
        });
        emitArtifact({ op: 'close', artifactId, status: 'final' });

        return {
          count: chunks.length,
          almaanyUrl: almaany,
          note: chunks.length === 0
            ? `No entry for «${word}» in the offline Arabic–Urdu lexical material. Open the al-Maany link to check: ${almaany}`
            : `Verify further at al-Maany: ${almaany}`,
          answer: r.error ? undefined : capResult((r.answer ?? '').trim()),
          results: chunks.map((c) => ({ id: c.id, reference: c.reference, url: c.source_url ?? undefined })),
        };
      }

      case 'lookup_narrator': {
        const nameArg = str(args.name, 'name');
        const aspect = (typeof args.aspect === 'string' ? args.aspect : 'biography') as NarratorAspect;
        if (!researchSearch) {
          return { error: 'lookup_narrator is only available from the Agent panel (it uses your signed-in research session).' };
        }
        const r = await researchSearch('islamic', buildRijalQuery(nameArg, aspect));
        if (r.error) return { error: r.error };
        const chunks: RetrievedChunk[] = [];
        for (const c of r.citations ?? []) {
          const ref = formatScholarlyRef(c.citation_ref, c.domain);
          if (!ref) continue;
          const key = c.citation_ref.hadith_number ?? c.citation_ref.page ?? chunks.length + 1;
          chunks.push({
            id: `${c.domain}:rijal:${c.citation_ref.book ?? c.citation_ref.collection ?? 'x'}:${key}`,
            reference: ref,
            source_url: c.url ?? c.citation_ref.url ?? null,
          });
        }
        ledger.add(chunks);
        if (chunks.length) {
          const artifactId = `rijal-${Date.now().toString(36)}`;
          emitArtifact({ op: 'open', artifactId, title: `ترجمہ راوی: ${nameArg.slice(0, 40)}`, artifactType: 'citation-list' });
          emitArtifact({ op: 'citations', artifactId, entries: chunks.map((c, i) => ({ marker: String(i + 1), reference: c.reference, sourceId: c.id, supported: true, url: c.source_url ?? undefined, tier: 1 })) });
          emitArtifact({ op: 'close', artifactId, status: 'final' });
        }
        return {
          count: chunks.length,
          note: chunks.length === 0
            ? 'The rijāl channel returned an answer but no page-precise citations to cite. Isnād-chain tracing is not available yet.'
            : undefined,
          answer: capResult((r.answer ?? '').trim()),
          results: chunks.map((c) => ({ id: c.id, reference: c.reference, url: c.source_url ?? undefined })),
        };
      }

      case 'grade_hadith': {
        const text = str(args.text, 'text');
        const limit = num(args.limit, 5);

        // dorar.net Cloudflare-hard-blocks many residential IPs (a bare 403 on
        // every path, headers don't help) — the direct in-process fetch (ADR-0040)
        // fails for those users. The signed-in research bridge reaches الدرر
        // السنية through the edge function's datacenter IP, which is not blocked.
        // Bridge first; the direct adapter is the fallback (headless, or an IP
        // that CAN reach dorar.net, and it also carries the matn text).
        const chunks: RetrievedChunk[] = [];
        let note: string | undefined;

        if (researchSearch) {
          try {
            const rb = await researchSearch('islamic', text);
            if (!rb.error) {
              for (const c of rb.citations ?? []) {
                if (c.domain !== 'dorar') continue;
                const ref = formatScholarlyRef(c.citation_ref, c.domain);
                if (!ref) continue;
                const key = c.citation_ref.hadith_number ?? chunks.length + 1;
                chunks.push({
                  id: `dorar:${c.citation_ref.collection ?? c.citation_ref.book ?? 'x'}:${key}`,
                  reference: `${ref} (الدرر السنية)`,
                  grade: c.citation_ref.grade,
                  source_url: c.url ?? c.citation_ref.url ?? null,
                  bibliographic: true, // the bridge carries the ref + الحكم, not the matn
                });
                if (chunks.length >= limit) break;
              }
            }
          } catch (err) {
            log.warn('grade_hadith bridge lookup failed, trying direct', { message: (err as Error).message });
          }
        }

        if (chunks.length === 0) {
          const direct = await gradeHadith({ text, limit });
          if (direct.error) {
            if (!researchSearch) return { error: direct.error };
            note = 'الدرر السنية could not be reached directly, and the research session returned no grading for that text — try search_hadith instead.';
          } else {
            chunks.push(...direct.chunks);
            note = direct.note;
          }
        }

        if (chunks.length === 0) {
          return { count: 0, note: note ?? 'الدرر السنية returned no grading for that text.' };
        }
        ledger.add(chunks);
        const artifactId = `grade-${Date.now().toString(36)}`;
        emitArtifact({ op: 'open', artifactId, title: `تخریج و درجہ: ${text.slice(0, 40)}`, artifactType: 'citation-list' });
        emitArtifact({
          op: 'citations', artifactId,
          entries: chunks.map((c, i) => ({
            marker: String(i + 1), reference: c.reference, sourceId: c.id,
            supported: true, tier: 1, grade: c.grade,
            excerpt: (c.content ?? '').slice(0, 400) || undefined,
          })),
        });
        emitArtifact({ op: 'close', artifactId, status: 'final' });
        return {
          count: chunks.length,
          note,
          results: chunks.map((c) => ({ id: c.id, reference: c.reference, grade: c.grade, excerpt: (c.content ?? '').slice(0, 400) })),
        };
      }

      case 'jkhssn_narrator': {
        if (session.jkhssnEnabled === false) return { error: 'جوامع الكلم کنیکٹر بند ہے۔' };
        const r = await jkhssnAdapter.jkhssnNarrator(
          { name: str(args.name, 'name'), aspect: typeof args.aspect === 'string' ? (args.aspect as never) : undefined },
          { researchSearch: researchSearch as never },
        );
        if (r.error) return { error: r.error };
        ledger.add(r.chunks);
        const artifactId = `jkhssn-narrator-${Date.now().toString(36)}`;
        emitArtifact({ op: 'open', artifactId, title: `راوی: ${str(args.name, 'name').slice(0, 40)}`, artifactType: 'narrator-card' });
        emitArtifact({ op: 'data', artifactId, payload: r.data });
        if (r.chunks.length) {
          emitArtifact({ op: 'citations', artifactId, entries: r.chunks.map((c, i) => ({ marker: String(i + 1), reference: c.reference, sourceId: c.id, supported: true, url: c.source_url ?? undefined, tier: 1 })) });
        }
        emitArtifact({ op: 'close', artifactId, status: 'final' });
        return { count: r.chunks.length, answer: r.answer ? capResult(r.answer) : undefined, note: r.note, card: r.data };
      }

      case 'jkhssn_sanad_tree': {
        if (session.jkhssnEnabled === false) return { error: 'جوامع الكلم کنیکٹر بند ہے۔' };
        const r = await jkhssnAdapter.jkhssnSanadTree({ hadithMainId: num(args.hadith_main_id, 0) || undefined });
        if (r.error) return { error: r.error };
        if (r.data) {
          const artifactId = `jkhssn-sanad-${Date.now().toString(36)}`;
          emitArtifact({ op: 'open', artifactId, title: 'شجرۂ اسناد', artifactType: 'sanad-tree' });
          emitArtifact({ op: 'data', artifactId, payload: r.data });
          emitArtifact({ op: 'close', artifactId, status: 'final' });
        }
        return { note: r.note, tree: r.data };
      }

      case 'jkhssn_takhrij': {
        if (session.jkhssnEnabled === false) return { error: 'جوامع الكلم کنیکٹر بند ہے۔' };
        const r = await jkhssnAdapter.jkhssnTakhrij({ hadithMainId: num(args.hadith_main_id, 0) || undefined, bookIds: scopedJkhssnIds.length ? scopedJkhssnIds : undefined });
        if (r.error) return { error: r.error };
        return { note: r.note, takhrij: r.data };
      }

      case 'jkhssn_judgments': {
        if (session.jkhssnEnabled === false) return { error: 'جوامع الكلم کنیکٹر بند ہے۔' };
        const r = await jkhssnAdapter.jkhssnJudgments({ hadithMainId: num(args.hadith_main_id, 0) || undefined });
        if (r.error) return { error: r.error };
        ledger.add(r.chunks);
        if (r.chunks.length) {
          const artifactId = `jkhssn-judgments-${Date.now().toString(36)}`;
          emitArtifact({ op: 'open', artifactId, title: 'احکامِ ائمہ و علل', artifactType: 'citation-list' });
          emitArtifact({ op: 'citations', artifactId, entries: r.chunks.map((c, i) => ({ marker: String(i + 1), reference: c.reference, sourceId: c.id, supported: true, excerpt: (c.content ?? '').slice(0, 400) })) });
          emitArtifact({ op: 'close', artifactId, status: 'final' });
        }
        return { count: r.chunks.length, answer: r.answer ? capResult(r.answer) : undefined, note: r.note };
      }

      case 'jkhssn_thematic': {
        if (session.jkhssnEnabled === false) return { error: 'جوامع الكلم کنیکٹر بند ہے۔' };
        const r = await jkhssnAdapter.jkhssnThematic({ query: typeof args.query === 'string' ? args.query : undefined, subjectId: num(args.subject_id, 0) || undefined });
        if (r.error) return { error: r.error };
        return { note: r.note, thematic: r.data };
      }

      case 'search_repositories': {
        const query = str(args.query, 'query');
        const repo = typeof args.repo === 'string' ? args.repo : 'all';
        const limit = num(args.limit, 5);
        const r = await searchRepositories({ query, repo, limit } as RepositoryQuery);
        if (r.error) return { error: r.error };
        ledger.add(r.chunks);
        if (r.chunks.length) {
          const artifactId = `repos-${Date.now().toString(36)}`;
          emitArtifact({ op: 'open', artifactId, title: `مراجع: ${query.slice(0, 40)}`, artifactType: 'citation-list' });
          emitArtifact({ op: 'citations', artifactId, entries: r.chunks.map((c, i) => ({ marker: String(i + 1), reference: c.reference, sourceId: c.id, url: c.source_url ?? undefined, tier: 2 })) });
          emitArtifact({ op: 'close', artifactId, status: 'final' });
        }
        return {
          count: r.chunks.length,
          note: r.note,
          results: r.chunks.map((c) => ({ id: c.id, reference: capResult(c.reference), url: c.source_url ?? undefined, bibliographic: true })),
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

      case 'research_topic': {
        const topic = str(args.topic, 'topic');
        const focus = typeof args.focus === 'string' && args.focus.trim() ? args.focus.trim() : undefined;
        if (!subModel) {
          return { error: 'research_topic is only available from the Agent panel.' };
        }
        // The sub-run shares THIS ledger — so anything it retrieves is citable
        // by the parent with insert_footnote — but runs its own short loop, so
        // the search results never enter the parent's context.
        const idsBefore = new Set(ledger.list().map((c) => c.id));
        const subTools = AGENT_TOOLS.filter((t) => RESEARCH_SUBAGENT_TOOLS.has(t.name));

        const artifactId = `research-${Date.now().toString(36)}`;
        emitArtifact({ op: 'open', artifactId, title: `مصادر — ${topic.slice(0, 60)}`, artifactType: 'citation-list' });

        const sub = await runAgentLoop(
          `Gather page-precise sources on: ${topic}${focus ? ` (focus: ${focus})` : ''}`,
          subModel,
          dispatch,
          buildResearchSubagentPrompt(topic, focus),
          {
            mode: 'ask', tools: subTools, maxSteps: 6, isCancelled: session.isCancelled ?? undefined,
            onProgress: session.onProgress
              ? (p) => session.onProgress!({ step: p.step ?? 0, label: `research: ${p.label}`, labelKey: p.labelKey ? `research.${p.labelKey}` : undefined, kind: p.kind })
              : undefined,
          },
        );

        const found = ledger.list().filter((c) => !idsBefore.has(c.id) && !c.bibliographic);
        if (found.length) {
          emitArtifact({
            op: 'citations', artifactId,
            entries: found.slice(0, 20).map((c, i) => ({ marker: String(i + 1), reference: c.reference, sourceId: c.id, supported: true, tier: 1, excerpt: (c.content ?? '').slice(0, 300) || undefined })),
          });
        }
        emitArtifact({ op: 'close', artifactId, status: 'final' });

        return {
          topic,
          synthesis: capResult((sub.answer ?? '').trim()) || 'The sub-run returned no synthesis.',
          sourcesAdded: found.length,
          sources: found.slice(0, 15).map((c) => ({ id: c.id, reference: c.reference, excerpt: (c.content ?? '').slice(0, 200) })),
          note: found.length
            ? `${found.length} page-precise source(s) are now available — cite them with insert_footnote by their id. Do NOT call research_topic again for this topic.`
            : 'No page-precise sources were found for this topic — say so plainly rather than drafting unsourced prose.',
        };
      }

      case 'extract_author_voice': {
        const picked = Array.isArray(args.chapters)
          ? args.chapters.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
          : [];
        const names = (picked.length ? picked : refreshChapters(root).map((c) => c.name)).slice(0, 8);
        if (names.length === 0) return { error: 'no chapters to learn from — add some .docx chapters to the folder first' };

        const samples: string[] = [];
        let total = 0;
        for (const name of names) {
          const t = await chapterText(name).catch(() => '');
          if (!t.trim()) continue;
          const slice = t.slice(0, 4000);
          samples.push(`── ${name} ──\n${slice}`);
          total += slice.length;
          if (total > 20000) break;
        }
        if (samples.length === 0) return { error: 'the selected chapters have no readable text yet' };

        const draft = (await generateAgentText({
          prompt: samples.join('\n\n'),
          systemInstruction: AUTHOR_VOICE_EXTRACT_INSTRUCTION,
        })).trim();
        if (!draft) return { error: 'the model returned nothing' };

        // Never clobber an existing طرز_تحریر.md — write a proposal beside it.
        const primary = AUTHOR_VOICE_FILES[0];
        const exists = AUTHOR_VOICE_FILES.some((f) => { try { fs.accessSync(path.join(root, f)); return true; } catch { return false; } });
        const rel = exists ? AUTHOR_VOICE_PROPOSAL_FILE : primary;
        const today = new Date().toISOString().slice(0, 10);
        const body =
          `<!-- مسودہ — ${today} کو ${samples.length} ابواب سے کشید کیا گیا۔ ` +
          `نظرِ ثانی کر کے ${exists ? `پسندیدہ نکات ${primary} میں ضم کریں` : 'رکھ لیں یا درست کریں'}۔ ` +
          `ایجنٹ اگلی نشست سے اسے آپ کے اسلوب کے طور پر برتے گا۔ -->\n\n${draft}\n`;

        try { guardWrite(rel); } catch { /* the checkpoint only tracks chapter files; this advisory .md is fine without undo */ }
        writeAssetText(root, rel, body);

        const artifactId = `voice-${Date.now().toString(36)}`;
        emitArtifact({ op: 'open', artifactId, title: `طرز_تحریر — مسودہ`, artifactType: 'document' });
        emitArtifact({ op: 'delta', artifactId, mode: 'replace', text: draft });
        emitArtifact({ op: 'close', artifactId, status: 'final' });

        return {
          file: rel,
          chaptersAnalysed: samples.length,
          preview: capResult(draft),
          note: exists
            ? `A ${primary} already exists — this draft is saved as ${rel}. Review it and merge what you want into ${primary} yourself; nothing was overwritten.`
            : `Saved as ${rel} — a DRAFT. Review and edit it. From the next task on, the agent will match this voice when it drafts or rewrites prose.`,
        };
      }

      case 'critique': {
        const chapter = str(args.chapter, 'chapter');
        const kind = (['draft', 'argument', 'takhrij', 'sourcing'].includes(String(args.kind))
          ? String(args.kind) : 'draft') as CritiqueKind;
        const focus = typeof args.focus === 'string' && args.focus.trim() ? args.focus.trim() : undefined;
        const heading = typeof args.section_heading === 'string' && args.section_heading.trim() ? args.section_heading.trim() : undefined;

        let text = '';
        try { text = await chapterText(chapter); } catch { /* handled below */ }
        if (!text.trim()) return { error: `chapter "${chapter}" has no text to critique` };
        if (heading) {
          const at = text.indexOf(heading);
          if (at !== -1) text = text.slice(at, at + 9000);
        }

        const artifactId = `critique-${chapter}-${Date.now().toString(36)}`;
        emitArtifact({ op: 'open', artifactId, title: `نقد — ${heading ?? chapter}`, artifactType: 'document' });
        const r = await runCritique({ kind, subject: text, focus, context: heading ? `Section: ${heading}` : undefined });
        emitArtifact({ op: 'delta', artifactId, mode: 'replace', text: r.text });
        emitArtifact({ op: 'close', artifactId, status: r.ok ? 'final' : 'aborted', targetChapter: chapter });

        return {
          chapter, kind, critic: r.model ?? null, ok: r.ok,
          critique: capResult(r.text),
          note: r.ok
            ? 'This is a reasoning model\'s critique — advisory only. Act on the points that matter (add a caveat, a margin comment, or raise it with the scholar). Do not just accept it wholesale.'
            : 'The critic could not run — continue without it, or ask the scholar to set a critic provider in Settings.',
        };
      }

      case 'compile_ai_disclosure': {
        const entries = readDisclosureEntries(root);
        if (entries.length === 0) {
          return { count: 0, note: 'No AI drafting or rewriting has been recorded for this project — no disclosure statement is needed.' };
        }
        const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : undefined;
        const statement = buildDisclosureStatement(entries, { projectTitle: title });
        try { guardWrite(AI_DISCLOSURE_FILE); } catch { /* the checkpoint only tracks chapter files; this .md is fine without undo */ }
        writeAssetText(root, AI_DISCLOSURE_FILE, statement);

        const artifactId = `disclosure-${Date.now().toString(36)}`;
        emitArtifact({ op: 'open', artifactId, title: 'اعترافِ معاونتِ AI — AI-assistance disclosure', artifactType: 'document' });
        emitArtifact({ op: 'delta', artifactId, mode: 'replace', text: statement });
        emitArtifact({ op: 'close', artifactId, status: 'final' });

        const chapters = [...new Set(entries.map((e) => e.chapter))];
        return {
          file: AI_DISCLOSURE_FILE,
          chaptersCovered: chapters.length,
          entries: entries.length,
          preview: capResult(statement),
          note: `Saved to ${AI_DISCLOSURE_FILE}. Review and edit it, then place it in the book's front matter. It is a factual record from EasyEditor's ledger — not legal or journal-policy advice.`,
        };
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
        // A rewriting/condensing task follows the author's voice; a mechanical
        // pass (harakat, spelling, script, formatting) never does.
        const systemInstruction = VOICE_SHAPED_TASKS.has(slug) ? withAuthorVoice(prompt, authorVoice) : prompt;

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

        const refined = (await generateAgentText({ prompt: source, systemInstruction })).trim();
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
        if (!spec) return { error: `unknown draft mode "${mode}" — one of: outline, prose, column, translation, summary, literary-urdu, fatwa` };

        // M12 Phase E — mode 'fatwa' needs the verbatim question up front;
        // everything else about its shape is optional. result_json is
        // validated NOW, before spending a model call on a request that
        // would error anyway.
        const question = typeof args.question === 'string' && args.question.trim() ? args.question.trim() : undefined;
        if (mode === 'fatwa' && !question) {
          return { error: 'draft_section mode "fatwa" requires "question" — the scholar\'s own verbatim istiftāʾ.' };
        }
        let parsedResult: unknown;
        if (mode === 'fatwa' && typeof args.result_json === 'string' && args.result_json.trim()) {
          try {
            parsedResult = JSON.parse(args.result_json);
          } catch {
            return { error: 'draft_section: "result_json" must be valid JSON — pass the calculate_zakat/calculate_faraid result verbatim.' };
          }
        }

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
        const content = buildDraftInput({ mode, sectionHeading, chapterExcerpt, sources: sources.length ? sources : undefined, question });
        const draft = (await generateAgentText({ prompt: content, systemInstruction: withAuthorVoice(spec.instruction, authorVoice) })).trim();
        if (!draft) return { error: 'the model returned nothing' };

        // M12 Phase E — mode 'fatwa': wrap the model's ruling prose in the
        // deterministic fatwā shell. Every figure on the page comes from
        // `result_json` (the calculate_zakat/calculate_faraid JSON the model
        // already has verbatim, copied through — never re-typed here or by
        // the model), not from the drafted prose.
        let finalHtml = draft;
        if (mode === 'fatwa') {
          const resultTable = resolveResultTable(parsedResult) ?? undefined;
          const disclaimer = resolveDisclaimer(parsedResult);
          const muftiNames = Array.isArray(args.mufti_names)
            ? args.mufti_names.filter((n): n is string => typeof n === 'string' && n.trim() !== '')
            : undefined;
          const instituteName = typeof args.institute_name === 'string' && args.institute_name.trim() ? args.institute_name.trim() : undefined;
          finalHtml = buildFatwaHtml({
            instituteName, question: question!, resultTable, rulingHtml: draft, disclaimer, muftiNames,
          });
        }

        const artifactId = `draft-${chapter}-${Date.now().toString(36)}`;
        emitArtifact({ op: 'open', artifactId, title: `Draft — ${sectionHeading ?? chapter}`, artifactType: 'document' });
        emitArtifact({ op: 'delta', artifactId, mode: 'replace', html: spec.html ? finalHtml : undefined, text: spec.html ? undefined : finalHtml });

        const backedUp = guardEdit(chapter);
        const labelled = spec.html
          ? `<p><em>[DRAFT — review every claim]</em></p>\n${finalHtml}`
          : `[DRAFT — review every claim]\n${finalHtml}`;
        const res = await word.applyTextTask(dest, labelled, { isHtml: spec.html });
        emitArtifact({ op: 'close', artifactId, status: 'final', targetChapter: chapter });
        return {
          chapter, mode, revisions: res.revisions, backedUp, grounded: spec.grounded, sourcesUsed: sources.length,
          voiceApplied: Boolean(authorVoice),
          ...(authorVoice
            ? {}
            : { note: 'Drafted on the built-in template. Add a طرز_تحریر.md to the project folder describing your writing voice and the agent will match it next time.' }),
        };
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

      case 'build_spreadsheet': {
        // M12 Phase D — Excel write tool, fixed (ADR-0048/0050): multi-sheet,
        // live formulas, formatting and RTL, one batched COM session, and the
        // format:'pdf'/'csv' path no longer throws before it is reached (the
        // build step always targets a real .xlsx; only the final export
        // targets the requested format).
        const filePath = str(args.filePath, 'filePath');
        const sheetsRaw = str(args.sheets, 'sheets');
        let parsed: unknown;
        try {
          parsed = JSON.parse(sheetsRaw);
        } catch (err) {
          return { error: `build_spreadsheet: "sheets" must be valid JSON — ${err instanceof Error ? err.message : String(err)}` };
        }
        if (!Array.isArray(parsed) || parsed.length === 0) {
          return { error: 'build_spreadsheet: "sheets" must be a non-empty JSON array.' };
        }
        let sheets: excel.SheetSpec[];
        try {
          sheets = parsed.map((s, i) => {
            const sheet = s as { name?: unknown; data?: unknown; formulas?: unknown; format?: unknown };
            if (typeof sheet.name !== 'string' || !sheet.name.trim()) {
              throw new Error(`sheet #${i + 1} is missing a "name"`);
            }
            return {
              name: sheet.name,
              data: Array.isArray(sheet.data) ? sheet.data as unknown[][] : undefined,
              formulas: Array.isArray(sheet.formulas) ? sheet.formulas as excel.SheetSpec['formulas'] : undefined,
              format: Array.isArray(sheet.format) ? sheet.format as excel.SheetSpec['format'] : undefined,
            };
          });
        } catch (err) {
          return { error: `build_spreadsheet: ${err instanceof Error ? err.message : String(err)}` };
        }

        const outPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(root, 'export', filePath);
        const ext = path.extname(outPath).toLowerCase() || '.xlsx';
        const format = (typeof args.format === 'string' ? args.format : ext.replace('.', '')) as 'xlsx' | 'csv' | 'pdf';

        // Ensure export directory exists
        const exportDir = path.dirname(outPath);
        if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

        const { path: builtPath } = await excel.buildWorkbook(outPath, sheets, { format });

        return {
          path: builtPath,
          format,
          sheets: sheets.length,
          note: format === 'xlsx'
            ? `Spreadsheet created at ${builtPath}, with live formulas — editing an input cell recalculates the rest.`
            : `Spreadsheet built with live formulas, then exported to ${format.toUpperCase()} at ${builtPath} (a static snapshot — ${format} cannot hold formulas or more than one sheet).`,
        };
      }

      default:
        log.warn('unknown tool', { name });
        return { error: `unknown tool: ${name}` };
    }
  };

  return { dispatch, ledger };
}
