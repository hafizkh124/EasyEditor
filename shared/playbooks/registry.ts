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
  /**
   * When true, the runner repeats this step (a fresh scoped bind call each
   * time) for as long as there is another instance to handle — "footnote every
   * claim", "a rijāl note per narrator" — bounded by `runPlaybook`'s cap.
   */
  repeat?: boolean;
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
    id: 'audio-to-chapter',
    title: 'Turn a recorded lecture into a book chapter (درس سے باب)',
    trigger: 'audio-to-chapter',
    keywords: ['audio', 'lecture', 'recording', 'transcribe', 'درس', 'خطاب', 'ریکارڈنگ', 'آڈیو', 'تقریر', 'محاضرة'],
    guidance:
      'The scholar spoke this; your job is to turn speech into a book chapter without turning it into your own words. Keep every point, ruling and attribution the speaker made, in the order they made it unless a clearer order is obvious. Strip the artefacts of speech — false starts, repetitions, asides to the audience, "as I was saying". Where the speaker quoted a verse or hadith or cited a scholar, mark the place so it can be sourced afterwards; never supply from memory a reference the speaker did not give.',
    steps: [
      { tool: 'transcribe_media', bind: ['media_path'], note: 'Transcribe the recording with the local Whisper engine.' },
      { tool: 'create_chapter', bind: ['name', 'title', 'from_source'], note: 'Create the new chapter, seeded from the transcript.' },
      { tool: 'draft_section', args: { mode: 'literary-urdu' }, bind: ['chapter'], note: 'Recast the transcript into literary Urdu prose under headings.' },
      { tool: 'search_shamela', bind: ['query'], optional: true, repeat: true, note: 'Find the source for each text the speaker quoted.' },
      { tool: 'insert_footnote', bind: ['chapter', 'marker', 'source_id', 'claim'], optional: true, repeat: true, note: 'Footnote each quotation from its verified source.' },
    ],
  },
  {
    id: 'thematic-paper',
    title: 'Research and draft a thematic paper (موضوعاتی مقالہ)',
    trigger: 'thematic-paper',
    keywords: ['thematic', 'paper', 'research paper', 'مقالہ', 'موضوعاتی', 'تحقیقی مقالہ', 'بحث', 'دراسة'],
    guidance:
      'Build the paper from the sources outward, not from an opinion inward. Survey what the classical works and the corpus actually say on the topic before settling the outline, and let the structure follow the material. Attribute every position to the work that holds it. Where the sources disagree, present the disagreement rather than flattening it. Mark each sourced sentence so the citation can be attached.',
    steps: [
      { tool: 'search_corpus', bind: ['query'], repeat: true, note: 'Survey the personal corpus on the topic.' },
      { tool: 'search_shamela', bind: ['query'], repeat: true, note: 'Survey the classical works on the topic.' },
      { tool: 'create_chapter', bind: ['name', 'title'], note: 'Create the paper file.' },
      { tool: 'draft_section', args: { mode: 'outline' }, bind: ['chapter'], note: 'Lay out the structure the sources support.' },
      { tool: 'draft_section', args: { mode: 'prose' }, bind: ['chapter', 'section_heading', 'source_ids'], repeat: true, note: 'Draft each section from the retrieved sources.' },
      { tool: 'insert_footnote', bind: ['chapter', 'marker', 'source_id', 'claim'], repeat: true, note: 'Footnote each marked claim.' },
    ],
  },
  {
    id: 'analytical-column',
    title: 'Write an analytical column or essay (فکری مضمون)',
    trigger: 'analytical-column',
    keywords: ['column', 'essay', 'op-ed', 'کالم', 'مضمون', 'فکری', 'اخباری', 'مقال'],
    guidance:
      'This is a column, not a research paper: one clear line of thought, an opening that earns attention, and a close that lands. Eloquent but not florid. Analysis and general knowledge are yours to use; specific factual claims, statistics, quotations and rulings are not — those need a source or they do not go in. If you use a retrieved source, mark the sentence so it can be cited.',
    steps: [
      { tool: 'search_general', bind: ['query'], optional: true, note: 'Get background context on the subject.' },
      { tool: 'create_chapter', bind: ['name', 'title'], note: 'Create the column file.' },
      { tool: 'draft_section', args: { mode: 'column' }, bind: ['chapter'], note: 'Write the column.' },
    ],
  },
  {
    id: 'academic-translation',
    title: 'Translate a chapter with a consistent term base (اکیڈمک ترجمہ)',
    trigger: 'academic-translation',
    keywords: ['translate', 'translation', 'ترجمہ', 'ترجمة', 'مترجم', 'اکیڈمک ترجمہ'],
    guidance:
      'Translate as a scholar-translator: idiomatic in the target language, faithful to the source in meaning and register. Build a term base as you go and hold to it — one technical or religious term, one rendering, throughout. Qur\'anic verses and hadith keep their Arabic and take an established rendering; do not paraphrase them. Where a term is contested or left transliterated, mark a translator\'s note rather than deciding silently.',
    steps: [
      { tool: 'read_document', bind: ['chapter'], note: 'Read the source chapter.' },
      { tool: 'create_chapter', bind: ['name', 'title'], note: 'Create the translation file.' },
      { tool: 'draft_section', args: { mode: 'translation' }, bind: ['chapter', 'section_heading', 'source_ids'], repeat: true, note: 'Translate each section, holding the term base.' },
      { tool: 'check_consistency', bind: ['term'], optional: true, repeat: true, note: 'Check each key term is rendered consistently across the chapters.' },
    ],
  },
  {
    id: 'manuscript-takhreej',
    title: 'Verify and source the claims in a rough draft (تخريج)',
    trigger: 'manuscript-takhreej',
    keywords: ['takhreej', 'takhrij', 'تخریج', 'تحقیق', 'کچا مسودہ', 'مسودہ', 'حواشی', 'manuscript', 'draft verification', 'source the claims'],
    guidance:
      'Work as a muḥaqqiq: read the draft, identify every quotation, ruling, hadith and attribution, and for each one find the ORIGINAL source (its own book, volume, page) — never a secondary citation of it. Quote the wording exactly as the source has it and note any discrepancy. A hadith gets its collection, number and grade. Where you cannot find a supporting source, do not force one — add a margin comment saying what you searched and that the claim is unverified.',
    steps: [
      { tool: 'read_document', bind: ['chapter'], note: 'Read the draft and list every claim that needs a source.' },
      { tool: 'search_shamela', bind: ['query'], repeat: true, note: 'Retrieve the original classical source for each claim.' },
      { tool: 'search_hadith', bind: ['query'], optional: true, repeat: true, note: 'Retrieve the takhrīj + grade for each hadith claim.' },
      { tool: 'insert_footnote', bind: ['chapter', 'marker', 'source_id', 'claim'], repeat: true, note: 'Footnote each claim from its verified source.' },
      { tool: 'add_document_comment', bind: ['chapter', 'anchor_text', 'comment'], optional: true, repeat: true, note: 'Flag each claim that could not be sourced with a margin note.' },
    ],
  },
  {
    id: 'hadith-takhreej-advanced',
    title: 'Study a hadith chain — narrators and gradings (دراسة الأسانيد)',
    trigger: 'hadith-takhreej-advanced',
    keywords: ['isnad', 'sanad', 'اسناد', 'سند', 'دراسۃ الاسانید', 'دراسة الأسانيد', 'راوی', 'رواة', 'جرح', 'تعدیل', 'chain', 'narrator', 'rijal'],
    guidance:
      'Study the isnād as a muḥaddith: establish the base narration and every collection that reports it. For each narrator, consult the rijāl works for the verdicts of the imams of jarḥ wa taʿdīl, noting who said what. Distinguish a defect in the chain (inqiṭāʿ, tadlīs, a weak narrator) from a sound one. Conclude with a clear grade for the isnād and the wording of the hadith, resting every judgement on a retrieved source.',
    steps: [
      { tool: 'search_hadith', bind: ['query'], note: 'Establish the narration and the collections that report it.' },
      { tool: 'search_shamela', bind: ['query'], repeat: true, note: 'Consult the rijāl works for each narrator in the chain.' },
      { tool: 'add_document_comment', bind: ['chapter', 'anchor_text', 'comment'], optional: true, repeat: true, note: 'Record the jarḥ/taʿdīl verdict for each narrator as a margin note.' },
      { tool: 'insert_footnote', bind: ['chapter', 'marker', 'source_id'], optional: true, note: 'Footnote the grading with its source.' },
    ],
  },
  {
    id: 'supervisor-audit',
    title: "Audit a chapter the way a thesis supervisor would (never edits the text)",
    trigger: 'supervisor-audit',
    keywords: ['supervisor', 'audit', 'نظرثانی', 'نگران', 'جانچ', 'تنقیدی', 'review my chapter', 'review thesis', 'مراجعة', 'تقييم'],
    guidance:
      'Audit like a supervisor, and NEVER change the text — every finding is a margin comment. Check: (1) structure — is the argument ordered and each section doing its job; (2) sourcing — is every quotation, ruling and hadith footnoted, and does the footnote actually support the sentence; (3) terminology — is each key term used consistently (use check_consistency); (4) proportion — is any section mostly quotation with little of the author\'s own analysis; (5) language register. Be specific and constructive; point to the exact passage.',
    steps: [
      { tool: 'read_document', bind: ['chapter'], note: 'Read the chapter — structure, footnotes, tracked-change count.' },
      { tool: 'check_consistency', bind: ['term'], optional: true, repeat: true, note: 'Check where each key term is also used, for consistency.' },
      { tool: 'add_document_comment', bind: ['chapter', 'anchor_text', 'comment'], repeat: true, note: 'Leave each finding as a margin comment on the exact passage.' },
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
