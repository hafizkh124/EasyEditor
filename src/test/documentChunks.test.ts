// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  chunkDocumentText,
  CHUNK_SIZE,
  CHUNK_OVERLAP,
} from '../../shared/text/documentChunks';

describe('chunkDocumentText (SPEC-M5.9 FR-1.3)', () => {
  it('returns nothing for empty or whitespace-only text', () => {
    expect(chunkDocumentText('')).toEqual([]);
    expect(chunkDocumentText('   \n\t  ')).toEqual([]);
  });

  it('keeps a short document in a single chunk', () => {
    const chunks = chunkDocumentText('ایک مختصر جملہ۔');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].content).toBe('ایک مختصر جملہ۔');
  });

  it('numbers chunks consecutively from zero', () => {
    const chunks = chunkDocumentText('ا'.repeat(CHUNK_SIZE * 4));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it('breaks on an Urdu full stop rather than mid-word', () => {
    // A sentence boundary placed inside the overlap window of the first cut.
    const head = 'ا'.repeat(CHUNK_SIZE - 60);
    const text = `${head}یہ جملہ یہاں ختم ہوتا ہے۔${'ب'.repeat(CHUNK_SIZE)}`;
    const chunks = chunkDocumentText(text);
    expect(chunks[0].content.endsWith('۔')).toBe(true);
  });

  it('overlaps consecutive chunks so a straddling sentence survives whole', () => {
    const text = 'ا'.repeat(CHUNK_SIZE * 3);
    const chunks = chunkDocumentText(text);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].charStart).toBeLessThan(chunks[i - 1].charEnd);
    }
  });

  it('reports offsets that map back onto the trimmed source', () => {
    const text = `${'ا'.repeat(CHUNK_SIZE)}۔${'ب'.repeat(CHUNK_SIZE)}`;
    for (const chunk of chunkDocumentText(text)) {
      expect(text.slice(chunk.charStart, chunk.charEnd).trim()).toBe(chunk.content);
    }
  });

  it('always advances, so no input can spin forever', () => {
    // overlap >= chunkSize is the degenerate case: without the max() guard on
    // `start` this loops without end.
    const chunks = chunkDocumentText('ا'.repeat(500), 10, 50);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThan(600);
  });

  it('is deterministic — the same text always chunks identically', () => {
    const text = `${'سطر ایک۔ '.repeat(300)}`;
    expect(chunkDocumentText(text)).toEqual(chunkDocumentText(text));
  });
});

describe('the Deno mirror stays in sync (risk R2)', () => {
  // scripts/mirror-shared.mjs copies shared/ into supabase/functions/, because
  // an edge deploy bundles only that folder. The copy is manual, so a stale
  // mirror is exactly how the cloud and desktop chunkers drift apart — the
  // failure this file exists to prevent.
  const MIRRORED = ['text/documentChunks.ts', 'text/fileText.ts', 'text/chunk.ts'];

  it.each(MIRRORED)('%s matches its shared/ source', (relative) => {
    const source = readFileSync(`shared/${relative}`, 'utf8');
    const mirror = readFileSync(`supabase/functions/_shared/mirror/${relative}`, 'utf8');
    const body = mirror.split('\n').slice(2).join('\n'); // drop the AUTO-MIRRORED header
    expect(body).toBe(source);
  });
});

describe('chunk constants', () => {
  it('keeps the overlap smaller than the chunk', () => {
    expect(CHUNK_OVERLAP).toBeLessThan(CHUNK_SIZE);
  });
});
