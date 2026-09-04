// @vitest-environment node
// shared/agent/connectors.ts (M9 Phase 1b). A connector groups the tools that
// talk to one outside source; switching it off (per project) hides those tools
// and skips any playbook step that needs one.
import { describe, it, expect } from 'vitest';
import { CONNECTORS, connectorForTool, isConnectorOn, isToolDisabled } from '../../shared/agent/connectors';

describe('connectors', () => {
  it('maps each grouped tool to its connector', () => {
    expect(connectorForTool('search_shamela')).toBe('shamela');
    expect(connectorForTool('query_tafseer')).toBe('tafsir');
    expect(connectorForTool('search_hadith')).toBe('hadith');
    expect(connectorForTool('search_general')).toBe('web');
  });

  it('an ungrouped tool has no connector (always available)', () => {
    expect(connectorForTool('read_document')).toBeNull();
    expect(connectorForTool('insert_footnote')).toBeNull();
  });

  it('a connector is ON unless the map explicitly says false', () => {
    expect(isConnectorOn(undefined, 'shamela')).toBe(true);
    expect(isConnectorOn({}, 'shamela')).toBe(true);
    expect(isConnectorOn({ shamela: true }, 'shamela')).toBe(true);
    expect(isConnectorOn({ shamela: false }, 'shamela')).toBe(false);
  });

  it('isToolDisabled is true only when the tool has a connector AND it is off', () => {
    expect(isToolDisabled({ shamela: false }, 'search_shamela')).toBe(true);
    expect(isToolDisabled({ shamela: false }, 'query_tafseer')).toBe(false); // different connector
    expect(isToolDisabled({ tafsir: false }, 'read_document')).toBe(false);  // no connector
    expect(isToolDisabled(undefined, 'search_shamela')).toBe(false);
  });

  it('every connector lists at least one real-looking tool name', () => {
    for (const c of CONNECTORS) {
      expect(c.tools.length).toBeGreaterThan(0);
      expect(c.tools.every((t) => /^[a-z_]+$/.test(t))).toBe(true);
    }
  });
});
