/**
 * M8 Layer 6 — the agent run orchestrator (SPEC-M8 §3, ADR-0016).
 *
 * Builds the system prompt (this machine's capabilities + the project's
 * `قواعد.md` rules + the selected playbook's guidance), then routes:
 *   1. a pure linguistic/editing ask on one chapter → a single run_task
 *      (fast path, ADR-0027 F1) — no loop;
 *   2. a `/trigger` or a strong keyword match → the deterministic playbook
 *      runner (ADR-0020);
 *   3. everything else → the free agentic loop.
 *
 * Tools shown to the model are pruned per request (ADR-0027 F2). The full
 * transcript is recorded so the Trust tab shows every tool call and source
 * (ADR-0016 control 4). One agent task runs at a time (./queue.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../lib/logger.js';
import { detectTools } from '../host/index.js';
import { refreshChapters } from '../fs/projectFolder.js';
import { resolveAgentModel } from './modelRouter.js';
import { getTextProviderId, resolveProvider } from '../ai/providerConfig.js';
import { createDispatcher, type AgentSession } from './dispatch.js';
import { runPlaybook } from './runPlaybook.js';
import { appendJournalEntry, readRecentJournal, formatJournalForPrompt, digestRun } from './journal.js';
import { digestDisclosure, appendDisclosureEntries } from './disclosure.js';
import { runCritique } from './critic.js';
import { checkClaim } from './claimCheck.js';
import { beginCheckpoint } from './checkpoint.js';
import type { ExternalEdit } from './externalFiles.js';
import type { FileApprovalRequest } from './fileApproval.js';
import { extractWebPage } from './adapters/webExtract.js';
import { runAgentLoop } from '../../shared/agent/loop.js';
import { buildHistory, type ConversationTurn } from '../../shared/agent/history.js';
import { buildSystemPrompt } from '../../shared/agent/systemPrompt.js';
import { AUTHOR_VOICE_FILES } from '../../shared/agent/authorVoice.js';
import { toolsFor } from '../../shared/agent/toolScoping.js';
import { selectPlaybook, resolvePlaybook, mergeSkillState } from '../../shared/playbooks/registry.js';
import { detectFastPath } from '../../shared/agent/fastPath.js';
import { classifyIntent, negativeConstraintBlock } from '../../shared/agent/intent.js';
import { classifyIntentLLM } from './intentClassifier.js';
import { isToolDisabled, mergeConnectorState } from '../../shared/agent/connectors.js';
import { readConnectors, readOcrConsent, readSkills } from '../fs/projectFolder.js';
import { readGlobalConnectors } from '../connectors/globalStore.js';
import { readGlobalSkills } from '../skills/globalStore.js';
import type {
  AgentMode,
  AgentProgress,
  AgentRunResult,
  EmitArtifactFn,
  WaitForApprovalFn,
} from '../../shared/agent/types.js';

const log = logger.child('agent/run');

const RULES_FILES = ['قواعد.md', 'qawaid.md', 'RULES.md'];

/** First matching project-root markdown file, read utf8, or null. */
function readRootDoc(root: string, names: string[]): string | null {
  for (const name of names) {
    try {
      const txt = fs.readFileSync(path.join(root, name), 'utf8');
      if (txt.trim()) return txt;
    } catch { /* not this one */ }
  }
  return null;
}

/** قواعد.md — the project's constitution (a CONSTRAINT). */
function readProjectRules(root: string): string | null {
  return readRootDoc(root, RULES_FILES);
}

/** طرز_تحریر.md — the author's writing voice (a STYLE brief, M9 Phase A). */
function readAuthorVoice(root: string): string | null {
  return readRootDoc(root, AUTHOR_VOICE_FILES);
}

