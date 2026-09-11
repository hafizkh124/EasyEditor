/**
 * M11 Phase 4 / M12 Phase E — shared/print/layoutPresets.ts. Shipped in M11
 * but never called from anywhere until Phase E wired it into
 * `typeset_print_ready`'s new `preset` param — this pins the values every
 * preset carries and that `resolveLayoutPreset` degrades cleanly on an
 * unknown id.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { LAYOUT_PRESETS, LAYOUT_PRESET_IDS, resolveLayoutPreset, type LayoutPresetId } from '~shared/print/layoutPresets';

describe('LAYOUT_PRESETS', () => {
  it('every preset carries a positive trim size, non-negative margins, a positive line spacing, and a matching id', () => {
    for (const id of LAYOUT_PRESET_IDS) {
      const p = LAYOUT_PRESETS[id];
      expect(p.id).toBe(id);
      expect(p.trimWidthCm).toBeGreaterThan(0);
      expect(p.trimHeightCm).toBeGreaterThan(0);
      expect(p.marginTopCm).toBeGreaterThanOrEqual(0);
      expect(p.marginBottomCm).toBeGreaterThanOrEqual(0);
      expect(p.marginLeftCm).toBeGreaterThanOrEqual(0);
      expect(p.marginRightCm).toBeGreaterThanOrEqual(0);
      expect(p.gutterCm).toBeGreaterThanOrEqual(0);
      expect(p.lineSpacingPt).toBeGreaterThan(0);
      expect(typeof p.label).toBe('string');
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it('"fatwa" is A4, single-sided (no gutter, no mirroring), with its own margins — the letterhead comes from fatwaTemplate.ts, not a header field', () => {
    const p = LAYOUT_PRESETS.fatwa;
    expect(p.trimWidthCm).toBe(21.0);
    expect(p.trimHeightCm).toBe(29.7);
    expect(p.gutterCm).toBe(0);
    expect(p.mirrorMargins).toBe(false);
    expect(p.headerOdd).toBeUndefined();
    expect(p.headerEven).toBeUndefined();
  });

  it('"a4-essay" is a plain single-sided A4 layout — the preset thesis-university-format now applies', () => {
    const p = LAYOUT_PRESETS['a4-essay'];
    expect(p.trimWidthCm).toBe(21.0);
    expect(p.trimHeightCm).toBe(29.7);
    expect(p.gutterCm).toBe(0);
    expect(p.mirrorMargins).toBe(false);
  });

  it('"a5-booklet" and "waziri" are mirror-margined, gutter-bound (for two-sided binding)', () => {
    expect(LAYOUT_PRESETS['a5-booklet'].mirrorMargins).toBe(true);
    expect(LAYOUT_PRESETS['a5-booklet'].gutterCm).toBeGreaterThan(0);
  });
});

describe('resolveLayoutPreset', () => {
  it('resolves every real id to its own preset object', () => {
    for (const id of LAYOUT_PRESET_IDS) {
      expect(resolveLayoutPreset(id)).toBe(LAYOUT_PRESETS[id]);
    }
  });

  it('returns undefined for an unknown id, never throws', () => {
    expect(resolveLayoutPreset('nope')).toBeUndefined();
    expect(resolveLayoutPreset('')).toBeUndefined();
  });

  it('LAYOUT_PRESET_IDS matches the keys of LAYOUT_PRESETS exactly', () => {
    expect(LAYOUT_PRESET_IDS.slice().sort()).toEqual((Object.keys(LAYOUT_PRESETS) as LayoutPresetId[]).slice().sort());
  });
});
