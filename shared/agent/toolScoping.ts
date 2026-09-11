/**
 * M9 ADR-0027 F2 — dynamic tool pruning.
 *
 * The model is never shown the whole registry at once: a large tool list
 * dilutes attention and invites a wrong pick on a surface keyword match. This
 * narrows `toolsForMode`'s output to the tools a given request could actually
 * need — by the matched playbook's steps, or by a keyword-detected domain.
 *
 * Two invariants this must never break:
 *  1. FLOOR — list_capabilities, read_document, search_corpus are always present.
 *  2. CITATION CLOSURE — if any citable search tool is exposed in a write-capable
 *     mode, insert_footnote is exposed too, so retrieval can always be cited.
 *
 * Pure — no runtime globals.
 */
import type { AgentMode, AgentTool } from './types.js';
import { toolsForMode, getTool, CLARIFY_TOOL } from './toolSchemas.js';
import { connectorForTool } from './connectors.js';
import type { Playbook } from '../playbooks/registry.js';

/** Always available, whatever the request. */
export const FLOOR_TOOLS = ['list_capabilities', 'read_document', 'search_corpus'] as const;

/** Tools whose results may become a footnote (grow as tiers land). `research_topic` gathers sources into the same ledger. */
export const CITABLE_SEARCH_TOOLS = ['search_corpus', 'search_shamela', 'query_tafseer', 'search_hadith', 'grade_hadith', 'lookup_narrator', 'lookup_lexicon', 'search_persian_poetry', 'lookup_urdu_verse', 'research_topic', 'jkhssn_narrator', 'jkhssn_takhrij', 'jkhssn_judgments'] as const;

export interface DomainRule {
  /** Matched case-insensitively against the ask (substring). */
  keywords: string[];
  /** Extra tools this domain needs, on top of the floor. */
  tools: string[];
  /**
   * The single source connector this domain maps to, when one dominates. Used
   * by the intent classifier (`shared/agent/intent.ts`) to decide whether an
   * ask can be gated to one connector. A rule that spans several sources
   * (fatwa, review) leaves this unset.
   */
  connector?: string;
}

/**
 * Domain rules, most specific first. A miss on every rule means "no narrowing"
 * — the full mode set is returned.
 */
