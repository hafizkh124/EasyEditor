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
import type { Playbook } from '../playbooks/registry.js';

/** Always available, whatever the request. */
export const FLOOR_TOOLS = ['list_capabilities', 'read_document', 'search_corpus'] as const;

/** Search tools whose results may become a footnote (grow as tiers land). */
export const CITABLE_SEARCH_TOOLS = ['search_corpus', 'search_shamela', 'query_tafseer', 'search_hadith'] as const;

interface DomainRule {
  /** Matched case-insensitively against the ask (substring). */
  keywords: string[];
  /** Extra tools this domain needs, on top of the floor. */
  tools: string[];
}

/**
 * Domain rules, most specific first. A miss on every rule means "no narrowing"
 * — the full mode set is returned.
 */
const DOMAIN_RULES: DomainRule[] = [
  {
    keywords: ['فتویٰ', 'فتوى', 'استفتاء', 'نازلہ', 'حکم شرعی', 'مذاہب', 'fatwa', 'istifta', 'ruling', 'madhhab', 'madhahib'],
    tools: ['query_tafseer', 'search_hadith', 'search_shamela', 'search_general', 'insert_footnote', 'draft_section'],
  },
  {
    keywords: ['تفسیر', 'تفسير', 'آیت', 'آية', 'قرآن', 'قرآني', 'quran', 'tafsir', 'tafseer', 'ayah', 'aya', 'verse', 'nuzool', 'نزول'],
    tools: ['query_tafseer', 'search_shamela', 'search_general', 'insert_footnote', 'draft_section'],
  },
  {
    keywords: ['حدیث', 'حديث', 'سند', 'اسناد', 'راوی', 'رواة', 'جرح', 'تعدیل', 'hadith', 'hadeeth', 'isnad', 'sanad', 'rijal', 'rawi', 'takhrij', 'تخریج', 'takhreej'],
    tools: ['search_hadith', 'search_shamela', 'search_general', 'insert_footnote', 'add_document_comment'],
  },
  {
    keywords: ['نظرثانی', 'نگران', 'supervisor', 'audit', 'مراجعة', 'تقييم', 'review my', 'تنقیدی', 'تحقیق', 'مسودہ', 'محقق', 'muhaqqiq'],
    tools: ['search_shamela', 'search_corpus', 'search_general', 'insert_footnote', 'add_document_comment', 'check_consistency'],
  },
  {
    keywords: ['audio', 'lecture', 'recording', 'transcribe', 'درس', 'خطاب', 'ریکارڈنگ', 'آڈیو', 'تقریر', 'محاضرة'],
    tools: ['transcribe_media', 'create_chapter', 'draft_section', 'search_shamela', 'insert_footnote'],
  },
  {
    keywords: ['کالم', 'مضمون', 'مقالہ', 'ترجمہ', 'ترجمة', 'column', 'essay', 'translate', 'translation', 'paper', 'draft a', 'write a chapter'],
    tools: ['create_chapter', 'draft_section', 'search_shamela', 'search_general', 'insert_footnote', 'check_consistency'],
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
];

export interface ScopeContext {
  /** The free-text ask, for keyword domain detection. */
  ask?: string;
  /** A matched playbook — restricts to its steps' tools. */
  playbook?: Playbook | null;
}

/**
 * The tool set for one request: `toolsForMode` narrowed by playbook or domain,
 * then the two invariants re-applied.
 */
export function toolsFor(mode: AgentMode, ctx: ScopeContext = {}): AgentTool[] {
  const base = toolsForMode(mode);
  const writeCapable = mode !== 'ask';

  let allowed: Set<string> | null = null;

  if (ctx.playbook) {
    allowed = new Set<string>(FLOOR_TOOLS);
    allowed.add('run_playbook');
    for (const step of ctx.playbook.steps) allowed.add(step.tool);
  } else if (ctx.ask && ctx.ask.trim()) {
    const lower = ctx.ask.toLowerCase();
    const matched = DOMAIN_RULES.filter((r) => r.keywords.some((k) => lower.includes(k.toLowerCase())));
    if (matched.length > 0) {
      allowed = new Set<string>(FLOOR_TOOLS);
      allowed.add('run_playbook');
      for (const rule of matched) for (const tName of rule.tools) allowed.add(tName);
    }
  }

  // No narrowing rule fired — the full mode set stands (+ the clarify pseudo-tool).
  if (!allowed) return [...base, CLARIFY_TOOL];

  // CITATION CLOSURE — retrieval must always be citable.
  if (writeCapable) {
    const exposesCitableSearch = [...allowed].some((n) => (CITABLE_SEARCH_TOOLS as readonly string[]).includes(n));
    if (exposesCitableSearch) allowed.add('insert_footnote');
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
