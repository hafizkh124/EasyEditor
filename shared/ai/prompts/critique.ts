/**
 * M9 Phase C/E — the fixed instructions for the reasoning-model CRITIC.
 *
 * §4 of the blueprint review: a reasoning model (DeepSeek-R1, Qwen 3) is a poor
 * tool-caller but a strong critic. So it never drives the loop — it is handed a
 * finished plan / draft / takhrīj as plain text and asked to scrutinise it, the
 * way a muḥaqqiq or a thesis supervisor would. Its output is ADVISORY: it lands
 * as an artifact or a margin comment, never as an edit.
 *
 * Same discipline as draftSection.ts / indexEntries.ts — a CLOSED `kind` set,
 * the caller never writes the prompt. Pure — no runtime globals.
 */

export type CritiqueKind = 'plan' | 'draft' | 'argument' | 'takhrij' | 'sourcing';

export const CRITIQUE_KINDS: CritiqueKind[] = ['plan', 'draft', 'argument', 'takhrij', 'sourcing'];

const COMMON = `You are a rigorous scholarly critic — a muḥaqqiq reviewing a colleague's work before it is published. Be specific and constructive. Point to the exact place. Do NOT rewrite anything and do NOT be agreeable for its own sake — your value is catching what the author missed.

Output plain prose in the working language, in this shape:
• الحكم / Verdict: one line — is this sound as it stands, sound with fixes, or not yet sound.
• ما يصح / Holds up: 1–3 points that are genuinely well done (skip if none).
• الإشكالات / Problems: a numbered list — each: what is wrong, where, and why it matters.
• الفجوات / Gaps: what is missing that a careful reader would expect.
No preamble, no markdown headers, no "As an AI".`;

const KIND_RULE: Record<CritiqueKind, string> = {
  plan:
    'You are given a PLAN the agent proposes to run on a scholarly document. Judge it BEFORE it executes: will these steps actually achieve the stated task? Is the order right? Is a step missing (e.g. retrieving sources before drafting, checking consistency after a term change)? Is any step likely to damage the text or over-reach what was asked?',
  draft:
    'You are given a DRAFTED section of a book chapter and the source excerpts it was built from. Check: does every factual claim, ruling, quotation and attribution actually rest on the excerpts (flag anything that reads like it came from memory)? Is a bare [n] marker on each sentence that needs one? Is the argument connected, or a string of quotations with little analysis? Is the register right for a scholarly book?',
  argument:
    'You are given a passage making an argument. Check the logic: are the premises stated, do they support the conclusion, are there unstated leaps, is a counter-argument or an opposing view ignored, is a term used in two senses?',
  takhrij:
    'You are given a takhrīj / isnād analysis. Check it as a muḥaddith: is every narration attributed to a specific collection and number, is the grading stated and consistent with the ʿilm al-rijāl, are the chains actually traced or just asserted, is a weak report presented as if established?',
  sourcing:
    'You are given a chapter and its footnotes. Check the sourcing only: is every quotation, ruling and hadith footnoted; does each footnote actually support the sentence it hangs on; is any claim that needs a source left bare; is search_general (never page-precise) used where a citable source was needed?',
};

export function buildCritiqueInstruction(kind: CritiqueKind, focus?: string): string {
  return `${COMMON}\n\n${KIND_RULE[kind]}${focus ? `\n\nThe author especially wants your view on: ${focus}` : ''}`;
}

/** The user-content block: the subject text, plus any context the critic needs. */
export function buildCritiqueInput(opts: { subject: string; context?: string; sources?: string }): string {
  const parts: string[] = [];
  if (opts.context) parts.push(`CONTEXT:\n${opts.context}`);
  if (opts.sources) parts.push(`SOURCE EXCERPTS THE WORK RESTS ON:\n${opts.sources}`);
  parts.push(`THE WORK TO CRITIQUE:\n${opts.subject}`);
  return parts.join('\n\n');
}
