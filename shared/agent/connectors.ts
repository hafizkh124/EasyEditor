/**
 * M9 Phase 1b / Connectors Hub — the outside sources the scholar can switch.
 *
 * A connector groups the agent tools that talk to one outside source. When it
 * is off, those tools are not shown to the model and any playbook step that
 * needs one is skipped.
 *
 * Two layers of state (Connectors Hub):
 *  - GLOBAL   — `userData/connectors.json`, "this connector is available on
 *               this machine". Edited from Settings → Connectors.
 *  - PROJECT  — `.easyeditor/project.json` `connectors`, "use it for this
 *               project". Edited from the agent composer's `+` popover.
 * `mergeConnectorState(global, project)` folds them: project wins > global >
 * `defaultOff`. The agent sees a connector only when the merged map says on.
 *
 * Pure — no runtime globals, no `fs` / `fetch` / `electron`. Imported by both
 * the Electron main process and the renderer. Health probing, downloads and
 * icons live outside this file (handlers, adapters, a renderer-side icon map).
 */

/** The Hub groups connectors under one of these (اسلامی علوم / حدیث و رجال / …). */
export type ConnectorCategory =
  | 'islamic-sciences'
  | 'hadith-rijal'
  | 'quranic-lexicon'
  | 'persian-adab'
  | 'urdu-adab'
  // M12 — the zakat and fara'id compute engines (ADR-0048).
  | 'islamic-finance';

/**
 * How the Hub checks a connector is alive:
 *  - `mcp`          — call the connector's MCP client `ping()`
 *  - `http`         — a timed GET to a fixed health URL
 *  - `local-native` — a spawned-binary / installed-library detector
 *  - `local-file`   — an index file is present on disk
 *  - `bridged`      — reached through the signed-in renderer session; checked
 *                     at query time, not here (status is "unknown / n-a")
 *  - `compute`      — pure in-process code, always healthy
 */
export type ConnectorHealthKind =
  | 'mcp'
  | 'http'
  | 'local-native'
  | 'local-file'
  | 'bridged'
  | 'compute';

export interface Connector {
  id: string;
  /** Short label for the toggle row / card title. */
  label: string;
  /** Hub grouping. */
  category: ConnectorCategory;
  /** i18n key for the one-line card description (resolved in the renderer). */
  descriptionKey: string;
  /** lucide-react icon name — resolved by a map in the Hub card component so
   *  this file stays free of React imports. */
  icon: string;
  /** How the Hub health-checks this connector. */
  healthKind: ConnectorHealthKind;
  /** Tools that stop being available when this connector is off. */
  tools: string[];
  /**
   * Off unless it is turned on. The network- or download-dependent connectors
   * are opt-in (ADR-0028 for repositories; ilm / lexicon / ganjoor need a
   * download or a live service). Everything else is on by default.
   */
  defaultOff?: boolean;
  /**
   * ADR-0062 — a deployment choice rather than a topic (the Shamela transports):
   * the Hub keeps it under a collapsed "Advanced" section and no preset
   * includes it. Turath already serves every device.
   */
  advanced?: boolean;
  /** Optional deep-view / help link for the Hub card. */
  docsHref?: string;
  /**
   * Seam for a future reviewed-endpoint flow ("Add Custom Connector" that
   * accepts a vetted URL). Deliberately `never` this milestone — the registry
   * is curated; no code path reads it yet.
   */
  reviewedEndpoint?: never;
}

