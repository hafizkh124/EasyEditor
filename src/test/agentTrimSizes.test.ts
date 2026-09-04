// @vitest-environment node
// shared/print/trimSizes.ts (M9 Phase 8). typeset_print_ready resolves a named
// trim to cm; `custom` needs explicit, sane dimensions.
import { describe, it, expect } from 'vitest';
import { resolveTrim, TRIM_CM, PRINT_LAYOUT_LOSS } from '../../shared/print/trimSizes';

describe('resolveTrim', () => {
  it('resolves the named sizes', () => {
    expect(resolveTrim('a5')).toMatchObject({ w: 14.8, h: 21 });
    expect(resolveTrim('waziri')).toMatchObject({ w: 17, h: 24 });
    expect(resolveTrim('6x9')?.label).toMatch(/6 . 9/);
  });

  it('custom needs both dimensions, within sane bounds', () => {
    expect(resolveTrim('custom', 12, 18)).toEqual({ w: 12, h: 18, label: '12 × 18 cm' });
    expect(resolveTrim('custom', 12)).toBeNull();
    expect(resolveTrim('custom', 2, 3)).toBeNull();     // too small
    expect(resolveTrim('custom', 100, 200)).toBeNull(); // too big
  });

  it('an unknown name is null', () => {
    expect(resolveTrim('tabloid')).toBeNull();
  });

  it('the loss list is stated (ADR-0025 — print-ready Word, not press-grade)', () => {
    expect(PRINT_LAYOUT_LOSS.join(' ')).toMatch(/not press typesetting/i);
    expect(PRINT_LAYOUT_LOSS.join(' ')).toMatch(/widow\/orphan/i);
    expect(Object.keys(TRIM_CM)).toContain('waziri');
  });
});
