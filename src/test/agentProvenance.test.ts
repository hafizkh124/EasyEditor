// @vitest-environment node
// shared/agent/connectors.ts — connectorsUsed(): the quiet [ماخذ: …] chip is
// derived from the transcript, so it can never disagree with the run.
import { describe, it, expect } from 'vitest';
import { connectorsUsed } from '../../shared/agent/connectors';

describe('connectorsUsed', () => {
  it('lists a connector whose tool returned rows', () => {
    const used = connectorsUsed([
      { name: 'query_tafseer', result: { chunks: [{ id: 'x' }], text: '…' } },
      { name: 'search_hadith', result: { count: 3, results: [] } },
    ]);
    expect(used).toEqual(['tafsir', 'hadith']);
  });

  it('ignores a tool that errored or returned nothing', () => {
    const used = connectorsUsed([
      { name: 'query_tafseer', result: { error: 'not connected' } },
      { name: 'search_hadith', result: { chunks: [], note: 'no results' } },
      { name: 'search_shamela', result: { count: 0, results: [] } },
    ]);
    expect(used).toEqual([]);
  });

  it('ignores non-connector tools (read_document, insert_footnote, run_task)', () => {
    const used = connectorsUsed([
      { name: 'read_document', result: { headings: ['x'] } },
      { name: 'run_task', result: { applied: 1 } },
      { name: 'insert_footnote', result: { applied: 1 } },
    ]);
    expect(used).toEqual([]);
  });

  it('de-dupes and keeps first-use order', () => {
    const used = connectorsUsed([
      { name: 'search_hadith', result: { count: 1 } },
      { name: 'query_tafseer', result: { count: 2 } },
      { name: 'search_hadith', result: { count: 5 } },
    ]);
    expect(used).toEqual(['hadith', 'tafsir']);
  });

  // ADR-0044 — the Shamela tools carry `transport`; the chip distinguishes.
  it('a search_shamela result tags the transport that served it', () => {
    expect(connectorsUsed([{ name: 'search_shamela', result: { count: 2, results: [], transport: 'local' } }])).toEqual(['shamela']);
    expect(connectorsUsed([{ name: 'search_shamela', result: { count: 2, results: [], transport: 'cloud' } }])).toEqual(['shamela-cloud']);
    expect(connectorsUsed([{ name: 'search_shamela', result: { count: 2, results: [], transport: 'turath' } }])).toEqual(['turath']);
    expect(connectorsUsed([{ name: 'read_shamela_page', result: { text: '…', transport: 'cloud' } }])).toEqual(['shamela-cloud']);
    expect(connectorsUsed([{ name: 'read_shamela_page', result: { text: '…', transport: 'turath' } }])).toEqual(['turath']);
    expect(connectorsUsed([{ name: 'find_shamela_book', result: { books: [{ id: 1 }], transport: 'local' } }])).toEqual(['shamela']);
    expect(connectorsUsed([{ name: 'find_shamela_book', result: { books: [{ id: 1 }], transport: 'turath' } }])).toEqual(['turath']);
  });

  it('a Shamela result with transport "none", an error, or zero hits is not counted', () => {
    expect(connectorsUsed([{ name: 'search_shamela', result: { error: 'x', transport: 'none' } }])).toEqual([]);
    expect(connectorsUsed([{ name: 'search_shamela', result: { count: 0, results: [], transport: 'local' } }])).toEqual([]);
  });
});