const DOMAIN_RULES: DomainRule[] = [
  {
    keywords: ['فتویٰ', 'فتوى', 'استفتاء', 'نازلہ', 'حکم شرعی', 'مذاہب', 'fatwa', 'istifta', 'ruling', 'madhhab', 'madhahib'],
    tools: ['query_tafseer', 'search_hadith', 'search_shamela', 'search_general', 'research_topic', 'insert_footnote', 'draft_section'],
  },
  {
    // ADR-0043 — a bare "what does this Arabic word mean in Urdu" is the lexicon
    // connector's job (more specific than the tafsir rule below).
    keywords: [
      'لغوی معنی', 'لغوی معنیٰ', 'لغوی مفہوم', 'لفظ کا مطلب', 'لفظ کا معنی', 'اس لفظ کے معنی', 'عربی سے اردو', 'اردو معنی',
      'معجم', 'مفردات', 'مصباح اللغات', 'القاموس الوحید', 'المعاني', 'almaany', 'lexical meaning', 'dictionary meaning', 'مادہ لغوی',
    ],
    tools: ['lookup_lexicon', 'query_tafseer', 'search_shamela', 'insert_footnote'],
    connector: 'lexicon',
  },
  {
    keywords: [
      'تفسیر', 'تفسير', 'آیت', 'آية', 'قرآن', 'قرآني', 'quran', 'tafsir', 'tafseer', 'ayah', 'aya', 'verse', 'nuzool', 'نزول',
      // Bahouth / Markaz Tafsir lexical work (ADR-0039): Qur'anic roots + qirāʾāt.
      'جذر', 'الجذر', 'قرآنی جڑ', 'قرآنی مادہ', 'quranic root', 'قراءات', 'قراءة', 'قرات', 'qiraat', 'qeraat', 'لفظی تجزیہ',
    ],
    tools: ['query_tafseer', 'search_shamela', 'search_general', 'research_topic', 'insert_footnote', 'draft_section'],
    connector: 'tafsir',
  },
  {
    // ADR-0040 — a grading / authenticity question is الدرر السنية's job.
    keywords: [
      'درجہ حدیث', 'درجۃ الحدیث', 'صحت حدیث', 'حکم الحدیث', 'حكم الحديث', 'خلاصة حكم', 'is this hadith authentic',
      'is this hadith sahih', 'ضعیف ہے', 'صحیح ہے', 'موضوع ہے', 'hadith grade', 'grade of this hadith', 'authenticity of the hadith',
      'علت', 'علل', 'ادراج', 'مدرج', 'ilal', 'illah',
    ],
    tools: ['grade_hadith', 'jkhssn_judgments', 'jkhssn_takhrij', 'search_hadith', 'search_shamela', 'insert_footnote'],
    connector: 'dorar',
  },
  {
    // ADR-0041 — a question ABOUT A NARRATOR (not a hadith) is علم الرجال's job.
    keywords: [
      'راوی کا حال', 'راوی کے حالات', 'ترجمة الراوي', 'ترجمہ راوی', 'جرح و تعدیل', 'جرح وتعديل', 'اسماء الرجال', 'أسماء الرجال',
      'ثقہ ہے', 'ثقة أم', 'ضعيف الحديث', 'تهذيب الكمال', 'شیوخه', 'تلاميذه', 'شيوخ الراوي', 'narrator reliability', 'narrator biography',
      'is this narrator', 'who did this narrator', 'raawi ka haal', 'کتنی احادیث روایت', 'مرتبہ', 'تقریب', 'طبقہ',
    ],
    tools: ['lookup_narrator', 'jkhssn_narrator', 'search_hadith', 'search_shamela', 'insert_footnote'],
    connector: 'rijal',
  },
  {
    keywords: ['حدیث', 'حديث', 'سند', 'اسناد', 'راوی', 'رواة', 'جرح', 'تعدیل', 'hadith', 'hadeeth', 'isnad', 'sanad', 'rijal', 'rawi', 'takhrij', 'تخریج', 'takhreej', 'شجرہ', 'شجرۂ', 'مدار', 'مدارِ'],
    tools: ['search_hadith', 'grade_hadith', 'lookup_narrator', 'jkhssn_sanad_tree', 'jkhssn_takhrij', 'jkhssn_narrator', 'search_shamela', 'search_general', 'insert_footnote', 'add_document_comment'],
    connector: 'hadith',
  },
  {
    // ADR-0045 — navigating جوامع الكلم's own fiqh / thematic index.
    keywords: [
      'موضوعاتی', 'موضوعی اشاریہ', 'ابواب الفقہ', 'ابواب فقہ', 'کتاب الطہارۃ', 'باب سے احادیث', 'thematic hadith', 'hadith on the topic of',
      'فہرست موضوعات', 'اشاریہ موضوعات', 'فقہی ابواب',
    ],
    tools: ['jkhssn_thematic', 'jkhssn_takhrij', 'search_hadith', 'search_shamela', 'insert_footnote'],
    connector: 'jkhssn',
  },
  {
    keywords: ['نظرثانی', 'نگران', 'supervisor', 'audit', 'مراجعة', 'تقييم', 'review my', 'تنقیدی', 'تحقیق', 'مسودہ', 'محقق', 'muhaqqiq', 'نقد', 'critique', 'critical review'],
    tools: ['search_shamela', 'search_corpus', 'search_general', 'insert_footnote', 'add_document_comment', 'check_consistency', 'critique'],
  },
  {
    keywords: ['audio', 'lecture', 'recording', 'transcribe', 'درس', 'خطاب', 'ریکارڈنگ', 'آڈیو', 'تقریر', 'محاضرة'],
    tools: ['transcribe_media', 'create_chapter', 'draft_section', 'search_shamela', 'insert_footnote'],
  },
  {
    keywords: ['ocr', 'scan', 'scanned', 'digitise', 'digitize', 'photographed', 'اسکین', 'سکین', 'عکسی', 'مصورة', 'ڈیجیٹائز', 'برائے تحویل نص'],
    tools: ['ocr_document', 'create_chapter', 'draft_section'],
  },
  {
    keywords: ['کالم', 'مضمون', 'مقالہ', 'ترجمہ', 'ترجمة', 'column', 'essay', 'translate', 'translation', 'paper', 'draft a', 'write a chapter'],
    tools: ['create_chapter', 'draft_section', 'research_topic', 'search_shamela', 'search_general', 'search_repositories', 'insert_footnote', 'check_consistency'],
  },
  {
    keywords: ['اسلوب', 'طرز تحریر', 'طرزِ تحریر', 'میرا انداز', 'my style', 'my voice', 'writing style', 'author voice', 'like i write', 'match my'],
    tools: ['extract_author_voice', 'read_document', 'draft_section'],
  },
  {
    keywords: ['افشا', 'اعتراف', 'اقرار', 'disclosure', 'disclose', 'acknowledgement', 'acknowledgment', 'ai-assisted', 'ai assistance', 'ai use statement', 'declare ai'],
    tools: ['compile_ai_disclosure'],
  },
  {
    keywords: ['archive.org', 'openalex', 'repository', 'repositories', 'journal', 'مقالات', 'thesis', 'dissertation', 'مخطوطات محفوظة', 'edition scan', 'bibliograph'],
    tools: ['search_repositories', 'search_shamela', 'search_general', 'insert_footnote', 'draft_section'],
    connector: 'repositories',
  },
  {
    keywords: ['فونٹ', 'font', 'nastaliq', 'nastaleeq', 'نستعلیق', 'template', 'ٹیمپلیٹ', 'dotx'],
    tools: ['install_font', 'install_template', 'set_page_layout'],
  },
  {
    keywords: ['مخطوط', 'مخطوطة', 'نسخ', 'فروق النسخ', 'apparatus', 'collate', 'critical edition', 'witness', 'نسخہ', 'تدوین'],
    tools: ['compare_manuscript_variants', 'insert_footnote', 'add_document_comment', 'build_scholarly_indexes', 'search_shamela'],
  },
  {
    keywords: ['typeset', 'کمپوزنگ', 'print', 'press', 'گٹر', 'gutter', 'trim', 'اشاعت', 'کتابت', 'طباعة', 'تنضيد', 'پرنٹ ریڈی'],
    tools: ['typeset_print_ready', 'set_page_layout', 'convert_document', 'build_scholarly_indexes'],
  },
  {
    keywords: ['فہرست', 'اشاریہ', 'index', 'indexes', 'فہارس', 'فهرس', 'فهارس', 'أعلام'],
    tools: ['build_scholarly_indexes', 'set_page_layout', 'convert_document', 'query_tafseer', 'search_hadith'],
  },
  {
    // ADR-0042 — Persian poetry → Ganjoor.
    keywords: [
      'فارسی شعر', 'فارسی کلام', 'شعر فارسی', 'مثنوی', 'رومی', 'مولوی', 'سعدی', 'حافظ', 'عطار', 'اقبال فارسی', 'اقبال لاهوری',
      'persian poetry', 'persian verse', 'masnavi', 'rumi', 'saadi', 'hafiz', 'ganjoor', 'گنجور',
    ],
    tools: ['search_persian_poetry'],
    connector: 'ganjoor',
  },
  {
    // ADR-0042 — Urdu / Persian metre scanning + the bundled Urdu verse corpus.
    keywords: [
      'تقطیع', 'تقطيع', 'بحر', 'عروض', 'وزن', 'وزنِ شعر', 'شعر کا وزن', 'مصرع', 'ارکان', 'افاعیل', 'زحاف',
      'taqti', 'taqtee', 'prosody', 'scansion', 'meter of this', 'metre of this', 'دیوانِ غالب', 'کلامِ اردو', 'اردو شعر',
    ],
    tools: ['scan_urdu_prosody', 'lookup_urdu_verse'],
    connector: 'urdu-prosody',
  },
  {
    // M12 Phase C — the zakat compute engine (ADR-0048).
    keywords: [
      'زکوٰۃ', 'زکاۃ', 'زكاة', 'نصاب', 'حول', 'صدقۃ الفطر', 'صدقة الفطر', 'فطرانہ', 'فدیہ', 'کفارہ', 'كفارة',
      'zakat', 'zakah', 'nisab', 'nisaab', 'hawl', 'sadaqat al-fitr', 'fidya', 'kaffara', 'kaffarah',
    ],
    tools: ['calculate_zakat'],
    connector: 'zakat',
  },
  {
    // M12 Phase B/C — the fara'id (inheritance) compute engine.
    keywords: [
      'وراثت', 'میراث', 'ترکہ', 'فرائض', 'مواریث', 'عصبہ', 'ذوی الفروض', 'حصے وراثت', 'وارث', 'ورثاء',
      'inheritance', 'faraid', 'faraaid', "fara'id", 'estate share', 'islamic inheritance', 'heirs share',
    ],
    tools: ['calculate_faraid'],
    connector: 'faraid',
  },
];

