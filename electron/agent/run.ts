/**
 * M8 Layer 6 — the agent run orchestrator (SPEC-M8 §3, ADR-0016).
 *
 * Builds the system prompt (this machine's capabilities + the project's
 * `قواعد.md` rules), runs the loop against Gemini function-calling and the
 * real dispatcher, and records the full transcript so the Trust tab shows
 * every tool call and every source — exactly as the existing single-task
 * runs already do (ADR-0016 control 4).
 *
 * One agent task runs at a time (ADR-0019 item 6, rejected: parallel tasks) —
 * enforced by ./queue.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../lib/logger.js';
import { detectTools } from '../host/index.js';
import { refreshChapters } from '../fs/projectFolder.js';
import { generateWithTools } from './geminiTools.js';
import { createDispatcher } from './dispatch.js';
import { checkClaim } from './claimCheck.js';
import { beginCheckpoint } from './checkpoint.js';
import { toolsForMode } from '../../shared/agent/toolSchemas.js';
import { runAgentLoop } from '../../shared/agent/loop.js';
import { buildSystemPrompt } from '../../shared/agent/systemPrompt.js';
import { selectPlaybook } from '../../shared/playbooks/registry.js';
import type { AgentProgress, AgentRunResult } from '../../shared/agent/types.js';

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
  mode: 'ask' | 'do';
  projectRoot: string;
  onProgress?: (p: AgentProgress) => void;
  isCancelled?: () => boolean;
}

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult & { playbook?: string; checkpointId?: string }> {
  const { instruction, mode, projectRoot } = input;

  const caps = detectTools();
  const chapters = (() => {
    try { return refreshChapters(projectRoot).map((c) => c.name); } catch { return []; }
  })();
  const rules = readProjectRules(projectRoot);
  const playbook = selectPlaybook(instruction);

  const systemPrompt =
    buildSystemPrompt({ mode, capabilities: { ...caps }, projectRules: rules, chapters }) +
    (playbook
      ? `\n\nA playbook fits this request — "${playbook.title}". Its usual steps:\n` +
        playbook.steps.map((s, i) => `  ${i + 1}. ${s.note}`).join('\n') +
        '\nFollow it where it applies; adapt to what you find in the files.'
      : '');

  // A "Do" task may edit files — open a checkpoint so it can be undone as one
  // unit (ADR-0019 item 5). "Ask" mode never writes, so no checkpoint.
  const canWrite = toolsForMode(mode).some((t) => t.effect === 'write');
  const checkpointId = canWrite ? beginCheckpoint(projectRoot, instruction) : undefined;

  const { dispatch } = createDispatcher({ projectRoot, checkpointId, claimCheck: checkClaim });

  log.info('agent run starting', { mode, playbook: playbook?.id, chapters: chapters.length, checkpointId });
  const result = await runAgentLoop(instruction, generateWithTools, dispatch, systemPrompt, {
    mode,
    onProgress: input.onProgress,
    isCancelled: input.isCancelled,
  });

  // Keep the checkpoint only if it actually snapshotted something.
  const wrote = result.toolCalls.some((c) => ['insert_footnote', 'set_page_layout'].includes(c.name));
  return { ...result, playbook: playbook?.id, checkpointId: wrote ? checkpointId : undefined };
}
