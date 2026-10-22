/**
 * Connectors Hub presets (ADR-0062) — a topic ("Islamic research", "Poetry")
 * as a named set of connectors, so a scholar picks a subject instead of
 * fifteen switches.
 *
 * Applying a preset is ADDITIVE: it turns its members on and leaves every
 * other connector alone. Choosing "Literature" must never switch off the
 * hadith sources someone already relies on.
 *
 * Pure — no runtime globals.
 */
import { CONNECTORS, isConnectorOn } from './connectors.js';

export interface ConnectorPreset {
  id: 'research' | 'literature' | 'web' | 'calculators' | 'everything';
  /** i18n key for the preset's name. */
  labelKey: string;
  /** i18n key for the one-line description. */
  descriptionKey: string;
  /** Connector ids the preset turns on. */
  connectors: string[];
}

/** The Advanced Shamela transports are a deployment choice, not a topic — in no preset. */
const ADVANCED = new Set(CONNECTORS.filter((c) => c.advanced).map((c) => c.id));

export const CONNECTOR_PRESETS: ConnectorPreset[] = [
  {
    id: 'research',
    labelKey: 'connectors.preset.research',
    descriptionKey: 'connectors.preset.research.desc',
    connectors: ['turath', 'tafsir', 'lexicon', 'hadith', 'dorar', 'rijal', 'jkhssn'],
  },
  {
    id: 'literature',
    labelKey: 'connectors.preset.literature',
    descriptionKey: 'connectors.preset.literature.desc',
    connectors: ['lexicon', 'ganjoor', 'urdu-prosody'],
  },
  {
    id: 'web',
    labelKey: 'connectors.preset.web',
    descriptionKey: 'connectors.preset.web.desc',
    connectors: ['web', 'repositories'],
  },
  {
    id: 'calculators',
    labelKey: 'connectors.preset.calculators',
    descriptionKey: 'connectors.preset.calculators.desc',
    connectors: ['zakat', 'faraid'],
  },
  {
    id: 'everything',
    labelKey: 'connectors.preset.everything',
    descriptionKey: 'connectors.preset.everything.desc',
    connectors: CONNECTORS.filter((c) => !ADVANCED.has(c.id)).map((c) => c.id),
  },
];

/** What applying `preset` would change: the members that are currently off. */
export function presetChanges(preset: ConnectorPreset, merged: Record<string, boolean> | undefined): string[] {
  return preset.connectors.filter((id) => !isConnectorOn(merged, id));
}

/** The presets whose every member is already on — for the "selected" state in the Hub. */
export function activePresets(merged: Record<string, boolean> | undefined): ConnectorPreset['id'][] {
  return CONNECTOR_PRESETS.filter((p) => presetChanges(p, merged).length === 0).map((p) => p.id);
}
