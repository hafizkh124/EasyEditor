// @vitest-environment node
// shared/quran/surahNames.ts + electron/agent/adapters/tafsir.ts (M9 Phase 1,
// ADR-0022). The adapter connects the Tafsir MCP client on demand, maps the
// agent's mode to an allowlisted tool, and returns a CITABLE chunk
// (book + sūrah + āyah).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseAyahRef, surahLabel } from '../../shared/quran/surahNames';

describe('parseAyahRef', () => {
  it('reads numeric surah:ayah', () => {
    expect(parseAyahRef('2:255')).toEqual({ surah: 2, ayah: 255 });
  });
  it('reads Arabic-Indic digits', () => {
    expect(parseAyahRef('٢:٢٥٥')).toEqual({ surah: 2, ayah: 255 });
  });
  it('reads a transliterated name', () => {
    expect(parseAyahRef('al-baqarah:255')).toEqual({ surah: 2, ayah: 255 });
  });
  it('reads an Arabic sūrah name', () => {
    expect(parseAyahRef('البقرة 255')).toEqual({ surah: 2, ayah: 255 });
  });
  it('rejects garbage', () => {
    expect(parseAyahRef('the whole quran')).toBeNull();
    expect(parseAyahRef('999:1')).toBeNull();
  });
});

it('surahLabel maps a number to its Arabic name', () => {
  expect(surahLabel(1)).toBe('الفاتحة');
  expect(surahLabel(114)).toBe('الناس');
});

const isConnected = vi.fn(() => false);
const connectRemote = vi.fn(async () => ({ mode: 'remote', connected: true, tools: [] }));
const connectLocal = vi.fn();
const callTool = vi.fn(async () => ({ tool: 'fetch_tafsir', text: 'قوله تعالى: الله لا إله إلا هو…', length: 30, truncated: false }));
vi.mock('../../electron/tafsir/mcpClient.ts', () => ({ isConnected, connectRemote, connectLocal, callTool }));

let queryTafseer: typeof import('../../electron/agent/adapters/tafsir').queryTafseer;
beforeEach(async () => {
  vi.clearAllMocks();
  isConnected.mockReturnValue(false);
  ({ queryTafseer } = await import('../../electron/agent/adapters/tafsir'));
});

describe('queryTafseer', () => {
  it('connects remote on demand, calls the mapped tool, returns a citable chunk', async () => {
    const r = await queryTafseer({ reference: '2:255', mode: 'tafsir', sources: ['tabari'] });
    expect(connectRemote).toHaveBeenCalled();
    expect(callTool).toHaveBeenCalledWith('fetch_tafsir', expect.objectContaining({ surah: 2, ayah: 255, sources: ['tabari'] }));
    expect(r.chunks).toHaveLength(1);
    expect(r.chunks[0].reference).toMatch(/البقرة: 255/);
    expect(r.chunks[0].id).toMatch(/^tafsir:tafsir:tabari:/);
  });

  it('errors clearly when the reference cannot be parsed', async () => {
    isConnected.mockReturnValue(true);
    const r = await queryTafseer({ reference: 'somewhere', mode: 'ayah' });
    expect(r.error).toMatch(/could not read the āyah reference/);
    expect(callTool).not.toHaveBeenCalled();
  });

  it('errors (not throws) when neither remote nor local connects', async () => {
    connectRemote.mockRejectedValueOnce(new Error('offline'));
    const r = await queryTafseer({ reference: '1:1', mode: 'ayah' });
    expect(r.error).toMatch(/not reachable/);
  });

  it('search mode works on a free-text query', async () => {
    const r = await queryTafseer({ reference: 'الميزان يوم القيامة', mode: 'search' });
    expect(callTool).toHaveBeenCalledWith('search_in_tafsir', expect.objectContaining({ query: 'الميزان يوم القيامة' }));
    expect(r.chunks[0].reference).toMatch(/بحث في التفاسير/);
  });
});
