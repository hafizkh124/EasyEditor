// @vitest-environment node
// shared/agent/connectors.ts (M9 Phase 1b). A connector groups the tools that
// talk to one outside source; switching it off (per project) hides those tools
// and skips any playbook step that needs one.
import { describe, it, expect } from 'vitest';
import {
  CONNECTORS, connectorForTool, isConnectorOn, isToolDisabled,
  connectorById, connectorsByCategory, mergeConnectorState, CONNECTOR_PROVENANCE_LABEL,
  MULTI_OWNER_TOOLS,
} from '../../shared/agent/connectors';
import en from '@/locales/en.json';
import ur from '@/locales/ur.json';
import ar from '@/locales/ar.json';

describe('connectors', () => {
  it('maps each grouped tool to its connector', () => {
    expect(connectorForTool('search_shamela')).toBe('shamela');
    expect(connectorForTool('query_tafseer')).toBe('tafsir');
    expect(connectorForTool('search_hadith')).toBe('hadith');
    expect(connectorForTool('grade_hadith')).toBe('dorar');
    expect(connectorForTool('lookup_narrator')).toBe('rijal');
    expect(connectorForTool('lookup_lexicon')).toBe('lexicon');
    expect(connectorForTool('search_persian_poetry')).toBe('ganjoor');
    expect(connectorForTool('scan_urdu_prosody')).toBe('urdu-prosody');
    expect(connectorForTool('lookup_urdu_verse')).toBe('urdu-prosody');
    expect(connectorForTool('search_general')).toBe('web');
  });

  it('an ungrouped tool has no connector (always available)', () => {
    expect(connectorForTool('read_document')).toBeNull();
    expect(connectorForTool('insert_footnote')).toBeNull();
  });

  it('a normal connector is ON unless the map explicitly says false', () => {
    expect(isConnectorOn(undefined, 'shamela')).toBe(true);
    expect(isConnectorOn({}, 'shamela')).toBe(true);
    expect(isConnectorOn({ shamela: true }, 'shamela')).toBe(true);
    expect(isConnectorOn({ shamela: false }, 'shamela')).toBe(false);
  });

  it('the repositories connector is OFF by default (opt-in, ADR-0028)', () => {
    expect(isConnectorOn(undefined, 'repositories')).toBe(false);
    expect(isConnectorOn({}, 'repositories')).toBe(false);
    expect(isConnectorOn({ repositories: true }, 'repositories')).toBe(true);
    expect(isToolDisabled(undefined, 'search_repositories')).toBe(true);
    expect(isToolDisabled({ repositories: true }, 'search_repositories')).toBe(false);
  });

  it('isToolDisabled is true only when the tool has a connector AND it is off', () => {
    expect(isToolDisabled({ shamela: false }, 'search_shamela')).toBe(true);
    expect(isToolDisabled({ shamela: false }, 'query_tafseer')).toBe(false); // different connector
    expect(isToolDisabled({ tafsir: false }, 'read_document')).toBe(false);  // no connector
    expect(isToolDisabled(undefined, 'search_shamela')).toBe(false);
  });

  it('every connector lists real-looking tool names (a transport-only connector may list none)', () => {
    for (const c of CONNECTORS) {
      expect(c.tools.every((t) => /^[a-z_]+$/.test(t))).toBe(true);
      // shamela-cloud is a pure transport toggle (ADR-0044) — it owns no tool.
      if (c.id !== 'shamela-cloud') expect(c.tools.length).toBeGreaterThan(0);
    }
  });
});

