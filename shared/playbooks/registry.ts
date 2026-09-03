/**
 * M8 Layer 4 — the playbook registry (SPEC-M8 §3, ADR-0019 item 5).
 *
 * A playbook is "how a skilled human does this task", as data — an ordered
 * list of the agent's own tool calls. The agent does not invent a procedure,
 * it SELECTS one. Adding a playbook is one entry here, not code.
 *
 * M9 (ADR-0020): playbooks are now EXECUTED, not just seeded as advice. A step
 * with fully-specified `args` runs with no model call; a step with `bind` names
 * gets a scoped single-tool model call to fill those args (see
 * shared/playbooks/executor.ts + electron/agent/runPlaybook.ts).
 *
 * Pure — no runtime globals.
 */

export interface PlaybookStep {
  /** A tool name from shared/agent/toolSchemas.ts. */
  tool: string;
  /** Partial args to seed the call — the agent fills the rest from context. */
  args?: Record<string, unknown>;
  /**
   * Arg names the executor must resolve per-run via a scoped single-tool model
   * call (the model sees only this tool and must return exactly this call).
   */
  bind?: string[];
  /** When true, a precondition failure skips the step rather than failing the run. */
  optional?: boolean;
  /** One line shown in the plan preview. */
  note: string;
}

export interface Playbook {
  id: string;
  title: string;
  /** The slash command that selects this playbook exactly (no leading `/`). */
  trigger?: string;
  /** When the agent should reach for this — matched loosely against the ask. */
  keywords: string[];
  /**
   * Domain prose appended to the system prompt ONLY for this playbook's run
   * (ADR-0024: "skills = playbooks + guidance"). Distinct from قواعد.md, which
   * always holds.
   */
  guidance?: string;
  steps: PlaybookStep[];
}

