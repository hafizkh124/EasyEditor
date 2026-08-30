// @vitest-environment node
// shared/convert/planner.ts — the M8 Layer 3 seed (SPEC-M8 §3/§4). What must
// hold: a route reports EVERY lossy edge it crosses (honesty is mandatory,
// §4), an impossible pair is refused with a reason that says what's missing
// rather than a crash or a silent best-effort (ADR-0017), and pdf→docx is
// recognised as Word's reflow, not a plain export.
import { describe, it, expect } from 'vitest';
import { planConversion, conversionLosses } from '../../shared/convert/planner';
import type { AdapterDescriptor } from '../../shared/adapters/types';

const word: AdapterDescriptor = {
  id: 'word',
  label: 'Microsoft Word',
  reads: [
    { format: 'docx', quality: 1 },
    { format: 'html', quality: 0.75 },
    { format: 'pdf', quality: 0.5, lossy: 'Exact page layout is lost.' },
  ],
  writes: [
    { format: 'docx', quality: 1 },
    { format: 'pdf', quality: 0.95 },
    { format: 'txt', quality: 0.4, lossy: 'All formatting and footnotes are dropped.' },
  ],
  ops: ['toWord', 'fromWord', 'reflowPdf'],
  platforms: ['win32'],
};

describe('planConversion', () => {
  it('finds a direct route and reports no loss for a clean pair', () => {
    const plan = planConversion({ from: 'html', to: 'docx', adapters: [word] });
    expect(plan).toEqual({
      ok: true,
      steps: [{ adapterId: 'word', from: 'html', to: 'docx', op: 'exportDocument' }],
      losses: [],
    });
  });

  it('collects the lossy note from the write edge', () => {
    const plan = planConversion({ from: 'docx', to: 'txt', adapters: [word] });
    expect(plan.ok && plan.losses).toEqual(['All formatting and footnotes are dropped.']);
  });

  it('collects lossy notes from BOTH the read and write edges', () => {
    const lossy: AdapterDescriptor = {
      ...word, id: 'x',
      reads: [{ format: 'rtf', quality: 0.5, lossy: 'read side loses A' }],
      writes: [{ format: 'txt', quality: 0.4, lossy: 'write side loses B' }],
    };
    const plan = planConversion({ from: 'rtf', to: 'txt', adapters: [lossy] });
    expect(plan.ok && plan.losses).toEqual(['read side loses A', 'write side loses B']);
  });

  it('treats pdf → docx as a reflow step, not a plain export', () => {
    const plan = planConversion({ from: 'pdf', to: 'docx', adapters: [word] });
    expect(plan.ok && plan.steps[0].op).toBe('reflowPdf');
    expect(plan.ok && plan.losses.length).toBeGreaterThan(0);
  });

  it('refuses pdf → anything-but-docx', () => {
    const plan = planConversion({ from: 'pdf', to: 'rtf', adapters: [word] });
    expect(plan.ok === false && plan.reason).toMatch(/editable Word document/);
  });

  it('refuses same-format', () => {
    const plan = planConversion({ from: 'docx', to: 'docx', adapters: [word] });
    expect(plan).toMatchObject({ ok: false });
    expect(plan.ok === false && plan.reason).toMatch(/both/i);
  });

  it('refuses a target no adapter can write, naming it', () => {
    const plan = planConversion({ from: 'docx', to: 'inpage', adapters: [word] });
    expect(plan).toMatchObject({ ok: false });
    expect(plan.ok === false && plan.reason).toMatch(/write "inpage"/);
  });

  it('refuses a source no adapter can read, naming it', () => {
    const plan = planConversion({ from: 'inpage', to: 'docx', adapters: [word] });
    expect(plan.ok === false && plan.reason).toMatch(/read "inpage"/);
  });

  it('refuses when neither side is supported', () => {
    const plan = planConversion({ from: 'inpage', to: 'md', adapters: [word] });
    expect(plan.ok === false && plan.reason).toMatch(/read "inpage" or write "md"/);
  });

  it('refuses cleanly with no adapters at all', () => {
    expect(planConversion({ from: 'html', to: 'docx', adapters: [] })).toMatchObject({ ok: false });
  });
});

describe('conversionLosses', () => {
  it('returns the loss array for a valid route', () => {
    expect(conversionLosses({ from: 'docx', to: 'txt', adapters: [word] })).toEqual(['All formatting and footnotes are dropped.']);
  });
  it('returns null when there is no route', () => {
    expect(conversionLosses({ from: 'inpage', to: 'docx', adapters: [word] })).toBeNull();
  });
});
