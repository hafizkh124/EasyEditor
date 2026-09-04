/**
 * M8 Layer 6 — the CLOSED agent tool registry (SPEC-M8 §3, ADR-0016 control 1).
 *
 * This is the agent's entire vocabulary. It cannot call anything not listed
 * here, and every parameter travels as JSON data — never concatenated into a
 * command (security gate 1). "Ask" mode filters to `effect: 'read'` only.
 *
 * M9: `run_playbook` (ADR-0020) and `draft_section` (ADR-0021) are wired.
 * Each `description` carries an explicit "Do NOT use when…" clause (ADR-0027 F3)
 * so the model does not reach for a tool on a surface keyword match.
 */
import type { AgentMode, AgentTool } from './types.js';

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: 'list_capabilities',
    description: "What document tools are available on this machine (Word, LibreOffice, InPage) and their versions. Call this first if the user asks what's possible.",
    params: {},
    required: [],
    effect: 'read',
  },
  {
    name: 'read_document',
    description: 'Read a chapter file: its headings, footnotes, tracked-change count, word count, and reading order. Use before editing so you know the structure. Do NOT use to search for a source to cite (that is search_corpus / search_shamela).',
    params: {
      chapter: { type: 'string', description: 'The chapter file name in the open project folder, e.g. "02-body.docx".' },
    },
    required: ['chapter'],
    effect: 'read',
  },
  {
    name: 'search_corpus',
    description: "Page/volume-precise retrieval from the user's personal corpus and the project's own chapters. Returns ranked chunks with citation refs. This is how you find a source to cite. Consult this and search_shamela FIRST — they are the local gold-standard sources and the preferred citation. Do NOT use for a question the open chapter's own text answers (use read_document) or for general web context (use search_general).",
    params: {
      query: { type: 'string', description: 'What to look for, in the source language (Arabic/Urdu/English).' },
      limit: { type: 'number', description: 'Max results (default 8).' },
    },
    required: ['query'],
    effect: 'read',
  },
  {
    name: 'search_shamela',
    description: "Full-text search of the user's local Maktaba Shamela library (classical Arabic works). Returns book, page, and snippet. A local gold-standard, citable source. Do NOT use for a claim the personal corpus already covers, or for general web context (use search_general).",
    params: {
      query: { type: 'string', description: 'Arabic search terms.' },
      limit: { type: 'number', description: 'Max results (default 8).' },
    },
    required: ['query'],
    effect: 'read',
  },
  {
    name: 'query_tafseer',
    description: "Look up a Qur'anic āyah, its tafsīr, its reason for revelation (sabab an-nuzūl), or a word analysis, or search across the classical tafsīr works — from the tafsir.net sources. A citable source: the reference is book + sūrah + āyah. Do NOT use for hadith (use search_hadith) or for a fiqh ruling that is not tafsīr-based.",
    params: {
      reference: { type: 'string', description: 'The āyah as "surah:ayah" (e.g. "2:255" or "al-baqarah:255"). For mode "search" this may be the search phrase instead.' },
      mode: { type: 'string', description: 'What to fetch.', enum: ['ayah', 'tafsir', 'nuzool', 'word', 'search'] },
      sources: { type: 'array', items: { type: 'string' }, description: 'Optional tafsīr source ids to restrict to (e.g. "tabari").' },
      query: { type: 'string', description: 'For mode "search" — the phrase to look for in the tafsīr texts.' },
    },
    required: ['reference', 'mode'],
    effect: 'read',
  },
  {
    name: 'search_hadith',
    description: "Search the hadith collections (Ṣaḥīḥ works, Sunan, Musnad, and rijāl) through the grounded Islamic research channel. Returns matching narrations with collection, number, and grade — a citable source. Use ONLY when explicit hadith text, takhrīj, or a chain (isnād) is needed. Do NOT use for a lexical/grammar question, for tafsīr, or as a general web search.",
    params: {
      query: { type: 'string', description: 'The hadith text, topic, or narrator, in Arabic or the scholar\'s language.' },
      collection: { type: 'string', description: 'Optional — restrict to one collection.' },
      limit: { type: 'number', description: 'Max narrations (default 6).' },
    },
    required: ['query'],
    effect: 'read',
  },
  {
    name: 'search_repositories',
    description: "Search the global scholarly repositories — the Internet Archive (scanned editions) and OpenAlex (journal articles, theses, monographs) — for WORKS on a topic. Returns bibliographic references only: author, title, year, link. You can cite a work with insert_footnote but WITHOUT a `claim` — you have not read it. To quote a passage, find it in search_shamela or search_corpus. Do NOT use for a source you can read directly, and do NOT use it as a first resort. Needs an internet connection; off by default per project.",
    params: {
      query: { type: 'string', description: 'The topic or title to look for.' },
      repo: { type: 'string', description: 'Which repository.', enum: ['archive', 'openalex', 'all'] },
      limit: { type: 'number', description: 'Max works per repository (default 5).' },
    },
    required: ['query'],
    effect: 'read',
  },
  {
    name: 'search_general',
    description: "Ask the General research channel a question (the same one the Research tab uses — a signed-in, provenance-tagged web+model search, NOT open browsing). Use ONLY for background/context the personal corpus and Shamela cannot answer. Its result is NOT page-precise, so it can never be used as a footnote source. Do NOT use it as a first resort, for a classical text (use search_shamela), or when the scholar asked for a sourced citation. Needs an internet connection and a signed-in session.",
    params: {
      query: { type: 'string', description: 'The question, in the scholar\'s language.' },
    },
    required: ['query'],
    effect: 'read',
  },
  {
    name: 'insert_footnote',
    description: "Insert a real Word footnote at each [N] marker in a chapter, as a tracked change. The footnote text MUST come from a chunk returned by a search_* tool — you pass the marker and the source's id, not a reference you typed. Fails if the citation does not resolve to a retrieved chunk, or if `claim` is given and the source does not actually support it. Do NOT use with a search_general result (never citable), and do NOT pass a `claim` alongside a bibliographic-only source (a work reference that was not read).",
    params: {
      chapter: { type: 'string', description: 'The chapter file name.' },
      marker: { type: 'string', description: 'The literal marker in the text, e.g. "[1]".' },
      source_id: { type: 'string', description: 'The id of a chunk returned by a prior search_* call in this task.' },
      claim: { type: 'string', description: 'The exact sentence/claim this footnote supports. Strongly recommended — it is checked against the source excerpt before the footnote is inserted.' },
    },
    required: ['chapter', 'marker', 'source_id'],
    effect: 'write',
  },
  {
    name: 'transcribe_media',
    description: "Transcribe a recording that is already in the project folder (an @mentioned lecture or dars) into timestamped text, saved as a .transcript.txt beside it. Uses the scholar's own local Whisper — nothing is uploaded. Long recordings are chunked automatically. Do NOT use for a file that is not in the project folder, and do NOT use to re-read a transcript that already exists (read it with create_chapter's from_source, or @mention it).",
    params: {
      media_path: { type: 'string', description: 'The in-project path of the recording, e.g. "media/dars-01.mp3" (from an @mention).' },
      lang: { type: 'string', description: 'Language hint: "ur", "ar", "en", or "auto" (default).' },
    },
    required: ['media_path'],
    effect: 'write',
  },
  {
    name: 'create_chapter',
    description: "Create a NEW chapter .docx in the project folder — blank, seeded from a transcript/notes file already in the project (from_source), or from a short HTML fragment. RTL page setup is applied. Prefer from_source over html for anything long: never paste a whole transcript through this call. Do NOT use to rewrite an existing chapter (that is draft_section / run_task).",
    params: {
      name: { type: 'string', description: 'The new chapter file name, e.g. "03-dars.docx". Must end in .docx.' },
      title: { type: 'string', description: 'Optional heading placed at the top of the new chapter.' },
      from_source: { type: 'string', description: 'An in-project .txt/.md file whose content seeds the chapter, e.g. "sources/dars-01.transcript.txt".' },
      html: { type: 'string', description: 'A short HTML fragment to seed the chapter with. Use from_source for long content.' },
    },
    required: ['name'],
    effect: 'write',
  },
  {
    name: 'typeset_print_ready',
    description: "Apply a print-ready page layout to a chapter — trim size, binding gutter, mirrored margins, and odd/even running heads — through Word's own engine. This is a print-ready WORD layout, NOT press-grade typesetting: no kerning tables, no PDF/X, Word's own widow/orphan control only. A tracked-change-free layout write. Then export a PDF with convert_document. Do NOT use for the RTL page setup alone (that is set_page_layout).",
    params: {
      chapter: { type: 'string', description: 'The chapter file name.' },
      trim: { type: 'string', description: 'Trim size.', enum: ['a5', 'b5', '6x9', 'waziri', 'digest', 'custom'] },
      trim_width_cm: { type: 'number', description: 'For trim "custom" — page width in cm.' },
      trim_height_cm: { type: 'number', description: 'For trim "custom" — page height in cm.' },
      gutter_cm: { type: 'number', description: 'Binding gutter in cm (default 1.2).' },
      mirror_margins: { type: 'boolean', description: 'Mirror the inner/outer margins for two-sided printing (default true).' },
      odd_even_headers: { type: 'boolean', description: 'Different running heads on odd vs even pages (default true).' },
      header_odd: { type: 'string', description: 'Running head text for odd (recto) pages — usually the chapter title.' },
      header_even: { type: 'string', description: 'Running head text for even (verso) pages — usually the book title.' },
      start_recto: { type: 'boolean', description: 'Start the chapter on an odd (right-hand) page.' },
    },
    required: ['chapter', 'trim'],
    effect: 'write',
  },
  {
    name: 'compare_manuscript_variants',
    description: "Collate two witnesses of a text — a base chapter and a second manuscript — with Word's own Compare, and read back every difference as an apparatus criticus (موضع / متن الأصل / نسخة / نوع الاختلاف). Neither file is changed. Use for critical editions and فروق النسخ; then act on each locus with insert_footnote or add_document_comment. Do NOT use to review a draft against a supervisor's edits (that is read_document).",
    params: {
      base_chapter: { type: 'string', description: 'The base manuscript chapter file (the الأصل).' },
      witness_chapter: { type: 'string', description: 'The second witness chapter file to collate against it.' },
      siglum: { type: 'string', description: 'Short label for the witness column, e.g. "ب" or "ح".' },
    },
    required: ['base_chapter', 'witness_chapter'],
    effect: 'read',
  },
  {
    name: 'build_scholarly_indexes',
    description: "Build the back-matter indexes for a chapter (فہارس): mark every occurrence of the index terms with Word XE fields and append the INDEX field so Word compiles it. Extracts entries from the chapter text for the requested kinds unless you pass `entries` yourself. Do NOT use for a table of contents (that is Word's built-in heading TOC). A tracked change.",
    params: {
      chapter: { type: 'string', description: 'The chapter file name.' },
      kinds: { type: 'array', items: { type: 'string' }, description: 'Which indexes to build: quran, hadith, names, places, terms.' },
      entries: { type: 'array', items: { type: 'string' }, description: 'Optional — pre-built entries as "find||entry" pairs; skips extraction.' },
      heading: { type: 'string', description: 'Optional heading for the index section, e.g. "فهرس الأعلام".' },
    },
    required: ['chapter', 'kinds'],
    effect: 'write',
  },
  {
    name: 'add_document_comment',
    description: "Attach a margin comment to a passage in a chapter — a review note, a query about a source, or flagging a claim you could not verify (takhrīj / supervision). The anchor text must be a short exact phrase that appears in the chapter. Lands as a tracked change. Do NOT use to edit the text (that is run_task / draft_section) or to add a citation (insert_footnote).",
    params: {
      chapter: { type: 'string', description: 'The chapter file name.' },
      anchor_text: { type: 'string', description: 'A short exact phrase from the chapter to attach the comment to.' },
      comment: { type: 'string', description: 'The comment text, in the scholar\'s language.' },
      author: { type: 'string', description: 'Optional — the reviewer name shown on the comment.' },
    },
    required: ['chapter', 'anchor_text', 'comment'],
    effect: 'write',
  },
  {
    name: 'set_page_layout',
    description: 'Apply the right-to-left page setup (margins + reading order) to a chapter, as a tracked change.',
    params: {
      chapter: { type: 'string', description: 'The chapter file name.' },
    },
    required: ['chapter'],
    effect: 'write',
  },
  {
    name: 'convert_document',
    description: 'Convert a chapter to another format (pdf/rtf/txt) or reflow a PDF into an editable docx. Shows the user the loss list first. Does not need the agent — offered here for completeness.',
    params: {
      chapter: { type: 'string', description: 'The chapter file name (or a .pdf in the project folder for reflow).' },
      to: { type: 'string', description: 'Target format.', enum: ['docx', 'pdf', 'rtf', 'txt'] },
    },
    required: ['chapter', 'to'],
    effect: 'write',
  },
  {
    name: 'check_consistency',
    description: "After you change a term or citation in one chapter, search the project's OTHER chapters for the same term and report where it also appears — so you can suggest a review there. A lexical search, not an automatic edit.",
    params: {
      term: { type: 'string', description: 'The word or phrase to look for across the other chapters.' },
      exclude_chapter: { type: 'string', description: 'The chapter you just edited (skip it in the results).' },
    },
    required: ['term'],
    effect: 'read',
  },
  {
    name: 'run_task',
    description: "Run one of the built-in text tasks (harakat, spelling, paraphrase, summarize, auto-format, normalize, formalize, humanize, shorten, section-summaries) on a chapter's text, as a tracked change. Do NOT use for citations (use search_* then insert_footnote) or to write new prose from sources (use draft_section).",
    params: {
      chapter: { type: 'string', description: 'The chapter file name.' },
      task: { type: 'string', description: 'The task slug.' },
    },
    required: ['chapter', 'task'],
    effect: 'write',
  },
  {
    name: 'install_font',
    description: "Install a font file the scholar has pointed you at, so it is usable in Word (e.g. a Nastaliq font for the thesis). The path must be a font file (.ttf/.otf/.ttc) that already exists on this machine — never a download URL. Verifies the font is visible to a running Word afterwards.",
    params: {
      font_path: { type: 'string', description: 'Absolute path to a .ttf/.otf/.ttc file already on disk (from an @mention or the scholar\'s message).' },
    },
    required: ['font_path'],
    effect: 'write',
  },
  {
    name: 'install_template',
    description: "Install a Word template (.dotx/.dotm) the scholar or their supervisor provided, and optionally attach it to a chapter (as a tracked change) so its styles apply. The path must be a template file already on disk.",
    params: {
      template_path: { type: 'string', description: 'Absolute path to a .dotx/.dotm file already on disk.' },
      chapter: { type: 'string', description: 'Optional — attach the template to this chapter and update its styles.' },
    },
    required: ['template_path'],
    effect: 'write',
  },
  {
    name: 'set_global_option',
    description: "Propose a change to a Word application setting that affects EVERY document the scholar opens (e.g. turning off as-you-type spell check). This does NOT apply the change — it returns a consent request the scholar must approve in the Agent panel, and every applied change is logged so it can be reverted. Allowed options: check_spelling, check_grammar, smart_quotes. Do NOT use for a setting scoped to one chapter (that is set_page_layout / run_task).",
    params: {
      option: { type: 'string', description: 'One of: check_spelling, check_grammar, smart_quotes.', enum: ['check_spelling', 'check_grammar', 'smart_quotes'] },
      value: { type: 'string', description: '"true" or "false".', enum: ['true', 'false'] },
    },
    required: ['option', 'value'],
    effect: 'write',
  },
  {
    name: 'run_playbook',
    description: "Run a whole playbook — a fixed, ordered sequence of this registry's own tool calls that captures how a skilled scholar does one task (e.g. add verified citations, prepare a thesis chapter). Use when the scholar's request matches a known playbook end-to-end. Do NOT use for a single step (call that tool directly) or when no playbook fits — just work step by step.",
    params: {
      playbook: { type: 'string', description: 'The playbook id or its /trigger (e.g. "add-verified-citations" or "/manuscript-takhreej").' },
      chapter: { type: 'string', description: 'The chapter the playbook acts on, if it needs one.' },
    },
    required: ['playbook'],
    effect: 'write',
  },
  {
    name: 'draft_section',
    description: "Draft or rewrite a section of a chapter using ONE of a fixed set of instruction modes (outline, prose, column, translation, summary, literary-urdu). The mode picks a fixed instruction template — you never write the generation prompt yourself. Grounded modes (prose, column, translation) REQUIRE source_ids retrieved this task and error without them. Output lands as a tracked change labelled a draft. Do NOT use for a light copy-edit (use run_task) or to insert a citation (use insert_footnote).",
    params: {
      chapter: { type: 'string', description: 'The chapter file name.' },
      mode: {
        type: 'string',
        description: 'Which fixed drafting template to run.',
        enum: ['outline', 'prose', 'column', 'translation', 'summary', 'literary-urdu'],
      },
      section_heading: { type: 'string', description: 'The heading of the section to draft under, if the chapter already has structure.' },
      source_ids: { type: 'array', items: { type: 'string' }, description: 'Ids of chunks retrieved this task — required for prose / column / translation.' },
    },
    required: ['chapter', 'mode'],
    effect: 'write',
  },
];