/**
 * M10 Phase 2.1 — tools that reach Word COM or the local file system and so
 * cannot exist on web at all, whatever the mode. `list_capabilities` already
 * tells the model the truth about this per-machine (it is never in this set —
 * FLOOR must always be exposed); this is the second, structural half: the
 * model is never even offered these on web, so it cannot promise a chapter
 * layout change or a font install it has no way to perform.
 */
export const NATIVE_ONLY_TOOLS = new Set<string>([
  'typeset_print_ready', 'set_page_layout', 'convert_document', 'build_scholarly_indexes',
  'install_font', 'install_template', 'set_global_option', 'run_task',
  // Word's own diff engine (word.compareManuscripts) — not in the M10 plan's
  // table verbatim, but it is exactly as Word-COM-bound as the tools above.
  'compare_manuscript_variants',
  // ADR-0045 — the جوامع الكلم engine is a bundled local SQLite index, desktop only.
  'jkhssn_sanad_tree', 'jkhssn_narrator', 'jkhssn_takhrij', 'jkhssn_judgments', 'jkhssn_thematic',
  // M11 Phase 4 — Excel write requires Excel COM on desktop (ADR-0048).
  'build_spreadsheet',
]);

export interface ScopeContext {
  /** The free-text ask, for keyword domain detection. */
  ask?: string;
  /** A matched playbook — restricts to its steps' tools. */
  playbook?: Playbook | null;
  /** Absent (desktop, and every pre-M10 caller) keeps today's behavior — full
   *  registry. `'web'` strips NATIVE_ONLY_TOOLS after every other narrowing
   *  step, so a playbook or domain match can never resurrect one. */
  platform?: 'web' | 'desktop';
  /**
   * Intent-classifier tool gating (ADR-0038). When set (an array, even empty),
   * every SOURCE-CONNECTOR tool is dropped UNLESS its connector id is listed —
   * `[]` therefore means "no connector tools at all" (a plain-editing ask).
   * Applied strictly SUBTRACTIVELY, after playbook/domain narrowing and before
   * the citation-closure + FLOOR tail. Non-connector tools are never touched.
   */
  gateConnectors?: string[];
}

