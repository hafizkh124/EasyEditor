// @vitest-environment node
// src/components/workspace/agentArtifactState.ts (M9 ADR-0024). The reducer
// folds artifact events (open / delta / table / citations / close) into an
// ordered list the panel renders. Every variant must round-trip.
import { describe, it, expect } from 'vitest';
import { applyArtifactEvent } from '../components/workspace/agentArtifactState';
import type { AgentArtifactEvent } from '../../shared/agent/types';

const run = (evs: AgentArtifactEvent[]) => evs.reduce(applyArtifactEvent, [] as ReturnType<typeof applyArtifactEvent>);

describe('applyArtifactEvent', () => {
  it('open then replace-delta builds a document artifact', () => {
    const s = run([
      { op: 'open', artifactId: 'a', title: 'Draft', artifactType: 'document' },
      { op: 'delta', artifactId: 'a', mode: 'replace', html: '<p>one</p>' },
      { op: 'delta', artifactId: 'a', mode: 'replace', html: '<p>two</p>' },
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].html).toBe('<p>two</p>');
    expect(s[0].status).toBe('open');
  });

  it('append-delta concatenates', () => {
    const s = run([
      { op: 'open', artifactId: 'a', title: 'T', artifactType: 'transcript' },
      { op: 'delta', artifactId: 'a', mode: 'append', text: 'segment 1 ' },
      { op: 'delta', artifactId: 'a', mode: 'append', text: 'segment 2' },
    ]);
    expect(s[0].text).toBe('segment 1 segment 2');
  });

  it('table and citations variants attach', () => {
    const s = run([
      { op: 'open', artifactId: 'c', title: 'Apparatus', artifactType: 'comparison' },
      { op: 'table', artifactId: 'c', columns: ['موضع', 'المتن'], rows: [['1', 'كذا']] },
    ]);
    expect(s[0].table?.rows[0][1]).toBe('كذا');

    const s2 = run([
      { op: 'open', artifactId: 'd', title: 'Sources', artifactType: 'citation-list' },
      { op: 'citations', artifactId: 'd', entries: [{ marker: '1', reference: 'صحيح البخاري ٣', sourceId: 'x', supported: true }] },
    ]);
    expect(s2[0].citations?.[0].supported).toBe(true);
  });

  it('a citation entry carries the source excerpt + claim for the expand-before-accept view', () => {
    const s = run([
      { op: 'open', artifactId: 'f', title: 'حاشیہ [1]', artifactType: 'citation-list' },
      {
        op: 'citations', artifactId: 'f',
        entries: [{
          marker: '[1]', reference: 'صحيح البخاري، ح ١', sourceId: 'shamela:55:40',
          supported: true, tier: 1, url: 'https://shamela.ws/book/55/40',
          excerpt: 'إنما الأعمال بالنيات', claim: 'Actions are by intention.',
        }],
      },
      { op: 'close', artifactId: 'f', status: 'final', targetChapter: '02.docx' },
    ]);
    expect(s[0].citations?.[0].excerpt).toBe('إنما الأعمال بالنيات');
    expect(s[0].citations?.[0].claim).toBe('Actions are by intention.');
    expect(s[0].citations?.[0].url).toBe('https://shamela.ws/book/55/40');
    expect(s[0].targetChapter).toBe('02.docx');
  });

  it('close marks final and records the target chapter', () => {
    const s = run([
      { op: 'open', artifactId: 'a', title: 'T', artifactType: 'document' },
      { op: 'close', artifactId: 'a', status: 'final', targetChapter: '03.docx' },
    ]);
    expect(s[0].status).toBe('final');
    expect(s[0].targetChapter).toBe('03.docx');
  });

  it('a delta for an unopened artifact is ignored', () => {
    const s = run([{ op: 'delta', artifactId: 'ghost', mode: 'replace', text: 'x' }]);
    expect(s).toHaveLength(0);
  });
});
