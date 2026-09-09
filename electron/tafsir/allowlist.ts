/**
 * Tafsir MCP — tool allowlist + argument sanitization (SPEC-TAFSIR §FR-1.2 / NFR-2).
 *
 * The renderer may only call tools named here, and only with arguments whose
 * shapes match the static schema below (verified live against the server's
 * `tools/list` during the Phase 0 spike, 2026-08-05). This is a pure module —
 * no electron, no network — so it is directly unit-tested.
 */

export type ToolArgType = 'number' | 'string' | 'boolean' | 'string[]';

export interface ToolSpec {
  name: string;
  title?: string;
  args?: Record<string, ToolArgType>;
}

/**
 * Markaz Tafsir runs the same MCP server behind two brand hostnames — `mcp.`
 * and its research brand `bahouth.` (بحوث). We try them in order (ADR-0039);
 * a missing or identical fallback is harmless.
 */
export const REMOTE_ENDPOINTS = [
  'https://mcp.tafsir.net/mcp',
  'https://bahouth.tafsir.net/mcp',
] as const;

/** Primary endpoint — for callers that just want "the" URL (diagnostics, tests). */
export const REMOTE_ENDPOINT = REMOTE_ENDPOINTS[0];

export const TAFSIR_TOOL_ALLOWLIST: ToolSpec[] = [
  { name: 'fetch_ayah', title: 'آیت', args: { surah: 'number', ayah: 'number', include: 'string[]' } },
  { name: 'fetch_tafsir', title: 'تفسیر', args: { surah: 'number', ayah: 'number', sources: 'string[]', part: 'number' } },
  { name: 'list_tafsir_sources', title: 'تفاسیر کے مصدر' },
  { name: 'list_science_sources', title: 'علوم قرآن کے مصدر' },
  { name: 'list_all_sources', title: 'تمام مصدر' },
  { name: 'list_sources_for_ayah', title: 'آیت کے مصدر', args: { surah: 'number', ayah: 'number' } },
  { name: 'fetch_nuzool_reason', title: 'سبب نزول', args: { surah: 'number', ayah: 'number', sources: 'string[]', part: 'number' } },
  { name: 'fetch_surah_info', title: 'سورہ معلومات', args: { surah: 'number', include_en_intro: 'boolean' } },
  { name: 'analyze_word', title: 'لفظی تجزیہ', args: { surah: 'number', ayah: 'number', word_no: 'number', aspects: 'string[]' } },
  { name: 'find_root_occurrences', title: 'جذر کے وقوعات', args: { root: 'string', limit: 'number' } },
  { name: 'get_root_stats', title: 'جذر کے اعداد', args: { root: 'string' } },
  { name: 'get_qeraat_variants', title: 'قراءات', args: { surah: 'number', ayah: 'number', word_no: 'number' } },
  { name: 'search_quran_text', title: 'قرآنی تلاش', args: { query: 'string', surah_filter: 'number', limit: 'number' } },
  { name: 'search_in_tafsir', title: 'تفسیر میں تلاش', args: { query: 'string', source: 'string', surah_filter: 'number', surah: 'number', limit: 'number' } },
  { name: 'get_quran_overview', title: 'قرآن مجموعی جائزہ' },
  { name: 'get_page_fawaed', title: 'صفحہ کے فوائد', args: { page: 'number' } },
  { name: 'get_surah_statistics', title: 'سورہ اعداد', args: { surah: 'number' } },
];

/** Bounds applied to every numeric argument regardless of tool. */
const NUMBER_MIN = 0;
const NUMBER_MAX = 100_000;

/** Hard cap on text returned to the renderer from a single tool call (NFR-4). */
export const MAX_RESULT_CHARS = 50_000;

export function getToolSpec(name: string): ToolSpec | undefined {
  return TAFSIR_TOOL_ALLOWLIST.find((t) => t.name === name);
}

export function isAllowedTool(name: string): boolean {
  return getToolSpec(name) !== undefined;
}

/**
 * Validates and sanitizes tool arguments against the allowlist schema.
 * Throws on unknown tools, unknown keys, missing required args, or type
 * mismatches. Numbers are coerced from numeric strings and range-clamped;
 * strings are trimmed; arrays are filtered to their element type.
 */
export function validateToolArgs(
  name: string,
  rawArgs: unknown,
): Record<string, unknown> {
  const spec = getToolSpec(name);
  if (!spec) {
    throw new Error(`نامعلوم ٹول: ${name} — Tafsir MCP کی سفید فہرست میں نہیں ہے۔`);
  }
  const schema = spec.args ?? {};
  if (rawArgs === undefined || rawArgs === null) rawArgs = {};
  if (typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
    throw new Error(`ٹول ${name} کے دلائل ایک آبجیکٹ ہونے چاہئیں۔`);
  }
  const input = rawArgs as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, type] of Object.entries(schema)) {
    const value = input[key];
    if (value === undefined) {
      // Optional args are simply omitted — the server fills defaults.
      continue;
    }
    switch (type) {
      case 'number': {
        const n = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(n)) {
          throw new Error(`ٹول ${name} کا دلیل ${key} ایک عدد ہونا چاہیے۔`);
        }
        out[key] = Math.min(NUMBER_MAX, Math.max(NUMBER_MIN, Math.trunc(n)));
        break;
      }
      case 'string': {
        const s = typeof value === 'string' ? value : String(value);
        out[key] = s.trim();
        break;
      }
      case 'boolean': {
        if (typeof value !== 'boolean') {
          throw new Error(`ٹول ${name} کا دلیل ${key} ایک بولین ہونا چاہیے۔`);
        }
        out[key] = value;
        break;
      }
      case 'string[]': {
        if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
          throw new Error(`ٹول ${name} کا دلیل ${key} سٹرنگز کی ایک فہرست ہونی چاہیے۔`);
        }
        out[key] = (value as string[]).map((v) => v.trim()).filter((v) => v.length > 0);
        break;
      }
    }
  }

  return out;
}