export const CONNECTORS: Connector[] = [
  {
    id: 'shamela',
    label: 'المكتبة الشاملة (مقامی)',
    category: 'islamic-sciences',
    descriptionKey: 'connectors.shamela.desc',
    icon: 'library-big',
    healthKind: 'local-native',
    tools: ['search_shamela', 'read_shamela_page', 'find_shamela_book'],
    advanced: true,
  },
  {
    // ADR-0044 — the cloud transport for Shamela. Owns NO tool in the map
    // (`tools: []`) — `MULTI_OWNER_TOOLS` below is the whole mechanism for
    // "cloud can also serve search_shamela / read_shamela_page / find_shamela_book".
    // Never a `DomainRule.connector` — gating stays transport-agnostic.
    id: 'shamela-cloud',
    label: 'شامله لنک (سحابي)',
    category: 'islamic-sciences',
    descriptionKey: 'connectors.shamelaCloud.desc',
    icon: 'library-big',
    healthKind: 'mcp',
    tools: [],
    advanced: true,
    defaultOff: true,
    docsHref: 'https://shamela.link',
  },
  {
    // ADR-0054 — Turath.io classical library connector.
    // Backs the multi-owner shamela tools (tools: []).
    id: 'turath',
    label: 'تراث — Turath.io',
    category: 'islamic-sciences',
    descriptionKey: 'connectors.turath.desc',
    icon: 'globe',
    healthKind: 'http',
    tools: [],
    docsHref: 'https://turath.io',
  },
  {
    id: 'tafsir',
    label: 'باحوث — مركز تفسير',
    category: 'quranic-lexicon',
    descriptionKey: 'connectors.tafsir.desc',
    icon: 'book-open-text',
    healthKind: 'mcp',
    tools: ['query_tafseer'],
  },
  {
    id: 'lexicon',
    label: 'عربی–اردو لغت + المعاني',
    category: 'quranic-lexicon',
    descriptionKey: 'connectors.lexicon.desc',
    icon: 'book-a',
    healthKind: 'bridged',
    tools: ['lookup_lexicon'],
  },
  {
    id: 'hadith',
    label: 'Hadith collections',
    category: 'hadith-rijal',
    descriptionKey: 'connectors.hadith.desc',
    icon: 'scroll-text',
    healthKind: 'bridged',
    tools: ['search_hadith'],
  },
  {
    // `grade_hadith` reaches dorar.net through the signed-in research bridge
    // (the edge function's IP is not Cloudflare-blocked, unlike many residential
    // ones) with a direct in-process fetch as a fallback — so health is
    // "checked at query time", not a standalone HTTP probe (ADR-0040 amended).
    id: 'dorar',
    label: 'الدرر السنية — Dorar',
    category: 'hadith-rijal',
    descriptionKey: 'connectors.dorar.desc',
    icon: 'scale',
    healthKind: 'bridged',
    tools: ['grade_hadith'],
  },
  {
    id: 'rijal',
    label: 'علم الرجال — Rijāl',
    category: 'hadith-rijal',
    descriptionKey: 'connectors.rijal.desc',
    icon: 'users',
    healthKind: 'bridged',
    tools: ['lookup_narrator'],
  },
  {
    // ADR-0045 — جوامع الكلم local hadith engine. `local-file`: the connector is
    // healthy when `jkhssn.sqlite` is built (a seed ships, so it works out of
    // the box). Distinct `jkhssn_*` tools, NOT co-owner of lookup_narrator /
    // grade_hadith — different result shapes; the model calls both and reconciles.
    id: 'jkhssn',
    label: 'جوامع الكلم — تخريج و أسانيد (مقامی)',
    category: 'hadith-rijal',
    descriptionKey: 'connectors.jkhssn.desc',
    icon: 'git-fork',
    healthKind: 'local-file',
    tools: ['jkhssn_sanad_tree', 'jkhssn_narrator', 'jkhssn_takhrij', 'jkhssn_judgments', 'jkhssn_thematic'],
  },
  {
    id: 'web',
    label: 'General web research',
    category: 'islamic-sciences',
    descriptionKey: 'connectors.web.desc',
    icon: 'globe',
    healthKind: 'bridged',
    tools: ['search_general'],
  },
  {
    id: 'repositories',
    label: 'Global repositories (Archive.org, OpenAlex)',
    category: 'islamic-sciences',
    descriptionKey: 'connectors.repositories.desc',
    icon: 'database',
    healthKind: 'http',
    tools: ['search_repositories'],
    defaultOff: true,
  },
  {
    id: 'ganjoor',
    label: 'گنجور — Ganjoor',
    category: 'persian-adab',
    descriptionKey: 'connectors.ganjoor.desc',
    icon: 'feather',
    healthKind: 'http',
    tools: ['search_persian_poetry'],
    defaultOff: true,
  },
  {
    id: 'urdu-prosody',
    label: 'اردو عروض / کلامِ اردو',
    category: 'urdu-adab',
    descriptionKey: 'connectors.urdu_prosody.desc',
    icon: 'music-2',
    healthKind: 'compute',
    tools: ['scan_urdu_prosody', 'lookup_urdu_verse'],
  },
  {
    // M12 Phase C — from-scratch, deterministic (ADR-0048). No network, no
    // file, always healthy — same `compute` kind as urdu-prosody.
    id: 'zakat',
    label: 'حسابِ زکوٰۃ و صدقات',
    category: 'islamic-finance',
    descriptionKey: 'connectors.zakat.desc',
    icon: 'calculator',
    healthKind: 'compute',
    tools: ['calculate_zakat'],
  },
  {
    id: 'faraid',
    label: 'علم الفرائض والمواریث',
    category: 'islamic-finance',
    descriptionKey: 'connectors.faraid.desc',
    icon: 'scale',
    healthKind: 'compute',
    tools: ['calculate_faraid'],
  },
];

const BY_ID = new Map(CONNECTORS.map((c) => [c.id, c]));

const TOOL_TO_CONNECTOR = new Map<string, string>();
for (const c of CONNECTORS) for (const t of c.tools) TOOL_TO_CONNECTOR.set(t, c.id);

/**
 * A short provenance label per connector, for the quiet `[ماخذ: …]` chip the
 * agent chat shows when a connector supplied an answer. `labelFor`-style
 * lookup — kept here so it grows alongside `CONNECTORS`.
 */
