// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isAllowedIpcChannel, ALLOWED_IPC_CHANNELS } from '../../electron/ipc/registry';
import {
  TAFSIR_TOOL_ALLOWLIST,
  isAllowedTool,
  validateToolArgs,
  MAX_RESULT_CHARS,
  REMOTE_ENDPOINT,
} from '../../electron/tafsir/allowlist';
import { getLocalRuntime } from '../../electron/tafsir/localRuntime';
import {
  TAFSIR_DB_URL,
  TAFSIR_DB_REPO,
  TAFSIR_DB_FILENAME,
  TAFSIR_DB_SHA256,
  TAFSIR_DB_SIZE_MB,
} from '../../electron/tafsir/localRuntime';

describe('Tafsir MCP — IPC registry (SPEC-TAFSIR §FR-4.1)', () => {
  it('registers the tafsir invoke channel', () => {
    expect(ALLOWED_IPC_CHANNELS.TAFSIR_INVOKE).toBe('tafsir:invoke');
    expect(isAllowedIpcChannel('tafsir:invoke')).toBe(true);
  });

  it('registers the install-progress channel', () => {
    expect(ALLOWED_IPC_CHANNELS.TAFSIR_INSTALL_PROGRESS).toBe('tafsir:install-progress');
    expect(isAllowedIpcChannel('tafsir:install-progress')).toBe(true);
  });

  it('rejects unregistered tafsir channels', () => {
    expect(isAllowedIpcChannel('tafsir:unregistered_action')).toBe(false);
  });
});

describe('Tafsir MCP — tool allowlist (SPEC-TAFSIR §FR-1.2)', () => {
  it('exposes the 17 tools verified in the Phase 0 spike', () => {
    expect(TAFSIR_TOOL_ALLOWLIST).toHaveLength(17);
    const names = TAFSIR_TOOL_ALLOWLIST.map((t) => t.name);
    for (const expected of [
      'fetch_ayah',
      'fetch_tafsir',
      'list_tafsir_sources',
      'list_science_sources',
      'list_all_sources',
      'list_sources_for_ayah',
      'fetch_nuzool_reason',
      'fetch_surah_info',
      'analyze_word',
      'find_root_occurrences',
      'get_root_stats',
      'get_qeraat_variants',
      'search_quran_text',
      'search_in_tafsir',
      'get_quran_overview',
      'get_page_fawaed',
      'get_surah_statistics',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('rejects tools outside the allowlist', () => {
    expect(isAllowedTool('fetch_ayah')).toBe(true);
    expect(isAllowedTool('fetch_ayah_debug')).toBe(false);
    expect(isAllowedTool('')).toBe(false);
    expect(isAllowedTool('__proto__')).toBe(false);
  });

  it('does not export the remote endpoint as a callable tool', () => {
    // endpoint is config, not a tool
    expect(REMOTE_ENDPOINT).toMatch(/^https:\/\/mcp\.tafsir\.net\/mcp$/);
    expect(isAllowedTool(REMOTE_ENDPOINT)).toBe(false);
  });
});

describe('Tafsir MCP — argument sanitization (SPEC-TAFSIR NFR-2)', () => {
  it('keeps numeric args and clamps to a sane range', () => {
    const out = validateToolArgs('fetch_ayah', { surah: 2, ayah: 255 });
    expect(out).toEqual({ surah: 2, ayah: 255 });
    // string numbers are coerced
    expect(validateToolArgs('fetch_ayah', { surah: '2', ayah: 255 }).surah).toBe(2);
    // negative / huge clamped
    expect(validateToolArgs('fetch_ayah', { surah: -5, ayah: 1e9 }).surah).toBe(0);
    expect(validateToolArgs('fetch_ayah', { surah: 1, ayah: 1e9 }).ayah).toBeLessThanOrEqual(100_000);
  });

  it('trims string args', () => {
    const out = validateToolArgs('search_quran_text', { query: '  رحمة  ' });
    expect(out.query).toBe('رحمة');
  });

  it('filters string[] args and drops empties', () => {
    const out = validateToolArgs('fetch_tafsir', { surah: 1, ayah: 1, sources: [' saadi ', '', ' tabari '] });
    expect(out.sources).toEqual(['saadi', 'tabari']);
  });

  it('throws on unknown tools', () => {
    expect(() => validateToolArgs('rm_rf', {})).toThrow();
    expect(() => validateToolArgs('fetch_ayah --delete', {})).toThrow();
  });

  it('throws on type mismatches', () => {
    expect(() => validateToolArgs('fetch_ayah', { surah: 'one', ayah: 1 })).toThrow();
    expect(() => validateToolArgs('fetch_ayah', { surah: 1, ayah: {} })).toThrow();
    expect(() => validateToolArgs('fetch_surah_info', { surah: 1, include_en_intro: 'yes' })).toThrow();
    expect(() => validateToolArgs('fetch_ayah', { include: 'tajweed' })).toThrow();
  });

  it('silently drops keys that are not in the schema (defence against injection)', () => {
    const out = validateToolArgs('fetch_ayah', { surah: 1, ayah: 1, malicious: 'x', TAFSIR_DB_PATH: '/etc/passwd' });
    expect(out).toEqual({ surah: 1, ayah: 1 });
  });

  it('exposes the output cap', () => {
    expect(MAX_RESULT_CHARS).toBeGreaterThan(0);
  });
});

describe('Tafsir MCP — local runtime detection (SPEC-TAFSIR §FR-3.1)', () => {
  it('returns a well-formed detect result regardless of environment', () => {
    const det = getLocalRuntime().detect();
    expect(typeof det.pythonFound).toBe('boolean');
    expect(typeof det.uvFound).toBe('boolean');
    expect(typeof det.dbFound).toBe('boolean');
    expect(Array.isArray(det.errors)).toBe(true);
    // Versions are strings when the tool is found, null otherwise.
    if (det.pythonFound) expect(typeof det.pythonVersion).toBe('string');
    if (det.uvFound) expect(typeof det.uvVersion).toBe('string');
  });

  it('keeps the errors list consistent with the boolean flags', () => {
    const det = getLocalRuntime().detect();
    if (!det.pythonFound) expect(det.errors.length).toBeGreaterThan(0);
  });
});

describe('Tafsir MCP — local DB download metadata (SPEC-TAFSIR §FR-3.2)', () => {
  it('points at the official Hugging Face asset', () => {
    expect(TAFSIR_DB_REPO).toBe('tafsircenter/tafsir-mcp-data');
    expect(TAFSIR_DB_FILENAME).toBe('quran.db');
    expect(TAFSIR_DB_URL).toContain('/resolve/main/quran.db');
  });

  it('SHA256 is a valid 64-hex digest (matches data_loader.py)', () => {
    expect(TAFSIR_DB_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('size is the documented ~214 MB', () => {
    expect(TAFSIR_DB_SIZE_MB).toBe(214);
  });

  it('the runtime exposes a downloadDatabase method', () => {
    expect(typeof getLocalRuntime().downloadDatabase).toBe('function');
  });
});
