/**
 * M9 Phase 8 — named book trim sizes (cm) for `typeset_print_ready`.
 *
 * `waziri` (وزيري, ~17×24) and `digest` (رقعي-ish, ~14×21) are the two most
 * common for Arabic/Urdu scholarly printing; the rest are the usual Latin book
 * sizes. `custom` takes explicit width/height.
 *
 * Pure — no runtime globals.
 */
export type TrimName = 'a5' | 'b5' | '6x9' | 'waziri' | 'digest' | 'custom';

export const TRIM_CM: Record<Exclude<TrimName, 'custom'>, { w: number; h: number; label: string }> = {
  a5: { w: 14.8, h: 21.0, label: 'A5' },
  b5: { w: 17.6, h: 25.0, label: 'ISO B5' },
  '6x9': { w: 15.24, h: 22.86, label: '6 × 9 in' },
  waziri: { w: 17.0, h: 24.0, label: 'وزيري (17 × 24 cm)' },
  digest: { w: 14.0, h: 21.6, label: 'digest (14 × 21.6 cm)' },
};

export function resolveTrim(
  trim: string,
  customW?: number,
  customH?: number,
): { w: number; h: number; label: string } | null {
  if (trim === 'custom') {
    if (!customW || !customH || customW < 5 || customH < 5 || customW > 40 || customH > 50) return null;
    return { w: customW, h: customH, label: `${customW} × ${customH} cm` };
  }
  return TRIM_CM[trim as Exclude<TrimName, 'custom'>] ?? null;
}

/**
 * What a print-ready WORD layout does NOT give you (ADR-0025). Stated in the
 * tool result so the scholar knows before sending it to a press.
 */
export const PRINT_LAYOUT_LOSS = [
  'This is a Word layout, not press typesetting: no optical kerning or ligature tables, no true small caps, no PDF/X or spot colour.',
  'Line-breaking, hyphenation and widow/orphan control are Word\'s own — review the final PDF before printing.',
  'Embedded fonts must be licensed for embedding; the press may still ask for the fonts separately.',
];