/**
 * The keyword domain rules that fire for `ask` (most specific first). Exported
 * so `shared/agent/intent.ts` can ask "does this map to exactly one connector?"
 * without re-implementing the match.
 */
export function matchDomains(ask: string): DomainRule[] {
  const lower = ask.toLowerCase();
  return DOMAIN_RULES.filter((r) => r.keywords.some((k) => lower.includes(k.toLowerCase())));
}

/**
 * The tool set for one request: `toolsForMode` narrowed by playbook or domain,
 * then the two invariants re-applied.
 */
export function toolsFor(mode: AgentMode, ctx: ScopeContext = {}): AgentTool[] {
  const fullBase = toolsForMode(mode);
  // Strip native-only tools BEFORE any narrowing, so a playbook or domain
  // match can never resurrect one via FLOOR_TOOLS/allowed.add — `modeNames`
  // below is derived from this already-stripped list.
  const base = ctx.platform === 'web' ? fullBase.filter((t) => !NATIVE_ONLY_TOOLS.has(t.name)) : fullBase;
  const writeCapable = mode !== 'ask';

  let allowed: Set<string> | null = null;

  if (ctx.playbook) {
    allowed = new Set<string>(FLOOR_TOOLS);
    allowed.add('run_playbook');
    for (const step of ctx.playbook.steps) allowed.add(step.tool);
  } else if (ctx.ask && ctx.ask.trim()) {
    const matched = matchDomains(ctx.ask);
    if (matched.length > 0) {
      allowed = new Set<string>(FLOOR_TOOLS);
      allowed.add('run_playbook');
      for (const rule of matched) for (const tName of rule.tools) allowed.add(tName);
    }
  }

  // Intent-classifier connector gating (ADR-0038) — strictly subtractive, runs
  // after playbook/domain narrowing so a domain match can never re-add a
  // connector the classifier ruled out. If no narrowing fired, gate the full
  // mode set instead of returning it whole.
  if (ctx.gateConnectors) {
    const gate = new Set(ctx.gateConnectors);
    const keep = (name: string) => {
      const cid = connectorForTool(name);
      return cid === null || gate.has(cid);
    };
    if (!allowed) {
      allowed = new Set<string>(base.map((t) => t.name).filter(keep));
    } else {
      allowed = new Set<string>([...allowed].filter(keep));
    }
    for (const f of FLOOR_TOOLS) allowed.add(f);
    allowed.add('run_playbook');
  }

  // No narrowing rule fired — the full mode set stands (+ the clarify pseudo-tool).
  if (!allowed) return [...base, CLARIFY_TOOL];

  // CITATION CLOSURE — retrieval must always be citable.
  if (writeCapable) {
    const exposesCitableSearch = [...allowed].some((n) => (CITABLE_SEARCH_TOOLS as readonly string[]).includes(n));
    if (exposesCitableSearch) allowed.add('insert_footnote');
  }

  // SHAMELA CLOSURE (ADR-0044) — read_shamela_page / find_shamela_book are
  // follow-ups to search_shamela; wherever search_shamela survives narrowing,
  // so do they.
  if (allowed.has('search_shamela')) {
    allowed.add('read_shamela_page');
    allowed.add('find_shamela_book');
  }

  // Keep only tools that exist AND are valid for this mode (Ask stays read-only).
  const modeNames = new Set(base.map((t) => t.name));
  const out = [...allowed]
    .filter((n) => modeNames.has(n))
    .map((n) => getTool(n))
    .filter((t): t is AgentTool => Boolean(t));

  // FLOOR guaranteed (they are all read-effect, so always in `base`).
  for (const fName of FLOOR_TOOLS) {
    if (!out.some((t) => t.name === fName)) {
      const t = getTool(fName);
      if (t && modeNames.has(fName)) out.push(t);
    }
  }
  out.push(CLARIFY_TOOL);
  return out;
}
