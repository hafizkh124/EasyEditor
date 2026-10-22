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
      { tool: 'set_page_layout', bind: ['chapter'], note: 'Apply the RTL page setup (reading order).' },
      // M12 Phase E — wires the previously-orphaned layoutPresets.ts in:
      // set_page_layout only sets RTL reading order, never margins/line
      // spacing, so this adds a real A4 essay layout on top of it.
      { tool: 'typeset_print_ready', args: { preset: 'a4-essay' }, bind: ['chapter'], note: 'Apply A4 margins and line spacing for a standard submission layout.' },
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
    id: 'typeset-print',
    title: 'Prepare a chapter for the press (پرنٹ ریڈی کمپوزنگ)',
    trigger: 'typeset-print',
    keywords: ['typeset', 'print', 'press', 'کمپوزنگ', 'پرنٹ', 'اشاعت', 'گٹر', 'gutter', 'trim', 'کتابت', 'تنضيد', 'طباعة'],
    guidance:
      'Prepare the chapter for a print run through Word\'s own engine — a print-ready Word layout, not press typesetting. Set the trim size, a binding gutter, mirrored margins for two-sided printing, and running heads (the book title on the verso, the chapter title on the recto). Then compile the indexes and export the PDF. Tell the scholar plainly what Word does NOT do (kerning tables, PDF/X, fine line-breaking) so they review the PDF before it goes to the press.',
    steps: [
      { tool: 'set_page_layout', bind: ['chapter'], note: 'Apply the RTL page setup first.' },
      { tool: 'typeset_print_ready', bind: ['chapter', 'trim', 'header_odd', 'header_even'], note: 'Apply the trim size, gutter, mirrored margins and running heads.' },
      { tool: 'build_scholarly_indexes', args: { kinds: ['quran', 'hadith', 'names'] }, bind: ['chapter'], optional: true, note: 'Compile the back-matter indexes.' },
      { tool: 'convert_document', args: { to: 'pdf' }, bind: ['chapter'], note: 'Export the press PDF.' },
    ],
  },
  {
    id: 'synopsis-design',
    title: 'Design a research synopsis for approval (خاکہ / سیناپسز)',
    trigger: 'synopsis-design',
    keywords: ['synopsis', 'proposal', 'خاکہ', 'سیناپسز', 'پروپوزل', 'research proposal', 'مقالے کا خاکہ', 'خطة بحث'],
    guidance:
      'Design a university-standard synopsis from the source chapter or notes: the research problem and its significance, the questions and hypotheses, a survey of prior work and the gap this fills, the proposed chapter breakdown, and the method and sources. Keep it tight — a synopsis is a case for approval, not the thesis. Draft it as a summary of what the material establishes; do not invent findings the research has not produced yet.',
    steps: [
      { tool: 'read_document', bind: ['chapter'], note: 'Read the source chapter or notes.' },
      { tool: 'create_chapter', bind: ['name', 'title'], note: 'Create the synopsis file.' },
      { tool: 'draft_section', args: { mode: 'summary' }, bind: ['chapter'], note: 'Draft the synopsis (problem, questions, gap, chapter plan, method).' },
      { tool: 'typeset_print_ready', args: { trim: 'a5' }, bind: ['chapter'], optional: true, note: 'Apply an A5 layout.' },
      { tool: 'convert_document', args: { to: 'pdf' }, bind: ['chapter'], optional: true, note: 'Export the PDF for submission.' },
    ],
  },
  {
    id: 'manuscript-edition',
    title: 'Collate manuscript witnesses into a critical edition (تحقيق مخطوط)',
    trigger: 'manuscript-edition',
    keywords: ['critical edition', 'manuscript', 'مخطوط', 'مخطوطة', 'تحقيق', 'نسخ', 'فروق النسخ', 'apparatus', 'collate', 'witness', 'تدوین', 'نسخہ'],
    guidance:
      'Prepare a تنقیدی نسخہ (critical edition). Take one witness as the الأصل (base) and collate each other witness against it. For every locus of variation decide what belongs in the established text and record the rejected reading in the apparatus (فروق النسخ) — as a footnote at that point, keyed by siglum. Note where a witness adds, omits, or garbles. Do not silently emend; every editorial decision is visible in the apparatus. When the collation is done, build the scholarly indexes.',
    steps: [
      { tool: 'read_document', bind: ['chapter'], note: 'Read the base manuscript.' },
      { tool: 'compare_manuscript_variants', bind: ['base_chapter', 'witness_chapter', 'siglum'], repeat: true, note: 'Collate each witness against the base.' },
      { tool: 'insert_footnote', bind: ['chapter', 'marker', 'source_id'], optional: true, repeat: true, note: 'Record each variant reading as a فروق النسخ footnote.' },
      { tool: 'add_document_comment', bind: ['chapter', 'anchor_text', 'comment'], optional: true, repeat: true, note: 'Comment where a reading is doubtful or an emendation is proposed.' },
      { tool: 'build_scholarly_indexes', args: { kinds: ['quran', 'hadith', 'names'] }, bind: ['chapter'], optional: true, note: 'Build the verse / hadith / names indexes.' },
    ],
  },
  {
    id: 'generate-indexes',
    title: 'Build the back-matter indexes for a chapter or book (فہارس)',
    trigger: 'generate-indexes',
    keywords: ['index', 'indexes', 'indices', 'فہرست', 'فہارس', 'اشاریہ', 'فهرس', 'فهارس', 'أعلام', 'back matter'],
    guidance:
      'Build the scholarly فہارس. Index the Qur\'anic verses and hadith that are actually quoted or cited, the names of people and places that the chapter says something about, and the technical terms it defines or discusses substantively — not every passing mention. Each entry\'s locator phrase must occur verbatim in the text so Word can mark it.',
    steps: [
      { tool: 'read_document', bind: ['chapter'], note: 'Read the chapter to see what it covers.' },
      { tool: 'build_scholarly_indexes', bind: ['chapter', 'kinds', 'heading'], note: 'Extract entries for the requested kinds and compile the INDEX.' },
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
      { tool: 'search_repositories', bind: ['query'], optional: true, note: 'Find modern scholarship on the topic (if the repositories connector is on).' },
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
      { tool: 'verify_citation', bind: ['source_id', 'book', 'volume', 'page', 'number', 'grade', 'graded_by'], optional: true, repeat: true, note: 'Check each cited detail against its retrieved source.' },
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
      { tool: 'critique', args: { kind: 'sourcing' }, bind: ['chapter'], optional: true, note: 'Get a reasoning model\'s critical review of the argument and sourcing.' },
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
      {
        tool: 'draft_section',
        args: { mode: 'fatwa' },
        bind: ['chapter', 'section_heading', 'question'],
        optional: true,
        note: 'Write the 5-stage answer as the ruling section of a formal fatwā document (M12 Phase E template — bismillah, the question, the ruling, signature lines).',
      },
      { tool: 'typeset_print_ready', args: { preset: 'fatwa' }, bind: ['chapter'], optional: true, note: 'Apply the fatwā letterhead page layout (A4, formal margins).' },
      { tool: 'convert_document', args: { to: 'pdf' }, bind: ['chapter'], optional: true, note: 'Export the finished fatwā as a PDF.' },
    ],
  },
  {
    // M12 Phase C — the zakat compute engine (ADR-0048). `draft_section` uses
    // 'outline' for now — Phase E adds a dedicated `mode: 'fatwa'` template.
    id: 'zakat-assessment-workflow',
    title: 'Assess and calculate zakat due (زکوٰۃ کا حساب)',
    trigger: 'zakat',
    keywords: ['zakat', 'zakah', 'nisab', 'زکوٰۃ', 'زکاۃ', 'زكاة', 'نصاب', 'حول', 'صدقۃ الفطر', 'فطرانہ'],
    guidance:
      'Assemble every declared asset, liability, and metal price into ONE calculate_zakat call — never split it across several calls, and never estimate a missing price yourself; ask the scholar for it instead. State which jewelleryRuling was applied and why, and which silver nisāb standard was used. Present the tool\'s figures exactly as returned; the model never re-derives or "checks" the arithmetic. Ground the 2.5% rate and the nisāb rule in query_tafseer/search_hadith when the scholar wants the underlying dalīl, not as a substitute for the calculation itself.',
    steps: [
      { tool: 'calculate_zakat', bind: ['input'], note: 'Compute the zakat due from the assets, liabilities, and prices given.' },
      { tool: 'query_tafseer', args: { reference: '9:103', mode: 'tafsir' }, optional: true, note: 'Retrieve the zakat āyah (9:103) and its tafsīr for the dalīl.' },
      { tool: 'search_hadith', bind: ['query'], optional: true, note: 'Retrieve the supporting hadith (e.g. nisāb thresholds) with grades.' },
      {
        tool: 'draft_section',
        args: { mode: 'fatwa' },
        bind: ['chapter', 'section_heading', 'question', 'result_json'],
        optional: true,
        note: "Write the fatwā's ruling discussion; the template wraps it around the calculate_zakat result verbatim (result_json = that call's own JSON, copied through, never re-typed).",
      },
      { tool: 'typeset_print_ready', args: { preset: 'fatwa' }, bind: ['chapter'], optional: true, note: 'Apply the fatwā letterhead page layout (A4, formal margins).' },
      { tool: 'convert_document', args: { to: 'pdf' }, bind: ['chapter'], optional: true, note: 'Export the finished fatwā as a PDF.' },
    ],
  },
  {
    // M12 Phase B/C — the from-scratch Jumhūr fara'id engine.
    id: 'faraid-fatwa-workflow',
    title: "Calculate inheritance (farā'iḍ) shares (وراثت کا حساب)",
    trigger: 'faraid',
    keywords: ['inheritance', 'faraid', "fara'id", 'faraaid', 'estate share', 'heirs share', 'وراثت', 'میراث', 'ترکہ', 'فرائض', 'مواریث', 'عصبہ'],
    guidance:
      'First identify and confirm every heir the scholar names, mapped onto the engine\'s closed heir-type list — ask if a relationship is ambiguous rather than guessing. Pass the whole heir set to ONE calculate_faraid call; never compute a share by hand. Present the result in a dignified fatwā style: each heir\'s share alongside its Qur\'anic dalīl (4:11–12, 4:176) and rule reference, exactly as the tool returns them, followed by the non-fatwā disclaimer. A distant-kindred (ذوو الأرحام) case the tool cannot resolve must be said plainly, not guessed at.',
    steps: [
      { tool: 'calculate_faraid', bind: ['input'], note: "Compute each heir's share from the confirmed heir set." },
      { tool: 'query_tafseer', args: { reference: '4:11', mode: 'tafsir' }, optional: true, note: 'Retrieve the primary inheritance āyah (4:11) and its tafsīr for the dalīl.' },
      { tool: 'search_shamela', bind: ['query'], optional: true, note: "Survey the madhāhib's positions on any special case (e.g. الجد مع الإخوة) in the classical works." },
      {
        tool: 'draft_section',
        args: { mode: 'fatwa' },
        bind: ['chapter', 'section_heading', 'question', 'result_json'],
        optional: true,
        note: "Write the fatwā's ruling discussion; the template wraps it around the calculate_faraid result verbatim (result_json = that call's own JSON, copied through, never re-typed).",
      },
      { tool: 'typeset_print_ready', args: { preset: 'fatwa' }, bind: ['chapter'], optional: true, note: 'Apply the fatwā letterhead page layout (A4, formal margins).' },
      { tool: 'convert_document', args: { to: 'pdf' }, bind: ['chapter'], optional: true, note: 'Export the finished fatwā as a PDF.' },
    ],
  },
  {
    id: 'digitize-book',
    title: 'Digitise a scanned book into a chapter (اسکین شدہ کتاب سے باب)',
    trigger: 'digitize-book',
    keywords: ['ocr', 'scan', 'scanned', 'digitize', 'digitise', 'اسکین', 'سکین', 'عکسی', 'مصورة', 'ڈیجیٹائز', 'اسکین شدہ کتاب'],
    guidance:
      'This is a machine reading of a scanned page, not a transcription of a known text. The OCR engine WILL misread letters — especially in nastaʿlīq, in faint or skewed scans, and where diacritics matter. The chapter you produce is a DRAFT whose every line must be proofread against the original image; say so plainly to the scholar. Preserve the scan\'s own paragraph breaks, headings and page order; do not silently "correct", modernise or rephrase the author\'s wording, and never supply text a page does not clearly show. Do not add citations — an OCR draft is not a source.',
    steps: [
      { tool: 'ocr_document', bind: ['scan_path'], note: 'Read the scanned pages with the cloud OCR service (after the scholar consents).' },
      { tool: 'create_chapter', bind: ['name', 'title', 'from_source'], note: 'Create the chapter from the OCR text, titled as an unverified draft to proofread against the scan.' },
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
  // ── M13 (ADR-0061) — desktop-agent playbooks ─────────────────────────
  {
    id: 'format-urdu-document',
    title: 'Format an Urdu/Arabic Word file: fonts + page numbers (with backup)',
    trigger: 'format-urdu',
    keywords: ['اردو فائل کی فارمیٹنگ', 'فائل کی فارمیٹنگ', 'فونٹ درست کر', 'format my urdu document', 'fix the fonts in my'],
    guidance: 'Find the file first if the scholar did not give a full path. In automate_word_document use setFonts with urduFont "Jameel Noori Nastaleeq" and arabicFont "Traditional Arabic" unless the scholar named others, then insertPageNumbers with numberStyle "arabic-indic". A file outside the project is backed up and approved automatically — do not ask again in prose.',
    steps: [
      { tool: 'search_my_computer', bind: ['query'], optional: true, note: 'Find the Word file on the computer.' },
      { tool: 'automate_word_document', bind: ['path', 'ops'], note: 'Back up the file, set Urdu/Arabic fonts, add page numbers (approved first).' },
    ],
  },
  {
    id: 'find-and-cite-shamela',
    title: 'Find a passage in Shamela and footnote it',
    trigger: 'shamela-cite',
    keywords: ['شاملہ سے حوالہ', 'شاملہ کا حوالہ', 'cite from shamela', 'shamela footnote', 'حوالہ شاملہ سے'],
    guidance: 'Search Shamela, read the best page to confirm the wording, then footnote it. The footnote text is the deterministic reference (author, title, volume, printed page) — never write it yourself.',
    steps: [
      { tool: 'search_shamela', bind: ['query'], note: 'Search the Shamela library.' },
      { tool: 'read_shamela_page', bind: ['source_id'], note: 'Read the best page to confirm the passage.' },
      { tool: 'insert_footnote', bind: ['chapter', 'marker', 'source_id'], note: 'Insert the footnote as a tracked change.' },
    ],
  },
  {
    id: 'collect-files',
    title: 'Collect matching files from the computer into one folder',
    trigger: 'collect-files',
    keywords: ['فائلیں جمع', 'فائلیں ایک فولڈر میں', 'collect my files', 'gather the files', 'organize my files into'],
    guidance: 'Default to COPY unless the scholar clearly says move/منتقل. Pass every path search_my_computer returned that matches the ask.',
    steps: [
      { tool: 'search_my_computer', bind: ['query', 'extensions'], note: 'Find the matching files.' },
      { tool: 'organize_files', bind: ['files', 'destination', 'action'], note: 'Copy (or move) them into the folder — approved first, never overwrites.' },
    ],
  },
  // ── Temporary starter skills ────────────────────────────────────────────
  // Lean first versions built only from existing tools. The scholar's detailed
  // skill files replace them: import a skill.md with the same /trigger and
  // switch the built-in off (a disabled built-in yields its trigger to a custom
  // skill — see `findPlaybook`).
  {
    // temporary
    id: 'hadith-takhreej',
    title: 'Takhrīj of a hadith — source, reference and attributed grading (تخريج الحديث)',
    trigger: 'takhrij',
    keywords: ['hadith takhrij', 'takhrij hadith', 'hadith takhreej', 'تخریج حدیث', 'تخريج حديث', 'تخريج الحديث', 'حدیث کی تخریج'],
    guidance:
      'Take the hadith exactly as the scholar gave it and normalise only for searching (strip tashkīl, fold hamza/alif forms). ' +
      'Find it with search_hadith, then fetch its grading with grade_hadith. Report the collection (اسم الكتاب), chapter (الباب), ' +
      'hadith number (رقم الحديث) and volume/page (الجزء والصفحة) ONLY as the retrieved result states them — a field the source ' +
      'did not give is left out, never filled in. Every grading must be attributed to a named scholar exactly as the source states it ' +
      '(e.g. "قال الألباني: صحيح"); never grade a hadith yourself or merge verdicts into your own. Never fabricate a hadith text, ' +
      'book name or page number. Run verify_citation on the retrieved source before stating any of these details; if it is not verified, state only what matched. If no source is found, write: لم أقف عليه في المصادر المتاحة.',
    steps: [
      { tool: 'search_hadith', bind: ['query'], note: 'Find the narration and the collections that report it.' },
      { tool: 'grade_hadith', bind: ['text'], note: 'Fetch the grading exactly as the named scholar stated it (الدرر السنية).' },
      { tool: 'search_shamela', bind: ['query'], optional: true, note: 'Locate the original book page for the reference.' },
      { tool: 'verify_citation', bind: ['source_id', 'book', 'volume', 'page', 'number', 'grade', 'graded_by'], optional: true, note: 'Check the book, page, number and grading scholar against the retrieved source.' },
      { tool: 'insert_footnote', bind: ['chapter', 'marker', 'source_id', 'claim'], optional: true, note: 'Footnote the hadith from its retrieved source.' },
    ],
  },
  {
    // temporary
    id: 'fatwa-writing',
    title: 'Write a sourced fatwā (فتویٰ نویسی)',
    trigger: 'fatwa',
    keywords: ['fatwa writing', 'write a fatwa', 'draft a fatwa', 'فتوی نویسی', 'فتویٰ نویسی', 'فتوى نويسي', 'کتابة الفتوى'],
    guidance:
      'Follow the classical istiftāʾ method: restate the question precisely; establish the Qur\'anic evidence (query_tafseer) and the ' +
      'hadith evidence (search_hadith) with each narration\'s grade attributed to the named scholar who gave it; survey the madhāhib ' +
      'from the classical works (search_shamela) and attribute every position to a named scholar or school; then give a measured ' +
      'conclusion that names the stronger view and its evidence. Where the sources are silent say so; never invent a ruling or a ' +
      'citation. Note that a personal or case-specific situation needs a qualified muftī, and that this draft is for the scholar to review.',
    steps: [
      { tool: 'query_tafseer', bind: ['reference', 'mode'], optional: true, note: 'Retrieve the relevant āyah(s) and their tafsīr.' },
      { tool: 'search_hadith', bind: ['query'], optional: true, note: 'Retrieve the relevant hadith, with grades.' },
      { tool: 'search_shamela', bind: ['query'], note: 'Survey the fiqh positions in the classical works.' },
      {
        tool: 'draft_section',
        args: { mode: 'fatwa' },
        bind: ['chapter', 'section_heading', 'question'],
        optional: true,
        note: 'Write the answer as the ruling section of a formal fatwā document.',
      },
      { tool: 'typeset_print_ready', args: { preset: 'fatwa' }, bind: ['chapter'], optional: true, note: 'Apply the fatwā letterhead page layout.' },
      { tool: 'convert_document', args: { to: 'pdf' }, bind: ['chapter'], optional: true, note: 'Export the finished fatwā as a PDF.' },
    ],
  },
  {
    // temporary
    id: 'quran-verse-sources',
    title: 'Source the Qur\'anic verses quoted in a chapter (آیات کے حوالے)',
    trigger: 'ayah-sources',
    keywords: ['ayah sources', 'verse sources', 'quranic references', 'آیات کے حوالے', 'آیت کا حوالہ', 'مصادر الآيات'],
    guidance:
      'Find each quoted āyah in the text, resolve it to surah:ayah with query_tafseer, and footnote it from the retrieved result. ' +
      'Quote the āyah exactly as retrieved; never supply a verse number from memory. An āyah you cannot resolve gets a margin note, not a guess.',
    steps: [
      { tool: 'read_document', bind: ['chapter'], note: 'Read the chapter and list each quoted āyah.' },
      { tool: 'query_tafseer', args: { mode: 'ayah' }, bind: ['reference'], repeat: true, note: 'Resolve each quoted āyah to surah:ayah.' },
      { tool: 'insert_footnote', bind: ['chapter', 'marker', 'source_id'], repeat: true, note: 'Footnote each āyah from its retrieved source.' },
    ],
  },
  {
    // temporary
    id: 'narrator-profile',
    title: 'Profile a narrator — biography and jarḥ wa taʿdīl (ترجمة الراوي)',
    trigger: 'narrator',
    keywords: ['narrator profile', 'who is the narrator', 'راوی کا تعارف', 'ترجمۃ الراوی', 'ترجمة الراوي', 'راوی کی توثیق'],
    guidance:
      'Consult BOTH rijāl sources, reconcile them, and report each critic\'s verdict as that critic stated it, naming who said what. ' +
      'Do not summarise into your own grading of the narrator; where the sources disagree, show the disagreement.',
    steps: [
      { tool: 'lookup_narrator', bind: ['name'], note: 'Look up the narrator in the rijāl literature.' },
      { tool: 'jkhssn_narrator', bind: ['name'], optional: true, note: 'Cross-check against the local جوامع الكلم engine.' },
      { tool: 'add_document_comment', bind: ['chapter', 'anchor_text', 'comment'], optional: true, note: 'Record the verdicts as a margin note.' },
    ],
  },
  {
    // temporary
    id: 'lecture-citations',
    title: 'Source the quotations in a transcribed lecture (درس کے حوالے)',
    trigger: 'lecture-citations',
    keywords: ['lecture citations', 'source the lecture', 'درس کے حوالے', 'تقریر کے حوالے', 'خطاب کی تخریج'],
    guidance:
      'The speaker\'s words stay as spoken-then-edited; add sources, never new claims. Find each quoted verse, hadith or scholar and ' +
      'source it from a retrieved result. Anything you cannot source gets a margin comment saying so — never a reference from memory.',
    steps: [
      { tool: 'read_document', bind: ['chapter'], note: 'Read the transcript chapter and list each quotation.' },
      { tool: 'search_hadith', bind: ['query'], optional: true, repeat: true, note: 'Find each quoted hadith with its grade.' },
      { tool: 'search_shamela', bind: ['query'], optional: true, repeat: true, note: 'Find each quoted scholarly text in its original book.' },
      { tool: 'verify_citation', bind: ['source_id', 'book', 'volume', 'page', 'number'], optional: true, repeat: true, note: 'Check each cited detail against its retrieved source.' },
      { tool: 'insert_footnote', bind: ['chapter', 'marker', 'source_id', 'claim'], optional: true, repeat: true, note: 'Footnote each quotation from its retrieved source.' },
      { tool: 'add_document_comment', bind: ['chapter', 'anchor_text', 'comment'], optional: true, repeat: true, note: 'Flag each quotation that could not be sourced.' },
    ],
  },
  {
    // temporary
    id: 'word-meaning-note',
    title: 'Add a lexical note for an Arabic word (لغوی حاشیہ)',
    trigger: 'lexicon-note',
    keywords: ['lexicon note', 'word meaning note', 'لغوی حاشیہ', 'لفظ کے معنی', 'معنى الكلمة'],
    guidance: 'Give the meaning only as the retrieved lexicon states it, with its source; if the corpus has nothing, say so and give the link.',
    steps: [
      { tool: 'lookup_lexicon', bind: ['word'], note: 'Look the word up in the classical lexicons.' },
      { tool: 'insert_footnote', bind: ['chapter', 'marker', 'source_id'], optional: true, note: 'Footnote the meaning from its source.' },
    ],
  },
  {
    // temporary
    id: 'claim-source-audit',
    title: 'Audit how well a chapter\'s claims are sourced (read-only)',
    trigger: 'source-audit',
    keywords: ['source audit', 'audit the sourcing', 'حوالہ جات کا جائزہ', 'مصادر کا جائزہ'],
    guidance: 'Read-only: report which claims lack a source or rest on a weak one. Change nothing and invent no source.',
    steps: [
      { tool: 'read_document', bind: ['chapter'], note: 'Read the chapter structure and footnotes.' },
      { tool: 'critique', args: { kind: 'sourcing' }, bind: ['chapter'], note: 'Get a rigorous second opinion on the sourcing.' },
    ],
  },
];

const BY_ID = new Map(PLAYBOOKS.map((p) => [p.id, p]));
const BY_TRIGGER = new Map(PLAYBOOKS.filter((p) => p.trigger).map((p) => [p.trigger!, p]));

export function getPlaybook(id: string, extra: readonly Playbook[] = []): Playbook | undefined {
  return BY_ID.get(id) ?? extra.find((p) => p.id === id);
}

/**
 * M11 Phase 3 / M12 Phase H (ADR-0047) — a skill (playbook) is on unless the
 * merged switch map says otherwise; every playbook defaults on (unlike
 * connectors, none currently need a `defaultOff`).
 */
export function isSkillOn(skills: Record<string, boolean> | undefined, id: string): boolean {
  const v = skills?.[id];
  return typeof v === 'boolean' ? v : true;
}

/**
 * Fold the global ("this machine") and project ("this project") skill switch
 * maps into one explicit id -> boolean map covering every playbook (built-in
 * and `extra` custom ones), the same shape `mergeConnectorState` produces for
 * connectors. Precedence: an explicit project value wins, then global, then
 * on-by-default.
 */
export function mergeSkillState(
  global: Record<string, boolean> | undefined,
  project: Record<string, boolean> | undefined,
  extra: readonly Playbook[] = [],
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const pb of [...PLAYBOOKS, ...extra]) {
    const p = project?.[pb.id];
    const g = global?.[pb.id];
    out[pb.id] = typeof p === 'boolean' ? p : typeof g === 'boolean' ? g : true;
  }
  return out;
}

