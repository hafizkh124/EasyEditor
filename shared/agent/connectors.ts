/**
 * M9 Phase 1b — source connectors the scholar can switch off per project.
 *
 * A connector groups the agent tools that talk to one outside source. When it
 * is off (in `.easyeditor/project.json` `connectors`), those tools are not
 * shown to the model and any playbook step that needs one is skipped.
 *
 * Pure — no runtime globals.
 */

export interface Connector {
  id: string;
  /** Short label for the toggle row. */
  label: string;
  /** Tools that stop being available when this connector is off. */
  tools: string[];
}

export const CONNECTORS: Connector[] = [
  { id: 'shamela', label: 'Maktaba Shamela', tools: ['search_shamela'] },
  { id: 'tafsir', label: 'Tafsir sources', tools: ['query_tafseer'] },
  { id: 'hadith', label: 'Hadith collections', tools: ['search_hadith'] },
  { id: 'web', label: 'General web research', tools: ['search_general', 'search_repositories'] },
];

const TOOL_TO_CONNECTOR = new Map<string, string>();
for (const c of CONNECTORS) for (const t of c.tools) TOOL_TO_CONNECTOR.set(t, c.id);

/** The connector a tool belongs to, or null when the tool is always available. */
export function connectorForTool(tool: string): string | null {
  return TOOL_TO_CONNECTOR.get(tool) ?? null;
}

/** A connector is on unless the map explicitly says `false`. */
export function isConnectorOn(connectors: Record<string, boolean> | undefined, id: string): boolean {
  return connectors?.[id] !== false;
}

/** True when this tool's connector is switched off. */
export function isToolDisabled(connectors: Record<string, boolean> | undefined, tool: string): boolean {
  const id = connectorForTool(tool);
  return id != null && !isConnectorOn(connectors, id);
}
