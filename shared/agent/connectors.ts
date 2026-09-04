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
  /**
   * Off unless the project turns it on (M9 Phase 9 — the network-dependent
   * global repositories are opt-in, ADR-0028). Everything else is on by default.
   */
  defaultOff?: boolean;
}

export const CONNECTORS: Connector[] = [
  { id: 'shamela', label: 'Maktaba Shamela', tools: ['search_shamela'] },
  { id: 'tafsir', label: 'Tafsir sources', tools: ['query_tafseer'] },
  { id: 'hadith', label: 'Hadith collections', tools: ['search_hadith'] },
  { id: 'web', label: 'General web research', tools: ['search_general'] },
  { id: 'repositories', label: 'Global repositories (Archive.org, OpenAlex)', tools: ['search_repositories'], defaultOff: true },
];

const BY_ID = new Map(CONNECTORS.map((c) => [c.id, c]));

const TOOL_TO_CONNECTOR = new Map<string, string>();
for (const c of CONNECTORS) for (const t of c.tools) TOOL_TO_CONNECTOR.set(t, c.id);

/** The connector a tool belongs to, or null when the tool is always available. */
export function connectorForTool(tool: string): string | null {
  return TOOL_TO_CONNECTOR.get(tool) ?? null;
}

/**
 * A connector is on unless the map says otherwise. Most default on (absent =
 * on); a `defaultOff` connector needs an explicit `true`.
 */
export function isConnectorOn(connectors: Record<string, boolean> | undefined, id: string): boolean {
  const v = connectors?.[id];
  if (typeof v === 'boolean') return v;
  return !BY_ID.get(id)?.defaultOff;
}

/** True when this tool's connector is switched off. */
export function isToolDisabled(connectors: Record<string, boolean> | undefined, tool: string): boolean {
  const id = connectorForTool(tool);
  return id != null && !isConnectorOn(connectors, id);
}
