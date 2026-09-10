/**
 * M11 Phase 4 — layout presets for Word output (ADR-0048).
 * Combines trim size + margins + gutter + line spacing + header into
 * a single unit. Each preset maps to a set of `setPrintLayout` and
 * `setRtlPageSetup` parameters.
 */

export interface LayoutPreset {
  id: string;
  label: string;
  /** Trim size in cm. */
  trimWidthCm: number;
  trimHeightCm: number;
  /** Margins in cm. */
  marginTopCm: number;
  marginBottomCm: number;
  marginLeftCm: number;
  marginRightCm: number;
  /** Gutter in cm (for binding). */
  gutterCm: number;
  /** Mirror margins for duplex printing. */
  mirrorMargins: boolean;
  /** Line spacing in points. */
  lineSpacingPt: number;
  /** Header text (optional). */
  headerOdd?: string;
  headerEven?: string;
}

export type LayoutPresetId =
  | "a4-essay"
  | "a5-booklet"
  | "waziri"
  | "digest"
  | "fatwa-pad";

export const LAYOUT_PRESETS: Record<LayoutPresetId, LayoutPreset> = {
  "a4-essay": {
    id: "a4-essay",
    label: "A4 Essay",
    trimWidthCm: 21.0,
    trimHeightCm: 29.7,
    marginTopCm: 2.54,    // 1"
    marginBottomCm: 2.54,
    marginLeftCm: 2.54,
    marginRightCm: 2.54,
    gutterCm: 0,
    mirrorMargins: false,
    lineSpacingPt: 24,     // 1.5 line spacing (approx)
  },
  "a5-booklet": {
    id: "a5-booklet",
    label: "A5 Booklet",
    trimWidthCm: 14.8,
    trimHeightCm: 21.0,
    marginTopCm: 2.0,
    marginBottomCm: 2.0,
    marginLeftCm: 2.0,
    marginRightCm: 1.5,
    gutterCm: 1.5,
    mirrorMargins: true,
    lineSpacingPt: 20,
  },
  "waziri": {
    id: "waziri",
    label: "Waziri",
    trimWidthCm: 17.0,
    trimHeightCm: 24.0,
    marginTopCm: 2.54,
    marginBottomCm: 2.54,
    marginLeftCm: 2.8,
    marginRightCm: 2.0,
    gutterCm: 0,
    mirrorMargins: false,
    lineSpacingPt: 22,
  },
  "digest": {
    id: "digest",
    label: "Digest",
    trimWidthCm: 14.0,
    trimHeightCm: 21.6,
    marginTopCm: 1.9,      // ~0.75"
    marginBottomCm: 1.9,
    marginLeftCm: 1.9,
    marginRightCm: 1.9,
    gutterCm: 0,
    mirrorMargins: false,
    lineSpacingPt: 18,
  },
  "fatwa-pad": {
    id: "fatwa-pad",
    label: "Fatwa Pad",
    trimWidthCm: 21.0,
    trimHeightCm: 29.7,
    marginTopCm: 2.54,
    marginBottomCm: 2.54,
    marginLeftCm: 3.0,     // wider left for binding
    marginRightCm: 2.0,
    gutterCm: 0,
    mirrorMargins: false,
    lineSpacingPt: 24,
    headerOdd: ".Fatwa",
  },
};

/** Resolve a layout preset by id. Returns undefined for unknown ids. */
export function resolveLayoutPreset(id: string): LayoutPreset | undefined {
  return LAYOUT_PRESETS[id as LayoutPresetId];
}

/** All available preset IDs. */
export const LAYOUT_PRESET_IDS = Object.keys(LAYOUT_PRESETS) as LayoutPresetId[];
