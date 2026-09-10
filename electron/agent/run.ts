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
import { runAgentLoop } from '../../shared/agent/loop.js';
import { buildSystemPrompt } from '../../shared/agent/systemPrompt.js';
import { AUTHOR_VOICE_FILES } from '../../shared/agent/authorVoice.js';
import { toolsFor } from '../../shared/agent/toolScoping.js';
import { selectPlaybook, resolvePlaybook } from '../../shared/playbooks/registry.js';
import { detectFastPath } from '../../shared/agent/fastPath.js';
import { classifyIntent, negativeConstraintBlock } from '../../shared/agent/intent.js';
import { classifyIntentLLM } from './intentClassifier.js';
import { isToolDisabled, mergeConnectorState } from '../../shared/agent/connectors.js';
import { readConnectors, readOcrConsent } from '../fs/projectFolder.js';
import { readGlobalConnectors } from '../connectors/globalStore.js';
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

export interface AgentRunInput {
  instruction: string;
  mode: AgentMode;
  projectRoot: string;
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
  /** Plan §4.4 — the `#` scope: book refs the search tools are restricted to. */
  scope?: {
    books: string[];
    groups: Array<{ type: string; ref: string; label: string; bookRefs: string[] }>;
    playbook: string | null;
    mentions: string[];
    batch: { granularity: 'per-book' | 'per-author'; resumeFrom?: string } | null;
  };
}

export type AgentRunOutput = AgentRunResult & { playbook?: string; checkpointId?: string };

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
  const chapters = (() => {
    try { return refreshChapters(projectRoot).map((c) => c.name); } catch { return []; }
  })();
  const rules = readProjectRules(projectRoot);
  const authorVoice = readAuthorVoice(projectRoot);
  const playbook = selectPlaybook(instruction);
  const agentModel = await resolveAgentModel();
  if (agentModel.provider.id !== 'gemini') log.info('agent model provider', { provider: agentModel.provider.id });

  // Per-project connector switches (M9 Phase 1b) merged with the per-machine
  // Hub layer (ADR-0037): the model sees a connector's tools only when BOTH
  // layers say on.
  const connectors = (() => {
    try { return mergeConnectorState(readGlobalConnectors(), readConnectors(projectRoot)); }
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

  const systemPrompt = buildSystemPrompt({
    mode,
    capabilities: { ...caps },
    projectRules: rules,
    authorVoice,
    recentWork: formatJournalForPrompt(readRecentJournal(projectRoot)),
    chapters,
    playbookGuidance: playbook?.guidance ?? null,
    toolGating: playbook ? null : negativeConstraintBlock(intent.route),
  });

  /** Append one journal line (M9 Phase E) and return the output unchanged. */
  const finish = (output: AgentRunOutput): AgentRunOutput => {
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
  const checkpointId = canWrite ? beginCheckpoint(projectRoot, instruction) : undefined;

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
    transcribeMedia: input.transcribeMedia ?? null,
    ocrDocument: input.ocrDocument ?? null,
    ocrConsent: (() => { try { return readOcrConsent(projectRoot); } catch { return false; } })(),
    emitArtifact,
    // ADR-0044 — the local-first Shamela router reads these.
    shamelaLocalEnabled: connectors['shamela'] !== false,
    shamelaCloudEnabled: connectors['shamela-cloud'] === true,
    // ADR-0045 — the جوامع الكلم engine.
    jkhssnEnabled: connectors['jkhssn'] !== false,
    // Plan §4.5 — restrict the search tools to the scoped book refs.
    bookScope: input.scope?.books?.length ? input.scope.books : undefined,
  };
  const { dispatch } = createDispatcher(session);

  // ── 1. Fast path — a single text task, no loop ────────────────────────
  if (canWrite) {
    const fast = detectFastPath(instruction, { chapters });
    if (fast) {
      log.info('agent fast path', { task: fast.task, chapter: fast.chapter });
      input.onProgress?.({ step: 1, kind: 'tool', label: `running ${fast.task}` });
      const result = await dispatch('run_task', { chapter: fast.chapter, task: fast.task });
      const errored = typeof result === 'object' && result !== null && 'error' in result;
      input.onProgress?.({ step: 1, kind: errored ? 'error' : 'done', label: `running ${fast.task}` });
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

  // ── 1b. Direct answer — a plain-editing ask in Ask mode needs no tools ──
  // (ADR-0038). The fast path (canWrite only) already handles the write side;
  // this is the read-only counterpart: rewrite / spelling / translate / summary
  // with the text in front of the model. Zero retrieval, one model turn.
  if (mode === 'ask' && !playbook && intent.route.kind === 'direct') {
    log.info('agent run — direct answer (no tools)', { checkpointId });
    const result = await runAgentLoop(instruction, agentModel.generate, dispatch, systemPrompt, {
      mode,
      tools: [],
      maxSteps: 2,
      onProgress: input.onProgress,
      isCancelled: input.isCancelled,
    });
    return finish({ ...result, playbook: undefined, checkpointId: undefined });
  }

  // ── 2. Playbook — deterministic execution ─────────────────────────────
  const isSlash = instruction.trim().startsWith('/');
  if (playbook && (isSlash || playbookMatchIsStrong(instruction, playbook.keywords))) {
    session.runPlaybookRef = async (ref, chapter) => {
      const pb = resolvePlaybook(ref);
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
    const pb = resolvePlaybook(ref);
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
        (['insert_footnote', 'set_page_layout', 'run_task', 'draft_section', 'add_document_comment', 'transcribe_media', 'ocr_document', 'create_chapter', 'build_scholarly_indexes', 'typeset_print_ready', 'extract_author_voice', 'compile_ai_disclosure'].includes(c.name)
          && !inert)
        || (c.name === 'install_template' && Boolean((c.args as { chapter?: unknown }).chapter))
      );
    },
  );
}
