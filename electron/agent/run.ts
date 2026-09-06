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
import { createDispatcher, type AgentSession } from './dispatch.js';
import { runPlaybook } from './runPlaybook.js';
import { appendJournalEntry, readRecentJournal, formatJournalForPrompt, digestRun } from './journal.js';
import { checkClaim } from './claimCheck.js';
import { beginCheckpoint } from './checkpoint.js';
import { runAgentLoop } from '../../shared/agent/loop.js';
import { buildSystemPrompt } from '../../shared/agent/systemPrompt.js';
import { AUTHOR_VOICE_FILES } from '../../shared/agent/authorVoice.js';
import { toolsFor } from '../../shared/agent/toolScoping.js';
import { selectPlaybook, resolvePlaybook } from '../../shared/playbooks/registry.js';
import { detectFastPath } from '../../shared/agent/fastPath.js';
import { isToolDisabled } from '../../shared/agent/connectors.js';
import { readConnectors, readOcrConsent } from '../fs/projectFolder.js';
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
}

export type AgentRunOutput = AgentRunResult & { playbook?: string; checkpointId?: string };

export async function runAgent(input: AgentRunInput): Promise<AgentRunOutput> {
  const { instruction, mode, projectRoot } = input;

  const caps = detectTools();
  const chapters = (() => {
    try { return refreshChapters(projectRoot).map((c) => c.name); } catch { return []; }
  })();
  const rules = readProjectRules(projectRoot);
  const authorVoice = readAuthorVoice(projectRoot);
  const playbook = selectPlaybook(instruction);
  const agentModel = await resolveAgentModel();
  if (agentModel.provider.id !== 'gemini') log.info('agent model provider', { provider: agentModel.provider.id });

  const systemPrompt = buildSystemPrompt({
    mode,
    capabilities: { ...caps },
    projectRules: rules,
    authorVoice,
    recentWork: formatJournalForPrompt(readRecentJournal(projectRoot)),
    chapters,
    playbookGuidance: playbook?.guidance ?? null,
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
    return output;
  };

  // A "plan"/"auto" task may edit files — open a checkpoint so the whole task
  // can be undone at once. "Ask" mode never writes.
  const canWrite = mode !== 'ask';
  const checkpointId = canWrite ? beginCheckpoint(projectRoot, instruction) : undefined;

  const emitArtifact: EmitArtifactFn = (ev) => input.onProgress?.({ kind: 'artifact', artifact: ev });

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

  // Per-project connector switches (M9 Phase 1b) — a tool whose connector is
  // off is not shown to the model, and a playbook step needing it is skipped.
  const connectors = (() => { try { return readConnectors(projectRoot); } catch { return {}; } })();
  const scopedTools = toolsFor(mode, { ask: playbook ? undefined : instruction, playbook })
    .filter((tool) => !isToolDisabled(connectors, tool.name));
  const disabledTools = new Set(
    toolsFor(mode, { ask: playbook ? undefined : instruction, playbook })
      .map((t) => t.name)
      .filter((n) => isToolDisabled(connectors, n)),
  );

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
        isCancelled: input.isCancelled, waitForApproval: input.waitForApproval,
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
      isCancelled: input.isCancelled, waitForApproval: input.waitForApproval,
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
      isCancelled: input.isCancelled, waitForApproval: input.waitForApproval,
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
    waitForApproval: input.waitForApproval,
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
        (['insert_footnote', 'set_page_layout', 'run_task', 'draft_section', 'add_document_comment', 'transcribe_media', 'ocr_document', 'create_chapter', 'build_scholarly_indexes', 'typeset_print_ready'].includes(c.name)
          && !inert)
        || (c.name === 'install_template' && Boolean((c.args as { chapter?: unknown }).chapter))
      );
    },
  );
}