/**
 * Find the playbook a `/trigger` or id names. Built-ins win over `extra`
 * (custom) skills with the same trigger — unless the built-in is switched off
 * in `enabled`, in which case the trigger falls through to the custom skill.
 * That is how a scholar's detailed skill replaces a temporary built-in: import
 * it with the same /trigger and toggle the built-in off.
 */
function findPlaybook(
  ref: string,
  enabled: Record<string, boolean> | undefined,
  extra: readonly Playbook[],
): Playbook | undefined {
  const usable = (p: Playbook | undefined): Playbook | undefined =>
    p && (!enabled || isSkillOn(enabled, p.id)) ? p : undefined;
  return (
    usable(BY_TRIGGER.get(ref)) ??
    usable(BY_ID.get(ref)) ??
    usable(extra.find((p) => p.trigger === ref)) ??
    usable(extra.find((p) => p.id === ref))
  );
}

/**
 * Resolve a `/trigger` or an id to a playbook. `enabled`, when given, hides a
 * switched-off skill even from an explicit `/trigger` — that is what "off"
 * means (ADR-0047), the same as a switched-off connector's tools disappearing
 * from every path, not just automatic ones. Omitted `enabled` = old
 * behaviour, every playbook eligible (a headless/eval caller, or a test that
 * does not care about the toggle). `extra` = the scholar's custom skills.
 */