export const PLAYBOOKS: Playbook[] = [
  {
    id: 'thesis-university-format',
    title: 'Prepare a chapter in university thesis format',
    trigger: 'thesis-format',
    keywords: ['thesis', 'university', 'format', 'مقالہ', 'یونیورسٹی', 'جامعہ', 'رسالہ'],
    steps: [
      { tool: 'read_document', bind: ['chapter'], note: 'Read the chapter to see its current structure.' },
      { tool: 'set_page_layout', bind: ['chapter'], note: 'Apply the RTL page setup (margins + reading order).' },
      { tool: 'run_task', args: { task: 'auto-format' }, bind: ['chapter'], note: 'Normalise headings and spacing.' },
      { tool: 'search_corpus', bind: ['query'], optional: true, note: 'Retrieve a page-precise source for each claim that needs one.' },
      { tool: 'insert_footnote', bind: ['chapter', 'marker', 'source_id'], optional: true, note: 'Turn each retrieved source into a real footnote.' },
      { tool: 'convert_document', args: { to: 'pdf' }, bind: ['chapter'], note: 'Produce the submission PDF from the .docx.' },
    ],
  },
  {
    id: 'add-verified-citations',
    title: 'Add verified footnotes to a chapter',
    trigger: 'add-citations',
    keywords: ['citation', 'footnote', 'reference', 'حوالہ', 'حاشیہ', 'مراجع'],
    steps: [
      { tool: 'read_document', bind: ['chapter'], note: 'Read the chapter and find the claims that need sourcing.' },
      { tool: 'search_corpus', bind: ['query'], note: 'Retrieve a page-precise source for each claim.' },
      { tool: 'insert_footnote', bind: ['chapter', 'marker', 'source_id'], note: 'Insert each source as a tracked-change footnote at its marker.' },
    ],
  },
  {
    id: 'harmonise-transliteration',
    title: 'Harmonise transliteration and diacritics across a chapter',
    trigger: 'harmonise-transliteration',
    keywords: ['transliteration', 'harakat', 'diacritics', 'tashkeel', 'اعراب', 'حرکات', 'املا'],
    steps: [
      { tool: 'read_document', bind: ['chapter'], note: 'Read the chapter.' },
      { tool: 'run_task', args: { task: 'harakat' }, bind: ['chapter'], note: 'Apply consistent diacritics as a tracked change.' },
      { tool: 'run_task', args: { task: 'normalize' }, bind: ['chapter'], note: 'Normalise spelling variants.' },
    ],
  },
  {
    id: 'submission-pdf',
    title: 'Produce the submission PDF for a chapter',
    trigger: 'submission-pdf',
    keywords: ['submission', 'submit', 'final pdf', 'export pdf', 'جمع', 'پی ڈی ایف', 'برآمد'],
    steps: [
      { tool: 'read_document', bind: ['chapter'], note: 'Read the chapter to see its structure.' },
      { tool: 'set_page_layout', bind: ['chapter'], note: 'Apply the RTL page setup.' },
      { tool: 'run_task', args: { task: 'auto-format' }, bind: ['chapter'], note: 'Normalise headings and spacing.' },
      { tool: 'insert_footnote', bind: ['chapter', 'marker', 'source_id'], optional: true, note: 'Turn each retrieved citation into a real footnote.' },
      { tool: 'convert_document', args: { to: 'pdf' }, bind: ['chapter'], note: 'Export the submission PDF from the .docx.' },
    ],
  },
  {
    id: 'apply-supervisor-template',
    title: "Apply a supervisor's Word template to a chapter",
    trigger: 'apply-template',
    keywords: ['template', 'supervisor', 'dotx', 'style sheet', 'ٹیمپلیٹ', 'نگران', 'قالب'],
    steps: [
      { tool: 'install_template', bind: ['template_path', 'chapter'], note: "Install the supervisor's .dotx and attach it to the chapter (tracked change)." },
      { tool: 'set_page_layout', bind: ['chapter'], note: 'Re-apply the RTL page setup after the template.' },
      { tool: 'run_task', args: { task: 'auto-format' }, bind: ['chapter'], note: 'Re-flow headings against the new styles.' },
    ],
  },
  {
    id: 'section-summaries',
    title: 'Add a summary for every section of a chapter',
    trigger: 'section-summaries',
    keywords: ['section summaries', 'summarize sections', 'abstract', 'خلاصہ', 'ابواب کا خلاصہ', 'عناوین کا خلاصہ'],
    steps: [
      { tool: 'read_document', bind: ['chapter'], note: 'Read the chapter and list its sections.' },
      { tool: 'run_task', args: { task: 'section-summaries' }, bind: ['chapter'], note: 'Append a short summary under each heading (tracked change).' },
    ],
  },
  {
    id: 'shariah-fatwa',
    title: 'Draft a sourced answer to a fiqh / istiftāʾ question',
    trigger: 'shariah-fatwa',
    keywords: ['fatwa', 'istifta', 'فتویٰ', 'فتوى', 'استفتاء', 'شرعی سوال', 'حکم شرعی', 'مسئلہ', 'نازلہ', 'ruling'],
    guidance:
      'Follow the classical istiftāʾ method: (1) restate the question precisely and note any ambiguity; ' +
      '(2) establish the relevant Qur\'anic evidence via query_tafseer; (3) establish the hadith evidence via ' +
      'search_hadith, noting each narration\'s grade; (4) survey the positions of the four madhāhib and any ' +
      'contemporary academy ruling via search_shamela / search_general; (5) give a measured conclusion that ' +
      'names the stronger view and its evidence, without overstating certainty. Every ruling attributed to a ' +
      'madhhab or scholar must rest on a retrieved source; where the sources are silent, say so.',
    steps: [
      { tool: 'query_tafseer', bind: ['reference', 'mode'], optional: true, note: 'Retrieve the relevant āyah(s) and their tafsīr.' },
      { tool: 'search_hadith', bind: ['query'], optional: true, note: 'Retrieve the relevant hadith, with grades.' },
      { tool: 'search_shamela', bind: ['query'], note: 'Survey the fiqh positions in the classical works.' },
      { tool: 'draft_section', args: { mode: 'outline' }, bind: ['chapter', 'section_heading'], optional: true, note: 'Lay out the 5-stage answer as a sourced outline in the chapter.' },
    ],
  },
  {
    id: 'install-nastaliq-font',
    title: 'Install a Nastaliq font and make it usable in Word',
    trigger: 'install-font',
    keywords: ['font', 'nastaliq', 'nastaleeq', 'jameel', 'noori', 'فونٹ', 'نستعلیق'],
    steps: [
      { tool: 'list_capabilities', note: 'Check whether Word is available on this machine.' },
      { tool: 'install_font', bind: ['font_path'], note: 'Install the font file the scholar pointed at, and verify Word sees it.' },
    ],
  },
];

const BY_ID = new Map(PLAYBOOKS.map((p) => [p.id, p]));
const BY_TRIGGER = new Map(PLAYBOOKS.filter((p) => p.trigger).map((p) => [p.trigger!, p]));

export function getPlaybook(id: string): Playbook | undefined {
  return BY_ID.get(id);
}

/** Resolve a `/trigger` or an id to a playbook. */
export function resolvePlaybook(ref: string): Playbook | undefined {
  const clean = ref.trim().replace(/^\//, '');
  return BY_TRIGGER.get(clean) ?? BY_ID.get(clean);
}

/**
 * Best-effort match of a free-text ask to a playbook.
 *
 * An exact leading `/trigger` wins outright (M9). Otherwise fall back to the
 * keyword-hit count; returns null when nothing matches — the agent then just
 * works step by step.
 */
export function selectPlaybook(ask: string): Playbook | null {
  const trimmed = ask.trim();
  if (trimmed.startsWith('/')) {
    const token = trimmed.slice(1).split(/\s/)[0];
    const exact = BY_TRIGGER.get(token) ?? BY_ID.get(token);
    if (exact) return exact;
  }

  const lower = trimmed.toLowerCase();
  let best: { p: Playbook; hits: number } | null = null;
  for (const p of PLAYBOOKS) {
    const hits = p.keywords.reduce((n, k) => (lower.includes(k.toLowerCase()) ? n + 1 : n), 0);
    if (hits > 0 && (!best || hits > best.hits)) best = { p, hits };
  }
  return best?.p ?? null;
}
