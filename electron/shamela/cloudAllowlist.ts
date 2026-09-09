/**
 * Cloud Shamela (شامله لنک) — MCP tool allowlist + arg sanitiser (ADR-0044).
 *
 * A near-verbatim copy of `electron/tafsir/allowlist.ts`. The cloud MCP client
 * may only call tools named here, and only with args whose shapes match the
 * static schema below.
 *
 * ⚠️  PROVISIONAL. `shamela.link/mcp` exposes 34 tools; the exact names/args are
 *     pinned during the live OAuth test (`docs/manual/shamela-cloud-oauth-check.md`
 *     — action `listTools`). The names below mirror the vendored `shamela-mcp`
 *     (`tools/shamela-bridge/vendor/`); the hosted server may differ. This file
 *     is the single source of truth — fix it here, and `normaliseCloud*` in
 *     `cloudClient.ts`, after the live test.
 */

export type ToolArgType = 'number' | 'string' | 'boolean' | 'string[]';

export interface ToolSpec {
  name: string;
  title?: string;
  args?: Record<string, ToolArgType>;
}

export const CLOUD_ENDPOINT = 'https://shamela.link/mcp';

export const SHAMELA_CLOUD_TOOL_ALLOWLIST: ToolSpec[] = [
  { name: 'shamela_search_pages', title: 'بحث في الصفحات', args: { query: 'string', limit: 'number', book_id: 'number', page: 'number', scope: 'string' } },
  { name: 'shamela_search_books', title: 'بحث في الكتب', args: { query: 'string', limit: 'number' } },
  { name: 'shamela_search_authors', title: 'بحث في المؤلفين', args: { query: 'string', limit: 'number' } },
  { name: 'shamela_get_page', title: 'قراءة صفحة', args: { book_id: 'number', page: 'number' } },
  { name: 'shamela_health', title: 'حالة الخادم' },
];

/** Bounds applied to every numeric argument regardless of tool. */
const NUMBER_MIN = 0;
const NUMBER_MAX = 1_000_000;

/** Hard cap on text returned from a single cloud tool call. */
export const MAX_RESULT_CHARS = 50_000;

export function getCloudToolSpec(name: string): ToolSpec | undefined {
  return SHAMELA_CLOUD_TOOL_ALLOWLIST.find((t) => t.name === name);
}

export function isAllowedCloudTool(name: string): boolean {
  return getCloudToolSpec(name) !== undefined;
}

/**
 * Validates and sanitizes tool arguments against the allowlist schema. Throws
 * on unknown tools or type mismatches; unknown keys are dropped; numbers are
 * coerced + range-clamped; strings trimmed; arrays filtered to their element type.
 */
export function validateCloudToolArgs(name: string, rawArgs: unknown): Record<string, unknown> {
  const spec = getCloudToolSpec(name);
  if (!spec) {
    throw new Error(`نامعلوم ٹول: ${name} — شامله لنک کی سفید فہرست میں نہیں ہے۔`);
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
    if (value === undefined) continue;
    switch (type) {
      case 'number': {
        const n = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(n)) throw new Error(`ٹول ${name} کا دلیل ${key} ایک عدد ہونا چاہیے۔`);
        out[key] = Math.min(NUMBER_MAX, Math.max(NUMBER_MIN, Math.trunc(n)));
        break;
      }
      case 'string': {
        out[key] = (typeof value === 'string' ? value : String(value)).trim();
        break;
      }
      case 'boolean': {
        if (typeof value !== 'boolean') throw new Error(`ٹول ${name} کا دلیل ${key} ایک بولین ہونا چاہیے۔`);
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
