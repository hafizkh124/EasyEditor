# ADR 0037 — Connectors Hub and the curated registry

**Status:** Accepted · **Date:** 2026-09-09 · **Milestone:** Connectors Hub · **Extends:** [ADR-0028](./0028-m9-federated-knowledge-tiers.md)

## Context

M9 Phase 1b gave the agent a connector switch — `shared/agent/connectors.ts`
(`CONNECTORS`: shamela / tafsir / hadith / web / repositories), a per-project
on/off map in `.easyeditor/project.json`, and a bare checkbox list buried in
the composer's `+` popover. With more connectors landing (Bahouth relabel,
Dorar, Ilm rijāl, an offline lexicon, Ganjoor, Urdu prosody) that surface does
not scale: no per-connector status, no categories, no way to see latency, and
no place to turn on a connector that ships disabled. The user's ask: a real
"Connectors Hub" — a categorised grid of cards with a live health dot, a
one-click toggle, a test-ping, and an "Add" affordance.

The tension: "Add a connector" as literally described (paste an MCP URL or a
local command) fights the closed tool registry (ADR-0016 control 1) and adds
SSRF / arbitrary-code surface. The user chose the curated shape.

## Decision

### The registry grows metadata; it stays pure

`Connector` gains `category` (islamic-sciences / hadith-rijal / quranic-lexicon
/ persian-adab / urdu-adab), `descriptionKey` (i18n key), `icon` (a lucide name
string — resolved by a renderer map so this file keeps no React import),
`healthKind`, and `docsHref?`. A `reviewedEndpoint?: never` field is the seam
for a future vetted-URL flow — declared so the type and the "Add" dialog can
grow without a schema change, read by nothing today.

`shared/agent/connectors.ts` is imported by both the Electron main process and
the renderer (`scripts/check-shared-purity.mjs`), so all health probing,
downloads and icon components live outside it: `electron/ipc/connectorsHandlers.ts`,
the per-connector adapters, `src/lib/connectors/health.ts`, and the icon map in
`ConnectorCard.tsx`.

### Two layers of connector state

- **GLOBAL** — `userData/connectors.json` (`electron/connectors/globalStore.ts`),
  "this connector is available on this machine". Edited from Settings → Connectors.
- **PROJECT** — `.easyeditor/project.json` `connectors`, "use it for this
  project". Edited from the composer `+` popover (unchanged).

`mergeConnectorState(global, project)` folds them — **project wins > global >
`defaultOff`** — and returns an explicit `id → boolean` for every connector.
`electron/agent/run.ts` passes the merged map to `isToolDisabled`, so the model
sees a connector's tools only when both layers agree. The composer greys a
globally-disabled row and points to Settings rather than letting a per-project
"on" imply availability it does not have.

Rationale for two layers rather than one: a Settings page that only edited the
open project would do nothing with no project open and would surprise a scholar
who "turned Ganjoor on" once and found it off in the next project. The global
layer is the machine-level answer to "is this thing set up"; the project layer
stays the fine-grained "use it here".

### Health is probed by `healthKind`, one IPC channel

`CONNECTORS_INVOKE` with an action switch (the Shamela / Tafsir pattern):
`list` (returns `CONNECTORS` + the merged map — the renderer never hard-codes
the list), `setEnabled { id, on, scope }`, `ping { id }`. `ping` dispatches:
`mcp` → the connector's MCP client `ping()`; `http` → a 12 s timed `fetch` to a
fixed health URL; `local-native` → the installation detector; `local-file` →
`fs.existsSync`; `bridged` → `{ ok: null }` ("checked at query time via your
signed-in session" — hadith/web go through the renderer research bridge, there
is nothing to ping from main); `compute` → `{ ok: true }`. A probe never
throws — a failure is `{ ok: false, error, detail }` the card renders as 🔴 +
a one-line hint.

### "Add a connector" = enable a bundled connector, nothing more

The dialog lists the connectors whose merged state is off and offers "Enable"
(writes the global layer). Its copy says plainly: EasyEditor ships a vetted
set; arbitrary URLs and local commands are not supported. No URL field, no
command field. A reviewed-endpoint flow, if it is ever wanted, is a separate
ADR that fills in `reviewedEndpoint` — it is not a small config toggle.

## Consequences

**Positive**
- Every source is now one card with a status dot, a toggle, and a latency
  read-out; a scholar can see at a glance what is set up and what is off.
- The registry model and the two-layer merge are the spine the remaining
  Connectors-Hub phases (Dorar, Ilm, lexicon, Ganjoor, prosody) bolt onto —
  each adds one `CONNECTORS` entry with its `healthKind` and nothing else new.
- Refusing arbitrary endpoints keeps ADR-0016's closed registry intact: the
  model's tool vocabulary is still exactly what ships in `AGENT_TOOLS`.

**Negative**
- Two state layers can legitimately disagree (global off, project on) — the
  composer has to show and explain that, which is more UI than one map.
- The Hub is desktop-only this milestone (`window.electronAPI.connectors`).
  Web renders nothing; web parity is a per-connector follow-up under M10.
- `healthKind: 'bridged'` connectors (hadith, web) show "checked when used"
  rather than a real status — honest, but less satisfying than a green dot.

## Follow-ups

- Web parity: an `agent-model`-style edge surface for the Hub, per connector.
- A reviewed-endpoint flow (fills in `reviewedEndpoint`) if a real need appears.
- Phases 2–7 of the plan: the intent classifier / tool gating, then the new
  connectors themselves.