/**
 * A pseudo-tool the model may call to ask ONE clarifying question instead of
 * fanning out on an ambiguous ask (ADR-0027 F6). It is never dispatched — the
 * model layer turns it into a `clarify` step and the loop surfaces the
 * question. Not part of `AGENT_TOOLS` (the closed executable registry).
 */
export const CLARIFY_TOOL: AgentTool = {
  name: 'ask_clarifying_question',
  description: 'Ask the scholar ONE short clarifying question, and only when the request is genuinely ambiguous (a one-word topic, an unclear target, no way to choose a sensible default). Never use it to stall or to avoid doing straightforward work.',
  params: { question: { type: 'string', description: 'The single question to ask, in the scholar\'s language.' } },
  required: ['question'],
  effect: 'read',
};

export const READ_ONLY_TOOLS: AgentTool[] = AGENT_TOOLS.filter((t) => t.effect === 'read');

/**
 * The tool set for a mode: "ask" is read-only; "plan" and "auto" get the full
 * registry (Plan mode still stops before the first write — that gate is in the
 * loop, not here). Dynamic per-request pruning is layered on top by
 * `shared/agent/toolScoping.ts` (ADR-0027 F2).
 */
export function toolsForMode(mode: AgentMode): AgentTool[] {
  return mode === 'ask' ? READ_ONLY_TOOLS : AGENT_TOOLS;
}

const BY_NAME = new Map(AGENT_TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): AgentTool | undefined {
  return BY_NAME.get(name);
}
