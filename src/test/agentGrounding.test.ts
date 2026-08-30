// @vitest-environment node
// shared/agent/grounding.ts — the citation integrity gate (ADR-0016 c3 /
// ADR-0019 item 6). `insert_footnote` may only cite a chunk the agent
// actually retrieved this task. What must hold: an id that resolves gives the
// footnote text built from the VERIFIED reference (+ url); an id that doesn't
// resolve throws a clear error the loop feeds back — never a footnote.
import { describe, it, expect, vi } from 'vitest';
import { RetrievalLedger, assertClaimSupported } from '../../shared/agent/grounding';

describe('RetrievalLedger', () => {
  it('resolves an id that was added and builds the footnote text', () => {
    const l = new RetrievalLedger();
    l.add([{ id: 'corpus:5:12', reference: 'Ihya Ulum al-Din, p. 12', source_url: 'https://x/12' }]);
    const chunk = l.resolveOrThrow('corpus:5:12');
    expect(l.footnoteText(chunk)).toBe('Ihya Ulum al-Din, p. 12 — https://x/12');
  });

  it('drops URL-less reference cleanly', () => {
    const l = new RetrievalLedger();
    l.add([{ id: 'a', reference: 'Sahih Muslim #2' }]);
    expect(l.footnoteText(l.resolveOrThrow('a'))).toBe('Sahih Muslim #2');
  });

  it('throws when nothing has been retrieved yet', () => {
    const l = new RetrievalLedger();
    expect(() => l.resolveOrThrow('anything')).toThrow(/nothing has been retrieved/);
  });

  it('throws for an id that is not among the retrieved chunks', () => {
    const l = new RetrievalLedger();
    l.add([{ id: 'real', reference: 'Real Book' }]);
    expect(() => l.resolveOrThrow('made-up')).toThrow(/not one of the 1 chunk/);
  });

  it('throws for a missing / non-string source_id', () => {
    const l = new RetrievalLedger();
    expect(() => l.resolveOrThrow(undefined)).toThrow(/required/);
    expect(() => l.resolveOrThrow('')).toThrow(/required/);
  });

  it('ignores chunks with no id or no reference', () => {
    const l = new RetrievalLedger();
    l.add([
      { id: '', reference: 'no id' },
      { id: 'x', reference: '   ' },
      { id: 'ok', reference: 'good' },
    ] as never);
    expect(l.size).toBe(1);
    expect(l.resolveOrThrow('ok').reference).toBe('good');
  });

  it('de-dupes by id across multiple search calls', () => {
    const l = new RetrievalLedger();
    l.add([{ id: 'a', reference: 'first' }]);
    l.add([{ id: 'a', reference: 'first again' }, { id: 'b', reference: 'second' }]);
    expect(l.size).toBe(2);
  });
});

describe('assertClaimSupported (the optional second tier)', () => {
  it('is a no-op when no claim is given', async () => {
    const check = vi.fn();
    await expect(assertClaimSupported(undefined, 'excerpt', check)).resolves.toBeNull();
    expect(check).not.toHaveBeenCalled();
  });

  it('is a no-op when no checker is available', async () => {
    await expect(assertClaimSupported('the sky is blue', 'excerpt', null)).resolves.toBeNull();
  });

  it('passes through when the checker says the source supports the claim', async () => {
    const check = vi.fn(async () => ({ supports: true, note: 'directly stated' }));
    await expect(assertClaimSupported('X', 'excerpt', check)).resolves.toEqual({ supports: true, note: 'directly stated' });
  });

  it('THROWS when the checker says the source does not support the claim', async () => {
    const check = vi.fn(async () => ({ supports: false, note: 'excerpt is off-topic' }));
    await expect(assertClaimSupported('X', 'excerpt', check)).rejects.toThrow(/does not support this claim.*off-topic/);
  });
});