export function resolvePlaybook(
  ref: string,
  enabled?: Record<string, boolean>,
  extra: readonly Playbook[] = [],
): Playbook | undefined {
  return findPlaybook(ref.trim().replace(/^\//, ''), enabled, extra);
}

/**
 * Best-effort match of a free-text ask to a playbook.
 *
 * An exact leading `/trigger` wins outright (M9). Otherwise fall back to the
 * keyword-hit count; returns null when nothing matches — the agent then just
 * works step by step. `enabled` — see {@link resolvePlaybook}.
 */
export function selectPlaybook(
  ask: string,
  enabled?: Record<string, boolean>,
  extra: readonly Playbook[] = [],
): Playbook | null {
  const trimmed = ask.trim();
  if (trimmed.startsWith('/')) {
    const exact = findPlaybook(trimmed.slice(1).split(/\s/)[0], enabled, extra);
    if (exact) return exact;
  }

  const lower = trimmed.toLowerCase();
  let best: { p: Playbook; hits: number } | null = null;
  for (const p of [...PLAYBOOKS, ...extra]) {
    if (enabled && !isSkillOn(enabled, p.id)) continue;
    const hits = p.keywords.reduce((n, k) => (lower.includes(k.toLowerCase()) ? n + 1 : n), 0);
    if (hits > 0 && (!best || hits > best.hits)) best = { p, hits };
  }
  return best?.p ?? null;
}
