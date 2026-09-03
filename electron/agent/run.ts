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
import { generateWithTools } from './geminiTools.js';
import { createDispatcher, type AgentSession } from './dispatch.js';
import { runPlaybook } from './runPlaybook.js';
import { checkClaim } from './claimCheck.js';
import { beginCheckpoint } from './checkpoint.js';
import { runAgentLoop } from '../../shared/agent/loop.js';
import { buildSystemPrompt } from '../../shared/agent/systemPrompt.js';
import { toolsFor } from '../../shared/agent/toolScoping.js';
import { selectPlaybook, resolvePlaybook } from '../../shared/playbooks/registry.js';
import { detectFastPath } from '../../shared/agent/fastPath.js';
import type {
  AgentMode,
  AgentProgress,
  AgentRunResult,
  EmitArtifactFn,
  WaitForApprovalFn,
} from '../../shared/agent/types.js';

const log = logger.child('agent/run');

const RULES_FILES = ['قواعد.md', 'qawaid.md', 'RULES.md'];

function readProjectRules(root: string): string | null {
  for (const name of RULES_FILES) {
    try {
      const txt = fs.readFileSync(path.join(root, name), 'utf8');
      if (txt.trim()) return txt;
    } catch { /* not this one */ }
  }
  return null;
}

export interface AgentRunInput {
  instruction: string;
  mode: AgentMode;
  projectRoot: string;
  onProgress?: (p: AgentProgress) => void;
  isCancelled?: () => boolean;
  /** Runs a General-channel search via the renderer (ADR-0019 item 7). */
  generalSearch?: ((query: string) => Promise<import('./generalSearch.js').GeneralSearchResult>) | null;
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
  const playbook = selectPlaybook(instruction);

  const systemPrompt = buildSystemPrompt({
    mode,
    capabilities: { ...caps },
    projectRules: rules,
    chapters,
    playbookGuidance: playbook?.guidance ?? null,
  });

  // A "plan"/"auto" task may edit files — open a checkpoint so the whole task
  // can be undone at once. "Ask" mode never writes.
  const canWrite = mode !== 'ask';
  const checkpointId = canWrite ? beginCheckpoint(projectRoot, instruction) : undefined;

  const emitArtifact: EmitArtifactFn = (ev) => input.onProgress?.({ kind: 'artifact', artifact: ev });

  const session: AgentSession = {
    projectRoot,
    checkpointId,
    claimCheck: checkClaim,
    generalSearch: input.generalSearch ?? null,
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
      return {
        answer: errored
          ? `Could not run ${fast.task}: ${String((result as { error: unknown }).error)}`
          : `Ran ${fast.task} on ${fast.chapter} — review the tracked changes in Word.`,
        messages: [],
        toolCalls: [{ name: 'run_task', args: { chapter: fast.chapter, task: fast.task }, result }],
        steps: 1,
        stopReason: errored ? 'error' : 'done',
        checkpointId: wrote ? checkpointId : undefined,
      };
    }
  }

  const scopedTools = toolsFor(mode, { ask: playbook ? undefined : instruction, playbook });

  // ── 2. Playbook — deterministic execution ─────────────────────────────
  const isSlash = instruction.trim().startsWith('/');
  if (playbook && (isSlash || playbookMatchIsStrong(instruction, playbook.keywords))) {
    session.runPlaybookRef = async (ref, chapter) => {
      const pb = resolvePlaybook(ref);
      if (!pb) return { error: `unknown playbook: ${ref}` };
      const r = await runPlaybook({
        playbook: pb, instruction, mode,
        context: { chapter, instruction, mentions: {} },
        dispatch, systemPrompt,
        onProgress: input.onProgress, emitArtifact,
        isCancelled: input.isCancelled, waitForApproval: input.waitForApproval,
        fallbackTools: scopedTools,
      });
      return { playbook: pb.id, stopReason: r.stopReason, steps: r.steps, answer: r.answer };
    };

    log.info('agent run — playbook', { mode, playbook: playbook.id, checkpointId });
    const result = await runPlaybook({
      playbook, instruction, mode,
      context: { chapter: chapters.length === 1 ? chapters[0] : undefined, instruction, mentions: {} },
      dispatch, systemPrompt,
      onProgress: input.onProgress, emitArtifact,
      isCancelled: input.isCancelled, waitForApproval: input.waitForApproval,
      fallbackTools: scopedTools,
    });
    return { ...result, playbook: playbook.id, checkpointId: taskWrote(result) ? checkpointId : undefined };
  }

  // ── 3. Free agentic loop ─────────────────────────────────────────────
  session.runPlaybookRef = async (ref, chapter) => {
    const pb = resolvePlaybook(ref);
    if (!pb) return { error: `unknown playbook: ${ref}` };
    const r = await runPlaybook({
      playbook: pb, instruction, mode,
      context: { chapter, instruction, mentions: {} },
      dispatch, systemPrompt,
      onProgress: input.onProgress, emitArtifact,
      isCancelled: input.isCancelled, waitForApproval: input.waitForApproval,
      fallbackTools: scopedTools,
    });
    return { playbook: pb.id, stopReason: r.stopReason, steps: r.steps, answer: r.answer };
  };

  log.info('agent run — free loop', { mode, playbook: playbook?.id, chapters: chapters.length, checkpointId });
  const result = await runAgentLoop(instruction, generateWithTools, dispatch, systemPrompt, {
    mode,
    tools: scopedTools,
    onProgress: input.onProgress,
    isCancelled: input.isCancelled,
    waitForApproval: input.waitForApproval,
  });

  return { ...result, playbook: playbook?.id, checkpointId: taskWrote(result) ? checkpointId : undefined };
}

/** A keyword match is "strong" enough to run the playbook only if ≥ 2 hits. */
function playbookMatchIsStrong(ask: string, keywords: string[]): boolean {
  const lower = ask.toLowerCase();
  return keywords.reduce((n, k) => (lower.includes(k.toLowerCase()) ? n + 1 : n), 0) >= 2;
}

function taskWrote(result: AgentRunResult): boolean {
  return result.toolCalls.some(
    (c) =>
      (['insert_footnote', 'set_page_layout', 'run_task', 'draft_section', 'add_document_comment'].includes(c.name)
        && !(typeof c.result === 'object' && c.result && 'error' in c.result))
      || (c.name === 'install_template' && Boolean((c.args as { chapter?: unknown }).chapter)),
  );
}
