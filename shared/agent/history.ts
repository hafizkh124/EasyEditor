/**
 * M11 Phase 1 — prior-conversation context for the agent.
 *
 * `runAgentLoop` (loop.ts) starts every run cold: `messages` is seeded with
 * just the current instruction, and the transcript is thrown away when the run
 * returns. So a follow-up question ("open the third point in that") reaches the
 * model with no idea what "that" was. This module turns the renderer's list of
 * finished turns into the `AgentMessage[]` the loop prepends.
 *
 * SAFETY — this emits ONLY `user` and plain-text `model` messages, never a
 * `tool` message or a `model` toolCall. The wire formats
 * (openAiCompatWire.toOpenAiMessages, geminiTools.toContents) pair each `tool`
 * message with the `tool_call` id of the assistant message immediately before
 * it; a prior-run `tool` message arriving without that pairing makes strict
 * OpenAI-compatible providers reject the request (HTTP 400). Tool traffic
 * stays inside the run that produced it — the model still sees what it
 * concluded last turn, just not the raw tool plumbing.
 *
 * Pure — shared/ is imported by both the Electron main process and the
 * renderer; no runtime globals.
 */
import type { AgentMessage } from './types.js';

/** One finished exchange in the conversation the renderer is tracking. */
export interface ConversationTurn {
  /** The user's message, verbatim. */
  instruction: string;
  /** The agent's final answer — or the clarifying question it stopped on. */
  answer: string;
}

/** Recent turns kept in full; older ones collapse to a one-line stub. */
const KEEP_VERBATIM = 6;
/** A verbatim answer is trimmed to this so a long run does not dominate the window. */
const VERBATIM_ANSWER_CHARS = 1500;
/** Older (stubbed) turns are trimmed to this on both sides. */
const STUB_CHARS = 220;

function squish(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Build the prior-conversation messages to seed a fresh agent run.
 *
 * The last `keepVerbatim` turns are kept close to verbatim (the answer capped
 * at {@link VERBATIM_ANSWER_CHARS}); anything older is reduced to a short stub,
 * mirroring loop.ts's own `stubToolResult` approach so the window stays bounded
 * over a long session. An empty / absent list yields `[]` — a cold run, exactly
 * as before this module existed.
 */
export function buildHistory(
  turns: ConversationTurn[],
  opts: { keepVerbatim?: number } = {},
): AgentMessage[] {
  const keep = Math.max(0, opts.keepVerbatim ?? KEEP_VERBATIM);
  const clean = turns
    .map((t) => ({ instruction: squish(t.instruction), answer: squish(t.answer) }))
    .filter((t) => t.instruction || t.answer);

  const firstVerbatim = Math.max(0, clean.length - keep);
  const out: AgentMessage[] = [];

  clean.forEach((t, i) => {
    const verbatim = i >= firstVerbatim;
    const q = verbatim ? t.instruction : t.instruction.slice(0, STUB_CHARS);
    if (q) out.push({ role: 'user', text: q });
    if (t.answer) {
      const a = verbatim
        ? t.answer.slice(0, VERBATIM_ANSWER_CHARS)
        : `(خلاصہ) ${t.answer.slice(0, STUB_CHARS)}`;
      out.push({ role: 'model', text: a });
    }
  });

  return out;
}
