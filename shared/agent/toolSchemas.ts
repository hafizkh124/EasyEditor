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
    description: 'Read a chapter file\'s STRUCTURE ONLY: its headings, footnotes, tracked-change count, word count, and reading order. Use before editing so you know the structure. Does NOT return the chapter\'s body text — never use this as the source for a quote, and never claim it told you what the chapter "says". Do NOT use to search for a source to cite, or to answer what the open chapter\'s own text says (that is search_corpus).',
    params: {
      chapter: { type: 'string', description: 'The chapter file name in the open project folder, e.g. "02-body.docx".' },
    },
    required: ['chapter'],
    effect: 'read',
  },
  {
    name: 'search_corpus',
    description: "Page/volume-precise retrieval from the user's personal corpus and the project's own chapters. Returns ranked chunks of REAL excerpted text with citation refs. This is how you find a source to cite, AND this — not read_document — is the tool for a question about what an open chapter itself says: its project-chapters branch returns literal excerpted chapter text. Consult this and search_shamela FIRST — they are the local gold-standard sources and the preferred citation. Do NOT use for general web context (use search_general).",
    params: {
      query: { type: 'string', description: 'What to look for, in the source language (Arabic/Urdu/English).' },
      limit: { type: 'number', description: 'Max results (default 8).' },
    },
    required: ['query'],
    effect: 'read',
  },
  {
    name: 'search_shamela',
    description: "Full-text search of the scholar's Maktaba Shamela — their local library, or the online شامله لنک library if the local one is not available (the app routes automatically; you always call this one tool). Returns book, page, and snippet. A gold-standard, citable source. Do NOT use for a claim the personal corpus already covers, or for general web context (use search_general).",
    params: {
      query: { type: 'string', description: 'Arabic search terms.' },
      limit: { type: 'number', description: 'Max results (default 8).' },
    },
    required: ['query'],
    effect: 'read',
  },
  {
    name: 'read_shamela_page',
    description: "Read the FULL text (and footnotes) of ONE page of a Shamela book you already found with search_shamela — pass its result id (e.g. \"shamela:1681:245\"). Use to read the context around a snippet before quoting it. Not a search tool; call search_shamela first.",
    params: {
      source_id: { type: 'string', description: 'A shamela:<bookId>:<page> id returned by search_shamela.' },
    },
    required: ['source_id'],
    effect: 'read',
  },
  {
    name: 'find_shamela_book',
    description: "Look up Shamela books or authors by name — returns matching titles with their book id, author, and death year, so you can then search_shamela or read a page from a specific work. A discovery helper, NOT a citable source.",
    params: {
      query: { type: 'string', description: 'A book title or author name, in Arabic.' },
    },
    required: ['query'],
    effect: 'read',
  },
  {
    name: 'query_tafseer',
    description: "Qur'ān work from Markaz Tafsir (باحوث / Bahouth): an āyah's text, its tafsīr, its reason for revelation (sabab an-nuzūl), a word analysis, the triliteral-root occurrences and stats (mode 'root'), the qirāʾāt variants of a word (mode 'qeraat'), or a free-text search across the classical tafsīr works. A citable source: the reference is book + sūrah + āyah (or the root). Do NOT use for hadith text or grading (use search_hadith), for a narrator / rijāl question, or for a fiqh ruling that is not tafsīr-based.",
    params: {
      reference: { type: 'string', description: 'The āyah as "surah:ayah" (e.g. "2:255" or "al-baqarah:255"). For mode "search" the search phrase; for mode "root" the triliteral root (e.g. "نصر" or "ن ص ر").' },
      mode: { type: 'string', description: 'What to fetch.', enum: ['ayah', 'tafsir', 'nuzool', 'word', 'qeraat', 'root', 'search'] },
      sources: { type: 'array', items: { type: 'string' }, description: 'Optional tafsīr source ids to restrict to (e.g. "tabari").' },
      query: { type: 'string', description: 'For mode "search" — the phrase to look for in the tafsīr texts. For mode "root" — an alternative place to give the root.' },
      word_no: { type: 'number', description: 'For mode "word" / "qeraat" — the 1-based word position in the āyah (default 1).' },
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
    name: 'lookup_lexicon',
    description: "Look up an Arabic word or root for its Urdu meaning, in the classical Arabic → Urdu lexical material (لغتِ قرآن and the ingested Urdu lexicon works). A citable source — the reference is the work it came from. Every result also carries an al-Maany (المعاني) link for the scholar to verify. This tool does NOT invent a gloss: if the corpus has nothing, it says so and gives the al-Maany link. Do NOT use for hadith, for tafsīr of a whole āyah (query_tafseer), or as a spell-checker.",
    params: {
      word: { type: 'string', description: 'The Arabic word or triliteral root, e.g. "سرابيل" or "كبر".' },
      dict: { type: 'string', description: 'Which printed dictionary to prefer for a page citation, when one is indexed.', enum: ['misbah', 'qamus', 'both'] },
    },
    required: ['word'],
    effect: 'read',
  },
  {
    name: 'lookup_narrator',
    description: "Look up a hadith narrator (rāwī) in the classical rijāl / asmāʾ al-rijāl literature: biography, jarḥ wa taʿdīl (the critics' verdicts), teachers and students, and roughly how many narrations they transmit. A citable source. Use THIS — not search_hadith — when the question is about a NARRATOR (their reliability, dates, shaykhs). Do NOT use to grade a whole hadith (grade_hadith), for tafsīr, or for a topical hadith search (search_hadith). Tracing the isnād CHAIN between two narrators is not available yet.",
    params: {
      name: { type: 'string', description: 'The narrator, in Arabic (e.g. "شعبة بن الحجاج", "الأعمش", "أبو هريرة").' },
      aspect: {
        type: 'string',
        description: 'What to focus on (default biography).',
        enum: ['biography', 'grade', 'teachers-students', 'narration-count'],
      },
    },
    required: ['name'],
    effect: 'read',
  },
  {
    name: 'grade_hadith',
    description: "Look up a hadith's grading and takhrīj in الدرر السنية (dorar.net): الراوي, المحدث, المصدر, and الحكم EXACTLY as Dorar states it — never our own verdict. A citable source. Use THIS, not search_hadith, when the ask is about whether a hadith is ṣaḥīḥ / ḍaʿīf or where it is graded. Do NOT use for tafsīr, a lexical question, a narrator biography on its own, or a topical hadith search (that is search_hadith).",
    params: {
      text: { type: 'string', description: 'The hadith text, or a distinctive phrase from it, in Arabic.' },
      limit: { type: 'number', description: 'Max gradings to return (1–15, default 5).' },
    },
    required: ['text'],
    effect: 'read',
  },
  {
    name: 'jkhssn_narrator',
    description: "Look up a narrator in the LOCAL جوامع الكلم engine: their ṭabaqa, death year, Ibn Ḥajar's التقريب formula, al-Dhahabī's rank, the full jarḥ-wa-taʿdīl verdict list WITH each critic's own words, and teacher/student counts. A citable source, offline. Complements lookup_narrator (which searches other rijāl works) — call BOTH for an important narrator and reconcile. Do NOT use to grade a whole hadith or for tafsīr. Narrator display names come from a separate lookup — expect Arabic name forms.",
    params: {
      name: { type: 'string', description: 'The narrator in Arabic (e.g. "شعبة بن الحجاج", "الأعمش").' },
      aspect: { type: 'string', description: 'Focus (default all).', enum: ['biography', 'jarh', 'teachers', 'students', 'all'] },
    },
    required: ['name'],
    effect: 'read',
  },
  {
    name: 'jkhssn_sanad_tree',
    description: "Build the isnād (sanad) tree for a hadith from the LOCAL جوامع الكلم engine — the chain(s) of narrators from the Companion down to the collector, with each link tagged marfūʿ / mawqūf / maqṭūʿ. Structural, not textual. Prefer a hadith_main_id from a prior jkhssn_takhrij; free text is best-effort — if it can't resolve, ask the scholar for the collection + printed number. Do NOT use for a narrator biography (jkhssn_narrator) or a grading (grade_hadith).",
    params: {
      hadith_main_id: { type: 'number', description: 'The جوامع الكلم hadith id (from jkhssn_takhrij / jkhssn_thematic).' },
      hadith_text: { type: 'string', description: 'A distinctive Arabic phrase — best-effort fallback when no id is known.' },
    },
    required: [],
    effect: 'read',
  },
  {
    name: 'jkhssn_takhrij',
    description: "Takhrīj from the LOCAL جوامع الكلم engine: every place a hadith (and the others sharing its matn group) appears, which books, and جوامع الكلم's own service flags (has isnād analysis, has ʿilal, is gharīb, degree). Offline, citable. Takes a hadith_main_id, or a book + printed number, or best-effort free text. Complements grade_hadith (which gives الدرر السنية's verdict) — this gives the cross-collection map.",
    params: {
      hadith_main_id: { type: 'number', description: 'The جوامع الكلم hadith id.' },
      hadith_text: { type: 'string', description: 'A distinctive Arabic phrase — best-effort fallback.' },
    },
    required: [],
    effect: 'read',
  },
  {
    name: 'jkhssn_judgments',
    description: "The imams' rulings and ʿilal notes on a specific hadith from the LOCAL جوامع الكلم engine — each scholar's verbatim words (e.g. \"هذا إسناد منقطع\", \"صحيح على شرط الشيخين\"). Offline, citable. Complements grade_hadith: grade_hadith gives الدرر السنية's summary verdict, this gives the classical critics' full statements. Needs a hadith_main_id (from jkhssn_takhrij) or best-effort free text.",
    params: {
      hadith_main_id: { type: 'number', description: 'The جوامع الكلم hadith id.' },
      hadith_text: { type: 'string', description: 'A distinctive Arabic phrase — best-effort fallback.' },
    },
    required: [],
    effect: 'read',
  },
  {
    name: 'jkhssn_thematic',
    description: "Navigate جوامع الكلم's fiqh / thematic index (LOCAL): drill from a subject node to its children and, at a leaf, the hadith ids under it. With a query, matches جوامع الكلم's own book-section headings. Offline. Use to find every hadith on a fiqh topic within the engine, then jkhssn_takhrij / jkhssn_sanad_tree on the results. Not a substitute for search_hadith (which searches full text across all corpora).",
    params: {
      query: { type: 'string', description: 'A fiqh topic / chapter heading, in Arabic.' },
      subject_id: { type: 'number', description: 'A جوامع الكلم subject-tree node id to drill into.' },
    },
    required: [],
    effect: 'read',
  },
  {
    name: 'search_persian_poetry',
    description: "Search Persian (Fārsī) poetry through Ganjoor — Rūmī, Saʿdī, Ḥāfiẓ, ʿAṭṭār, Jāmī, and Iqbāl's Persian dīwāns. Returns verses with the poet, the work, and a ganjoor.net link — a citable source. Persian ONLY. Do NOT use for Urdu poetry (lookup_urdu_verse), for Arabic, or for prose.",
    params: {
      query: { type: 'string', description: 'A phrase or theme, in Persian or transliteration.' },
      poet: { type: 'string', description: 'Optional — restrict to one poet (e.g. "حافظ", "مولوی", "اقبال لاهوری").' },
    },
    required: ['query'],
    effect: 'read',
  },
  {
    name: 'scan_urdu_prosody',
    description: "Scan an Urdu or Persian verse for its metre — the taqṭīʿ (syllable weights), the arkān, and a best guess at the baḥr — with a rule engine. HEURISTIC: it reads the written form without full vowel marks, so it can be wrong on an irregular line. Present it as a machine reading to CHECK, and never cite a baḥr as fact. Do NOT use for the ʿarūḍ of an Arabic Qur'anic verse.",
    params: {
      text: { type: 'string', description: 'The verse — one or more miṣraʿ lines, newline-separated.' },
    },
    required: ['text'],
    effect: 'read',
  },
  {
    name: 'lookup_urdu_verse',
    description: "Find an Urdu verse in the bundled poetry corpus (whatever collections the scholar has added — see resources/prosody). A citable source. Do NOT use for Persian poetry (search_persian_poetry) or for metre scanning (scan_urdu_prosody).",
    params: {
      query: { type: 'string', description: 'A phrase from the verse, or a theme, in Urdu.' },
    },
    required: ['query'],
    effect: 'read',
  },
  {
    name: 'calculate_zakat',
    description: "Compute the zakat due on the scholar's own declared assets, liabilities, and metal prices — 100% deterministic arithmetic (shared/zakat/RULES.md); the model NEVER does this maths itself, only assembles the JSON. Pass a single JSON object as `input` matching ZakatInput: { hawlMet: boolean, currency?: string, nisab: { goldPricePerGram: number, silverPricePerGram: number, standard: 'gold'|'silver'|'lower', silverNisabGrams?: number }, jewelleryRuling?: 'hanafi-all'|'personal-exempt', cash?: number, gold?: [{ grams, purity?: '24K'|'22K'|'21K'|'18K', use?: 'regular'|'occasional'|'investment' }], silver?: [{ grams, use? }], tradeGoods?: number, investments?: number, receivables?: number, rentalIncomeNet?: number, propertyForSale?: number, vacantLand?: number, debtsDue?: number, longTermDebtAnnual?: number }. Prices and the jewellery ruling must come from the scholar/mufti — this tool NEVER fetches a live metal or currency price. The result's `note` is a non-fatwā disclaimer; present it that way. Do NOT use for inheritance shares (calculate_faraid).",
    params: {
      input: { type: 'string', description: 'A JSON-encoded ZakatInput object — see the tool description for its exact shape.' },
    },
    required: ['input'],
    effect: 'read',
  },
  {
    name: 'calculate_faraid',
    description: "Compute the Islamic inheritance (farāʾiḍ) shares for a declared set of heirs, following the Jumhūr view — 100% deterministic arithmetic (shared/faraid/RULES.md); the model NEVER does this maths itself. Pass a single JSON object as `input` matching FaraidInput: { heirs: { <heirType>: count, ... }, estateValue?: number, currency?: string }. `heirs` keys are from this CLOSED set only: husband, wife, son, daughter, father, mother, paternalGrandfather, paternalGrandmother, maternalGrandmother, grandson, granddaughter, fullBrother, fullSister, paternalBrother, paternalSister, maternalBrother, maternalSister, fullNephew, paternalNephew, fullUncle, paternalUncle, fullCousin, paternalCousin, paternalCousinsGrandson — each a headcount (0 or 1 for a singular heir; a real count for a plural one, e.g. daughter: 2). Every result carries a non-fatwā disclaimer and each heir's Qur'anic dalīl — present the whole thing as a computation for a mufti to check, never as a fatwā itself. Distant kindred (ذوو الأرحام) are out of this closed set; the result says so plainly when no listed heir qualifies. Do NOT use for zakat (calculate_zakat), and do NOT invent a heir type outside this list.",
    params: {
      input: { type: 'string', description: 'A JSON-encoded FaraidInput object — see the tool description for its exact shape.' },
    },
    required: ['input'],
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
    name: 'research_topic',
    description: "Hand a whole topic to a bounded research SUB-RUN: it runs its own short search loop (search_corpus / search_shamela / query_tafseer / search_hadith), then returns a short synthesis PLUS the page-precise sources it found — which you can then cite with insert_footnote by their id. Use this ONCE before drafting a section, so gathering sources does not fill your own context with search results. Do NOT use it for a single lookup (call the search tool directly), for a topic you have already researched this task, or when the scholar only asked a question.",
    params: {
      topic: { type: 'string', description: 'The topic or claim to gather sources for, in the source language.' },
      focus: { type: 'string', description: 'Optional — narrow the search (a specific ruling, author, period, or which sources to prefer).' },
    },
    required: ['topic'],
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
    name: 'ocr_document',
    description: "Extract the text from a scanned book or photographed pages that are already in the project folder (an @mentioned .pdf or image). CONSENT-GATED: the page images are sent to the EasyEditor cloud OCR service — nothing is uploaded until the scholar approves it once for this project; the first call returns `needsConsent` and you must then stop and tell the scholar to approve it in the Agent panel. The output is saved as a .ocr.txt beside the scan; it is a MACHINE READING with errors (especially nastaʿlīq and worn scans) — pass it to create_chapter with a title marked as an unverified OCR draft, and it must be proofread against the original page by page. NOT citable. Do NOT use for a recording (that is transcribe_media), for a digital .docx (read_document), or for any file outside the project folder.",
    params: {
      scan_path: { type: 'string', description: 'The in-project path of the scan, e.g. "sources/kitab-scan.pdf" (from an @mention).' },
      lang: { type: 'string', description: 'Language hint: "ur", "ar", "en", or "auto" (default).' },
      pages: { type: 'string', description: 'Optional page range for a PDF, e.g. "1-20" or "5". Omit for the whole file.' },
    },
    required: ['scan_path'],
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
    name: 'extract_author_voice',
    description: "Read a few of the scholar's OWN existing chapters and draft a طرز_تحریر.md — a short, editable brief on how they write (register, sentence shape, connectives, preferred terms). The file is then used to match their voice when drafting. It writes a DRAFT the scholar reviews and edits — it NEVER overwrites an existing طرز_تحریر.md (it saves a طرز_تحریر.اقتراح.md alongside instead). Use it once, when the scholar asks the agent to learn or match their style and there is no طرز_تحریر.md yet. Do NOT use it to rewrite a chapter, and do NOT run it every task.",
    params: {
      chapters: { type: 'array', items: { type: 'string' }, description: 'Optional — which chapter file names to learn from. Omit to use the whole project (up to a few).' },
    },
    required: [],
    effect: 'write',
  },
  {
    name: 'critique',
    description: "Hand a chapter (or one section of it) to a REASONING model for a rigorous second opinion — the way a muḥaqqiq or thesis supervisor scrutinises work before it is published. It reads the text itself and returns a critique: verdict, what holds up, numbered problems, gaps. ADVISORY only — it changes nothing; act on its points yourself (add a caveat, a margin comment, or tell the scholar). Use it after drafting a contested section or completing a takhrīj, or when the scholar asks for a critical review. Do NOT use it for a copy-edit (run_task) or to check one citation (that is insert_footnote's own claim check).",
    params: {
      chapter: { type: 'string', description: 'The chapter file name.' },
      kind: { type: 'string', description: 'What kind of scrutiny.', enum: ['draft', 'argument', 'takhrij', 'sourcing'] },
      section_heading: { type: 'string', description: 'Optional — critique only the section under this heading.' },
      focus: { type: 'string', description: 'Optional — what you most want scrutinised.' },
    },
    required: ['chapter'],
    effect: 'read',
  },
  {
    name: 'compile_ai_disclosure',
    description: "Compile the project's AI-assistance disclosure statement from the ledger EasyEditor keeps automatically (every draft_section and substantive run_task write). Writes AI-DISCLOSURE.md to the project root — a bilingual, editable front-matter statement listing which chapters had AI drafting or rewriting help, the models used, and the dates. Use when the scholar asks for an AI disclosure, acknowledgement, or declaration. Do NOT use it to add anything to a chapter, and do NOT invent entries — it only reports what the ledger already recorded.",
    params: {
      title: { type: 'string', description: 'Optional — the book title, used in the opening sentence.' },
    },
    required: [],
    effect: 'write',
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

  // ── M11 Phase 4: Excel write tool (ADR-0048) ────────────────────────
  {
    name: 'build_spreadsheet',
    description: "Create an Excel workbook — one or more sheets, each with data, LIVE formulas, and cell formatting — in a single COM session (M12 Phase D). Use for tabular results, financial calculations (e.g. a zakat/farā'iḍ breakdown), or any data that benefits from a real, re-editable spreadsheet rather than a flat table. Writes to the project export/ folder. `ToolParam` cannot express a nested object, so `sheets` is a JSON-encoded array — see the parameter description for its exact shape. A formula's `cell` is A1 notation (e.g. \"C9\") and `formula` is exactly what a person would type into Excel (e.g. \"=SUM(B2:B8)\", \"=C9*0.025\") — write REAL formulas, not their computed values, so the sheet stays live when the scholar edits an input. Do NOT use for a one-off table in the chat (that is the agent's own table artifact) or to re-export an existing spreadsheet to PDF/CSV (that is a file-conversion task, not this tool).",
    params: {
      filePath: { type: 'string', description: 'Output file path (relative to the project export/ folder, e.g. "zakat.xlsx").' },
      sheets: {
        type: 'string',
        description:
          'JSON-encoded array of sheet objects: [{ name: string, data?: unknown[][], ' +
          'formulas?: [{ cell: string, formula: string }], ' +
          'format?: [{ range: string, bold?: boolean, fontSize?: number, fontColor?: string, ' +
          "fontName?: string, numberFormat?: string, horizontalAlign?: 1|2|3, autoFit?: boolean, " +
          'bgColor?: string, rtl?: boolean }] }, ...]. The first sheet renames the workbook\'s own ' +
          'default sheet; every other one is added. Set `rtl: true` in a format entry (with `fontName: ' +
          '"Jameel Noori Nastaleeq"`, falling back to Amiri automatically if that face is not installed) ' +
          'for an Urdu/Arabic sheet.',
      },
      format: { type: 'string', enum: ['xlsx', 'csv', 'pdf'], description: 'Output format (default: xlsx — csv/pdf drop formulas and every sheet but the first).' },
    },
    required: ['filePath', 'sheets'],
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
