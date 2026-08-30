/**
 * M8 Layer 4 — the playbook registry (SPEC-M8 §3, ADR-0019 item 5).
 *
 * A playbook is "how a skilled human does this task", as data — an ordered
 * list of the agent's own tool calls. The agent does not invent a procedure,
 * it SELECTS one. Adding a playbook is one entry here, not code.
 *
 * Pure — no runtime globals.
 */

export interface PlaybookStep {
  /** A tool name from shared/agent/toolSchemas.ts. */
  tool: string;
  /** Partial args to seed the call — the agent fills the rest from context. */
  args?: Record<string, unknown>;
  /** One line shown in the plan preview. */
  note: string;
}

export interface Playbook {
  id: string;
  title: string;
  /** When the agent should reach for this — matched loosely against the ask. */
  keywords: string[];
  steps: PlaybookStep[];
}

export const PLAYBOOKS: Playbook[] = [
  {
    id: 'thesis-university-format',
    title: 'Prepare a chapter in university thesis format',
    keywords: ['thesis', 'university', 'format', 'مقالہ', 'یونیورسٹی', 'جامعہ', 'رسالہ'],
    steps: [
      { tool: 'read_document', note: 'Read the chapter to see its current structure.' },
      { tool: 'set_page_layout', note: 'Apply the RTL page setup (margins + reading order).' },
      { tool: 'run_task', args: { task: 'auto-format' }, note: 'Normalise headings and spacing.' },
      { tool: 'run_task', args: { task: 'citations' }, note: 'Mark citation positions.' },
      { tool: 'insert_footnote', note: 'Turn each retrieved citation into a real footnote.' },
      { tool: 'convert_document', args: { to: 'pdf' }, note: 'Produce the submission PDF from the .docx.' },
    ],
  },
  {
    id: 'add-verified-citations',
    title: 'Add verified footnotes to a chapter',
    keywords: ['citation', 'footnote', 'reference', 'حوالہ', 'حاشیہ', 'مراجع'],
    steps: [
      { tool: 'read_document', note: 'Read the chapter and find the claims that need sourcing.' },
      { tool: 'search_corpus', note: 'Retrieve a page-precise source for each claim.' },
      { tool: 'insert_footnote', note: 'Insert each source as a tracked-change footnote at its marker.' },
    ],
  },
  {
    id: 'harmonise-transliteration',
    title: 'Harmonise transliteration and diacritics across a chapter',
    keywords: ['transliteration', 'harakat', 'diacritics', 'tashkeel', 'اعراب', 'حرکات', 'املا'],
    steps: [
      { tool: 'read_document', note: 'Read the chapter.' },
      { tool: 'run_task', args: { task: 'harakat' }, note: 'Apply consistent diacritics as a tracked change.' },
      { tool: 'run_task', args: { task: 'normalize' }, note: 'Normalise spelling variants.' },
    ],
  },
];

const BY_ID = new Map(PLAYBOOKS.map((p) => [p.id, p]));

export function getPlaybook(id: string): Playbook | undefined {
  return BY_ID.get(id);
}

/**
 * Best-effort match of a free-text ask to a playbook, by keyword hit count.
 * Returns null when nothing matches — the agent then just works step by step.
 */
export function selectPlaybook(ask: string): Playbook | null {
  const lower = ask.toLowerCase();
  let best: { p: Playbook; hits: number } | null = null;
  for (const p of PLAYBOOKS) {
    const hits = p.keywords.reduce((n, k) => (lower.includes(k.toLowerCase()) ? n + 1 : n), 0);
    if (hits > 0 && (!best || hits > best.hits)) best = { p, hits };
  }
  return best?.p ?? null;
}