/**
 * M11 Phase 2 / M12 Phase H — adapts `AgentRunInput.onProgress` (typed on the
 * narrow `AgentProgress.kind` union) into `AgentSession.onProgress`'s looser
 * shape (`kind: string`), so a bounded sub-run's (`research_topic`) progress
 * can relay through `dispatch.ts` back to the caller. Exported standalone so
 * this small but easy-to-silently-break piece of wiring has its own test,
 * independent of `runAgent`'s many other dependencies.
 *
 * Returns `null` when there is nothing to relay to (a headless/eval caller
 * that never passed `onProgress` at all) — `AgentSession.onProgress` is
 * optional and every caller already guards it with `session.onProgress?.(…)`.
 */
export function adaptProgressForSession(
  onProgress: ((p: AgentProgress) => void) | undefined,
): AgentSession['onProgress'] {
  if (!onProgress) return null;
  return (p) => onProgress({
    step: p.step, label: p.label, labelKey: p.labelKey,
    kind: p.kind as AgentProgress['kind'], detail: p.detail,
  });
}

export interface AgentRunInput {
  instruction: string;
  mode: AgentMode;
  /**
   * The open project folder, or `null` when Ask mode is running with nothing
   * open (M11). Only Ask can run without one — Plan/Auto write into a
   * project and are gated on having one before a run even starts
   * (useAgentRun.ts's `send()`).
   */
  projectRoot: string | null;
  onProgress?: (p: AgentProgress) => void;
  isCancelled?: () => boolean;
  /** Runs a General-channel search via the renderer (ADR-0019 item 7). */
  generalSearch?: ((query: string) => Promise<import('./generalSearch.js').GeneralSearchResult>) | null;
  /** Runs a research query via the renderer — 'islamic' returns citations (ADR-0022). */
  researchSearch?: ((mode: import('./researchBridge.js').ResearchMode, query: string) => Promise<import('./researchBridge.js').ResearchResult>) | null;
  /** Decodes + transcribes an in-project recording via the renderer (M9 Phase 5). */
  transcribeMedia?: ((mediaPath: string, lang: string) => Promise<import('./researchBridge.js').TranscriptionResult>) | null;
  /** Consent-gated cloud OCR of an in-project scan via the renderer (M9 Phase 7). */
  ocrDocument?: ((scanPath: string, lang: string, pages?: string) => Promise<import('./ocrBridge.js').OcrResult>) | null;
  /** Plan mode — resolves once the scholar approves (or rejects) the plan. */
  waitForApproval?: WaitForApprovalFn;
  /** M13 (ADR-0056) — per-write approval for a file outside the project, every mode. */
  requestFileApproval?: ((req: FileApprovalRequest) => Promise<'approved' | 'rejected'>) | null;
  /**
   * M11 Phase 1 — the conversation so far (finished turns). Prepended to the
   * loop's messages so a follow-up question has the thread. Not used by the
   * deterministic playbook runner (a `/trigger` flow is self-contained).
   */
  history?: ConversationTurn[];
  /** Plan §4.4 — the `#` scope: book refs the search tools are restricted to. */
  scope?: {
    books: string[];
    groups: Array<{ type: string; ref: string; label: string; bookRefs: string[] }>;
    playbook: string | null;
    mentions: string[];
    batch: { granularity: 'per-book' | 'per-author'; resumeFrom?: string } | null;
    /** M11 — source/domain narrowing + Arabic-matn filter (`search_hadith` only). */
    researchFilter?: { selectedDomains?: string[]; requireArabicMatn?: boolean };
  };
}

export type AgentRunOutput = AgentRunResult & {
  playbook?: string;
  checkpointId?: string;
  /** M13 (ADR-0056) — outside-project files this run edited, each with its sibling `.bak`. */
  externalEdits?: ExternalEdit[];
};