export const CONNECTOR_PROVENANCE_LABEL: Record<string, string> = {
  shamela: '💻 الشاملة (مقامی)',
  'shamela-cloud': '☁️ شامله لنک',
  turath: '🌐 تراث',
  tafsir: 'باحوث',
  lexicon: 'اللغۃ',
  hadith: 'حدیث',
  dorar: 'درر السنیہ',
  rijal: 'علم الرجال',
  jkhssn: '💻 جوامع الكلم',
  ganjoor: 'گنجور',
  'urdu-prosody': 'اردو عروض',
  web: 'ویب',
  repositories: 'مکتبات',
  zakat: 'حسابِ زکوٰۃ',
  faraid: 'علم الفرائض',
};

/** The connector a tool belongs to, or null when the tool is always available. */
export function connectorForTool(tool: string): string | null {
  return TOOL_TO_CONNECTOR.get(tool) ?? null;
}

/** One connector by id, or undefined. */
export function connectorById(id: string): Connector | undefined {
  return BY_ID.get(id);
}

/** Connectors grouped by category, in registry order, categories in enum order. */
export function connectorsByCategory(): Array<{ category: ConnectorCategory; connectors: Connector[] }> {
  const order: ConnectorCategory[] = [
    'islamic-sciences', 'hadith-rijal', 'quranic-lexicon', 'persian-adab', 'urdu-adab', 'islamic-finance',
  ];
  return order
    .map((category) => ({ category, connectors: CONNECTORS.filter((c) => c.category === category) }))
    .filter((g) => g.connectors.length > 0);
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

/**
 * ADR-0044 — tools more than one connector can satisfy. A listed tool is
 * disabled only when EVERY owner is off (e.g. `search_shamela` survives if
 * either the local or the cloud Shamela transport is on). `connectorForTool`
 * still returns the primary owner for provenance / non-disable purposes.
 */
export const MULTI_OWNER_TOOLS: Record<string, string[]> = {
  search_shamela: ['shamela', 'shamela-cloud', 'turath'],
  read_shamela_page: ['shamela', 'shamela-cloud', 'turath'],
  find_shamela_book: ['shamela', 'shamela-cloud', 'turath'],
};

/** True when this tool's connector(s) are switched off. */
export function isToolDisabled(connectors: Record<string, boolean> | undefined, tool: string): boolean {
  const owners = MULTI_OWNER_TOOLS[tool];
  if (owners) return owners.every((id) => !isConnectorOn(connectors, id));
  const id = connectorForTool(tool);
  return id != null && !isConnectorOn(connectors, id);
}

/**
 * ADR-0038 — which connectors actually supplied results in a finished run, for
 * the quiet `[ماخذ: …]` provenance chip. Derived from the transcript (a tool
 * call with a non-error result that returned rows), so it can never disagree
 * with what the run really did. Order = first use.
 */
export function connectorsUsed(toolCalls: Array<{ name: string; result: unknown }>): string[] {
  const seen: string[] = [];
  const pushOnce = (id: string): void => { if (!seen.includes(id)) seen.push(id); };
  for (const call of toolCalls) {
    const r = call.result;
    if (typeof r !== 'object' || r === null || 'error' in r) continue;
    const rec = r as Record<string, unknown>;

    // ADR-0044 — a Shamela tool result carries which transport served it. Only
    // tag it when it actually returned something.
    if (call.name in MULTI_OWNER_TOOLS) {
      const gave =
        (typeof rec.count === 'number' && rec.count > 0) ||
        (Array.isArray(rec.results) && rec.results.length > 0) ||
        (Array.isArray(rec.books) && rec.books.length > 0) ||
        (typeof rec.text === 'string' && rec.text.length > 0);
      if (gave && rec.transport === 'local') pushOnce('shamela');
      else if (gave && rec.transport === 'cloud') pushOnce('shamela-cloud');
      else if (gave && rec.transport === 'turath') pushOnce('turath');
      continue;
    }

    const id = connectorForTool(call.name);
    if (!id) continue;
    const produced =
      (typeof rec.count === 'number' && rec.count > 0) ||
      (Array.isArray(rec.results) && rec.results.length > 0) ||
      (Array.isArray(rec.chunks) && rec.chunks.length > 0) ||
      (Array.isArray(rec.books) && rec.books.length > 0);
    if (produced) pushOnce(id);
  }
  return seen;
}

/**
 * Fold the global ("available on this machine") and project ("use for this
 * project") switch maps into one explicit `id → boolean` map covering every
 * connector. Precedence: an explicit project value wins, then an explicit
 * global value, then the connector's `defaultOff`.
 *
 * The result has an entry for every connector, so `isConnectorOn` / callers
 * never have to fall back to `defaultOff` again.
 */
export function mergeConnectorState(
  global: Record<string, boolean> | undefined,
  project: Record<string, boolean> | undefined,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const c of CONNECTORS) {
    const p = project?.[c.id];
    const g = global?.[c.id];
    out[c.id] = typeof p === 'boolean' ? p : typeof g === 'boolean' ? g : !c.defaultOff;
  }
  return out;
}