describe('connector registry model (Connectors Hub)', () => {
  const CATEGORIES = new Set([
    'islamic-sciences', 'hadith-rijal', 'quranic-lexicon', 'persian-adab', 'urdu-adab',
  ]);
  const HEALTH_KINDS = new Set(['mcp', 'http', 'local-native', 'local-file', 'bridged', 'compute']);

  it('every connector carries the Hub metadata', () => {
    for (const c of CONNECTORS) {
      expect(CATEGORIES.has(c.category)).toBe(true);
      expect(HEALTH_KINDS.has(c.healthKind)).toBe(true);
      expect(c.icon).toMatch(/^[a-z0-9-]+$/);
      expect(c.descriptionKey).toMatch(/^connectors\./);
    }
  });

  it('every descriptionKey resolves in all three locales', () => {
    for (const c of CONNECTORS) {
      expect(en, `en:${c.descriptionKey}`).toHaveProperty(c.descriptionKey);
      expect(ur, `ur:${c.descriptionKey}`).toHaveProperty(c.descriptionKey);
      expect(ar, `ar:${c.descriptionKey}`).toHaveProperty(c.descriptionKey);
    }
  });

  it('every category label key resolves in all three locales', () => {
    for (const cat of CATEGORIES) {
      const key = `connectors.category.${cat}`;
      expect(en).toHaveProperty(key);
      expect(ur).toHaveProperty(key);
      expect(ar).toHaveProperty(key);
    }
  });

  it('connectorById + connectorsByCategory cover the whole registry', () => {
    for (const c of CONNECTORS) expect(connectorById(c.id)).toBe(c);
    expect(connectorById('nope')).toBeUndefined();
    const grouped = connectorsByCategory().flatMap((g) => g.connectors);
    expect(grouped.map((c) => c.id).sort()).toEqual(CONNECTORS.map((c) => c.id).sort());
  });

  it('every connector has a provenance label', () => {
    for (const c of CONNECTORS) expect(typeof CONNECTOR_PROVENANCE_LABEL[c.id]).toBe('string');
  });
});

describe('dual Shamela (ADR-0044)', () => {
  it('shamela-cloud is registered, defaultOff, and owns no tool in the map', () => {
    const cloud = connectorById('shamela-cloud');
    expect(cloud).toBeDefined();
    expect(cloud!.defaultOff).toBe(true);
    expect(cloud!.tools).toEqual([]);
    expect(connectorForTool('search_shamela')).toBe('shamela'); // primary owner unchanged
  });

  it('MULTI_OWNER_TOOLS: search_shamela is off only when BOTH transports are off', () => {
    for (const tool of Object.keys(MULTI_OWNER_TOOLS)) {
      expect(isToolDisabled({ shamela: false, 'shamela-cloud': false }, tool)).toBe(true);
      expect(isToolDisabled({ shamela: false, 'shamela-cloud': true }, tool)).toBe(false);
      expect(isToolDisabled({ shamela: true, 'shamela-cloud': false }, tool)).toBe(false);
      expect(isToolDisabled({ shamela: false }, tool)).toBe(true); // cloud is defaultOff
      expect(isToolDisabled(undefined, tool)).toBe(false);          // local defaults on
    }
  });

  it('mergeConnectorState includes shamela-cloud (off by default)', () => {
    expect(mergeConnectorState(undefined, undefined)['shamela-cloud']).toBe(false);
    expect(mergeConnectorState({ 'shamela-cloud': true }, undefined)['shamela-cloud']).toBe(true);
  });

  it('both Shamela transports have a distinct provenance label', () => {
    expect(CONNECTOR_PROVENANCE_LABEL['shamela']).toContain('مقامی');
    expect(CONNECTOR_PROVENANCE_LABEL['shamela-cloud']).toContain('شامله لنک');
  });
});

describe('mergeConnectorState (global under project)', () => {
  it('project wins over global wins over defaultOff', () => {
    // defaultOn connector, no opinion anywhere -> on
    expect(mergeConnectorState({}, {}).shamela).toBe(true);
    // defaultOff connector, no opinion -> off
    expect(mergeConnectorState({}, {}).repositories).toBe(false);
    // global turns a defaultOn connector off; project overrides back on
    expect(mergeConnectorState({ shamela: false }, {}).shamela).toBe(false);
    expect(mergeConnectorState({ shamela: false }, { shamela: true }).shamela).toBe(true);
    // global turns a defaultOff connector on
    expect(mergeConnectorState({ repositories: true }, {}).repositories).toBe(true);
    // project off beats global on
    expect(mergeConnectorState({ repositories: true }, { repositories: false }).repositories).toBe(false);
  });

  it('returns an explicit entry for every connector', () => {
    const merged = mergeConnectorState(undefined, undefined);
    expect(Object.keys(merged).sort()).toEqual(CONNECTORS.map((c) => c.id).sort());
    for (const v of Object.values(merged)) expect(typeof v).toBe('boolean');
  });

  it('isToolDisabled reads a merged map correctly', () => {
    const merged = mergeConnectorState({ tafsir: false }, {});
    expect(isToolDisabled(merged, 'query_tafseer')).toBe(true);
    expect(isToolDisabled(merged, 'search_shamela')).toBe(false);
  });
});