export async function runAgent(input: AgentRunInput): Promise<AgentRunOutput> {
  const { mode, projectRoot } = input;
  // Plan §4.4 — a `#`-scoped run tells the model up front what it is limited to.
  const scopeGroups = input.scope?.groups ?? [];
  const scopeNote =
    input.scope && (input.scope.books.length || scopeGroups.length)
      ? `\n\n[دائرہ] یہ کام صرف ان مصادر تک محدود ہے: ` +
        (scopeGroups.length
          ? scopeGroups.map((g) => `${g.label} (${g.bookRefs.length} کتب)`).join('، ')
          : `${input.scope.books.length} منتخب کتب`) +
        `۔ تلاش کے اوزار انہی کتب میں چلائیں؛ باہر کے مصادر استعمال نہ کریں۔`
      : '';
  const instruction = input.instruction + scopeNote;

  const caps = detectTools();
  const chapters = projectRoot ? (() => {
    try { return refreshChapters(projectRoot).map((c) => c.name); } catch { return []; }
  })() : [];
  const rules = projectRoot ? readProjectRules(projectRoot) : null;
  const authorVoice = projectRoot ? readAuthorVoice(projectRoot) : null;
  // M11 Phase 1 — prior turns → the messages the loop prepends (user/model
  // text only). Playbook runs skip this: a `/trigger` flow is self-contained.
  const history = input.history?.length ? buildHistory(input.history) : undefined;
  // M11 Phase 3 / M12 Phase H (ADR-0047) — per-project skill switches merged
  // with the per-machine SkillsPanel layer, the same two-tier shape as
  // connectors below. A switched-off skill is invisible to BOTH the
  // automatic keyword match here and the explicit `run_playbook` tool
  // further down (session.runPlaybookRef) — this was previously read-only
  // (SkillsPanel.tsx listed playbooks with no toggle at all).
  const skills = (() => {
    try { return mergeSkillState(readGlobalSkills(), projectRoot ? readSkills(projectRoot) : undefined); }
    catch { return {}; }
  })();
  const playbook = selectPlaybook(instruction, skills);
  const agentModel = await resolveAgentModel();
  if (agentModel.provider.id !== 'gemini') log.info('agent model provider', { provider: agentModel.provider.id });

  // Per-project connector switches (M9 Phase 1b) merged with the per-machine
  // Hub layer (ADR-0037): the model sees a connector's tools only when BOTH
  // layers say on.
  const connectors = (() => {
    try { return mergeConnectorState(readGlobalConnectors(), projectRoot ? readConnectors(projectRoot) : undefined); }
    catch { return {}; }
  })();
  const connectorsOn = Object.entries(connectors).filter(([, v]) => v).map(([k]) => k);

  // ── Intent classification (ADR-0038) ────────────────────────────────────
  // Level 1 is an instant heuristic; only an ambiguous verdict on a non-
  // playbook run spends one cached LLM call. A playbook run is already scoped
  // to its steps — do not gate it further.
  let intent = classifyIntent(instruction, { connectorsOn });
  if (!playbook && intent.ambiguous) {
    intent = await classifyIntentLLM(instruction, { connectorsOn }, intent);
  }
  log.info('agent intent', { route: intent.route.kind, connectors: intent.matchedDomains, degraded: intent.degraded ?? false });

  const gateConnectors = playbook
    ? undefined
    : intent.route.kind === 'gated'
      ? intent.route.connectors
      : intent.route.kind === 'direct'
        ? []
        : undefined;

  const noProjectNote = !projectRoot && mode !== 'ask'
    ? `\n\nNo project folder is open. You can still work on the scholar's own files by FULL PATH: find them with search_my_computer, read them with read_external_document, and edit a .docx with automate_word_document (the scholar approves each outside file and a .bak copy is made first). Chapter tools are unavailable until a project is opened.`
    : '';
  const systemPrompt = buildSystemPrompt({
    mode,
    capabilities: { ...caps },
    projectRules: rules,
    authorVoice,
    recentWork: formatJournalForPrompt(projectRoot ? readRecentJournal(projectRoot) : []),
    chapters,
    playbookGuidance: playbook?.guidance ?? null,
    toolGating: playbook ? null : negativeConstraintBlock(intent.route),
  }) + noProjectNote;

  /**
   * Append one journal line (M9 Phase E) and return the output unchanged.
   * Both the journal and the disclosure ledger are per-project files — a
   * no-op when Ask mode is running with nothing open (there is nowhere to
   * write them, and nothing was written to disclose either).
   */
  const externalEdits: ExternalEdit[] = [];
  const finish = (raw: AgentRunOutput): AgentRunOutput => {
    const output: AgentRunOutput = externalEdits.length ? { ...raw, externalEdits: [...externalEdits] } : raw;
    if (!projectRoot) return output;
    const { wrote, sources } = digestRun(output);
    appendJournalEntry(projectRoot, {
      ts: new Date().toISOString(),
      instruction: instruction.slice(0, 300),
      mode,
      provider: agentModel.provider.id,
      stopReason: output.stopReason,
      steps: output.steps,
      wrote,
      sources,
      summary: (output.answer ?? '').slice(0, 400),
    });
    // The AI-disclosure ledger (blueprint §3): one line per drafting / rewriting
    // write, attributed to the TEXT provider (the one that generated the prose).
    try {
      const textProvider = resolveProvider(getTextProviderId());
      appendDisclosureEntries(projectRoot, digestDisclosure(output, textProvider.id, textProvider.textModel));
    } catch (err) {
      log.warn('could not record the AI-disclosure ledger', { message: (err as Error).message });
    }
    return output;
  };

  // A "plan"/"auto" task may edit files — open a checkpoint so the whole task
  // can be undone at once. "Ask" mode never writes.
  const canWrite = mode !== 'ask';
  // `projectRoot` is always set here in practice — Plan/Auto (the only modes
  // with `canWrite`) are gated on having an open project before a run even
  // starts (useAgentRun.ts's `send()`) — the `&& projectRoot` is defense in
  // depth, not a path that's expected to fire.
  const checkpointId = canWrite && projectRoot ? beginCheckpoint(projectRoot, instruction) : undefined;

  const emitArtifact: EmitArtifactFn = (ev) => input.onProgress?.({ kind: 'artifact', artifact: ev });

  // Plan mode — before the scholar approves, hand the plan to the reasoning
  // critic and show its view alongside the plan. Non-blocking on failure.
  const waitForApproval: WaitForApprovalFn | undefined = input.waitForApproval && (async (plan) => {
    try {
      const c = await runCritique({
        kind: 'plan',
        subject: `${plan.summary}\n\nSteps:\n${plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
        context: `The scholar asked: "${instruction}". Open chapters: ${chapters.join(', ') || 'none'}.`,
      });
      if (c.text.trim()) {
        emitArtifact({ op: 'open', artifactId: 'plan-critique', title: 'ناقد کی رائے (reasoning model)', artifactType: 'plan' });
        emitArtifact({ op: 'delta', artifactId: 'plan-critique', mode: 'replace', text: c.text });
        emitArtifact({ op: 'close', artifactId: 'plan-critique', status: c.ok ? 'final' : 'aborted' });
      }
    } catch { /* the critic is advisory — never block approval on it */ }
    return input.waitForApproval!(plan);
  });

  const session: AgentSession = {
    projectRoot,
    checkpointId,
    authorVoice,
    model: agentModel.generate,
    isCancelled: input.isCancelled ?? null,
    claimCheck: checkClaim,
    generalSearch: input.generalSearch ?? null,
    researchSearch: input.researchSearch ?? null,
    researchFilter: input.scope?.researchFilter ?? null,
    transcribeMedia: input.transcribeMedia ?? null,
    ocrDocument: input.ocrDocument ?? null,
    ocrConsent: projectRoot ? (() => { try { return readOcrConsent(projectRoot); } catch { return false; } })() : false,
    emitArtifact,
    // M11 Phase 2 / M12 Phase H — relay progress into a bounded sub-run
    // (research_topic), so its steps show up live instead of the parent run
    // going silent for however long the sub-run takes. This was previously
    // never set here at all: dispatch.ts's `session.onProgress` relay
    // (research_topic) existed but had nothing to call — dead code since the
    // field this session object never populated it.
    onProgress: adaptProgressForSession(input.onProgress),
    // ADR-0044 — the local-first Shamela router reads these.
    shamelaLocalEnabled: connectors['shamela'] !== false,
    shamelaCloudEnabled: connectors['shamela-cloud'] === true,
    // ADR-0054 — the Turath.io connector.
    turathEnabled: connectors['turath'] !== false,
    // ADR-0045 — the جوامع الكلم engine.
    jkhssnEnabled: connectors['jkhssn'] !== false,
    // Plan §4.5 — restrict the search tools to the scoped book refs.
    bookScope: input.scope?.books?.length ? input.scope.books : undefined,
    // M13 (ADR-0056) — outside-project writes: approve each one, remember its `.bak`.
    requestFileApproval: input.requestFileApproval ?? null,
    onExternalEdit: (e) => { externalEdits.push(e); },
    // M13 Phase 4 (ADR-0060) — URLs the scholar typed (this turn + earlier) may be opened.
    userText: [input.instruction, ...(input.history ?? []).map((h) => h.instruction)].join('\n'),
    extractWebPage,
  };
  const { dispatch } = createDispatcher(session);

  // ── 1. Fast path — a single text task, no loop ────────────────────────
  if (canWrite) {
    const fast = detectFastPath(instruction, { chapters });
    if (fast) {
      log.info('agent fast path', { task: fast.task, chapter: fast.chapter });
      input.onProgress?.({ step: 1, kind: 'tool', label: `running ${fast.task}`, labelKey: 'agent.step.run_task' });
      const result = await dispatch('run_task', { chapter: fast.chapter, task: fast.task });
      const errored = typeof result === 'object' && result !== null && 'error' in result;
      input.onProgress?.({ step: 1, kind: errored ? 'error' : 'done', label: `running ${fast.task}`, labelKey: errored ? 'agent.step.error' : 'agent.step.done' });
      const wrote = !errored;
      return finish({
        answer: errored
          ? `Could not run ${fast.task}: ${String((result as { error: unknown }).error)}`
          : `Ran ${fast.task} on ${fast.chapter} — review the tracked changes in Word.`,
        messages: [],
        toolCalls: [{ name: 'run_task', args: { chapter: fast.chapter, task: fast.task }, result }],
        steps: 1,
        stopReason: errored ? 'error' : 'done',
        checkpointId: wrote ? checkpointId : undefined,
      });
    }
  }

  // `connectors` (merged Hub + per-project state) and `intent` were resolved
  // above. A tool whose connector is off is not shown to the model; the intent
  // classifier's `gateConnectors` narrows further (ADR-0038).
  const scopeCtx = { ask: playbook ? undefined : instruction, playbook, gateConnectors };
  const scopedTools = toolsFor(mode, scopeCtx)
    .filter((tool) => !isToolDisabled(connectors, tool.name));
  const disabledTools = new Set(
    toolsFor(mode, scopeCtx)
      .map((t) => t.name)
      .filter((n) => isToolDisabled(connectors, n)),
  );

  // ── 1b. Direct answer — a plain-editing ask in Ask mode ────────────────
  // (ADR-0038). The fast path (canWrite only) already handles the write side;
  // this is the read-only counterpart: rewrite / spelling / translate / summary.
  // No external retrieval — but the document tools stay available, otherwise an
  // ask that POINTS at a chapter ("باب دوم کا خلاصہ") instead of pasting its text
  // would be answered blind. When the text is already in the instruction the
  // model simply answers without calling anything.
  if (mode === 'ask' && !playbook && intent.route.kind === 'direct') {
    const directTools = scopedTools.filter(
      (t) => t.name === 'read_document' || t.name === 'search_corpus',
    );
    log.info('agent run — direct answer', { checkpointId, tools: directTools.map((t) => t.name) });
    const result = await runAgentLoop(instruction, agentModel.generate, dispatch, systemPrompt, {
      mode,
      tools: directTools,
      maxSteps: directTools.length ? 4 : 2,
      onProgress: input.onProgress,
      isCancelled: input.isCancelled,
      history,
    });
    return finish({ ...result, playbook: undefined, checkpointId: undefined });
  }


  // ── 2. Playbook — deterministic execution ─────────────────────────────
  const isSlash = instruction.trim().startsWith('/');
  if (playbook && (isSlash || playbookMatchIsStrong(instruction, playbook.keywords))) {
    session.runPlaybookRef = async (ref, chapter) => {
      const pb = resolvePlaybook(ref, skills);
      if (!pb) return { error: `unknown playbook: ${ref}` };
      const r = await runPlaybook({
        playbook: pb, instruction, mode,
        context: { chapter, instruction, mentions: {} },
        dispatch, model: agentModel, systemPrompt,
        onProgress: input.onProgress, emitArtifact,
        isCancelled: input.isCancelled, waitForApproval,
        fallbackTools: scopedTools, disabledTools,
      });
      return { playbook: pb.id, stopReason: r.stopReason, steps: r.steps, answer: r.answer };
    };

    log.info('agent run — playbook', { mode, playbook: playbook.id, checkpointId });
    const result = await runPlaybook({
      playbook, instruction, mode,
      context: { chapter: chapters.length === 1 ? chapters[0] : undefined, instruction, mentions: {} },
      dispatch, model: agentModel, systemPrompt,
      onProgress: input.onProgress, emitArtifact,
      isCancelled: input.isCancelled, waitForApproval,
      fallbackTools: scopedTools, disabledTools,
    });
    return finish({ ...result, playbook: playbook.id, checkpointId: taskWrote(result) ? checkpointId : undefined });
  }

  // ── 3. Free agentic loop ─────────────────────────────────────────────
  session.runPlaybookRef = async (ref, chapter) => {
    const pb = resolvePlaybook(ref, skills);
    if (!pb) return { error: `unknown playbook: ${ref}` };
    const r = await runPlaybook({
      playbook: pb, instruction, mode,
      context: { chapter, instruction, mentions: {} },
      dispatch, model: agentModel, systemPrompt,
      onProgress: input.onProgress, emitArtifact,
      isCancelled: input.isCancelled, waitForApproval,
      fallbackTools: scopedTools, disabledTools,
    });
    return { playbook: pb.id, stopReason: r.stopReason, steps: r.steps, answer: r.answer };
  };

  log.info('agent run — free loop', { mode, playbook: playbook?.id, chapters: chapters.length, checkpointId });
  const result = await runAgentLoop(instruction, agentModel.generate, dispatch, systemPrompt, {
    mode,
    tools: scopedTools,
    onProgress: input.onProgress,
    isCancelled: input.isCancelled,
    waitForApproval,
    history,
  });

  return finish({ ...result, playbook: playbook?.id, checkpointId: taskWrote(result) ? checkpointId : undefined });
}

/** A keyword match is "strong" enough to run the playbook only if ≥ 2 hits. */
function playbookMatchIsStrong(ask: string, keywords: string[]): boolean {
  const lower = ask.toLowerCase();
  return keywords.reduce((n, k) => (lower.includes(k.toLowerCase()) ? n + 1 : n), 0) >= 2;
}

function taskWrote(result: AgentRunResult): boolean {
  return result.toolCalls.some(
    (c) => {
      const r = c.result;
      const inert = typeof r === 'object' && r !== null && ('error' in r || 'needsConsent' in r);
      return (
        (['insert_footnote', 'set_page_layout', 'run_task', 'draft_section', 'add_document_comment', 'transcribe_media', 'ocr_document', 'create_chapter', 'build_scholarly_indexes', 'typeset_print_ready', 'extract_author_voice', 'compile_ai_disclosure', 'automate_word_document'].includes(c.name)
          && !inert)
        || (c.name === 'install_template' && Boolean((c.args as { chapter?: unknown }).chapter))
      );
    },
  );
}
