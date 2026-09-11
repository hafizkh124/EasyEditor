# ADR 0048 — Excel Write Capability, and the Zakat + Farāʾiḍ Compute Engines

**Status:** Accepted (amended M12) · **Date:** 2026-09-10, amended 2026-09-11 · **Milestone:** M11 (Phase 4) / M12 (Phases A–C) · **Extends:** [ADR-0049](./0049-m11-derived-agent-affordances.md)

## Context

M11 added `build_spreadsheet` (Excel write via PowerShell COM) alongside a
first, dead-code zakat stub (`shared/finance/zakat.ts`, zero references). This
ADR's original text described that stub as if it were wired up, and claimed
tests (`zakat.test.ts`) that never existed — an overclaim caught during the
M12 planning audit. M12 replaces the stub with two real, from-scratch/ported
compute engines and corrects the record here.

## Decisions (as amended)

**Two deterministic compute engines, never the model.** `shared/zakat/`
(Phase A — ported from the user's own verified `E:\islamic-calculator`,
لجنۃ العلماء / Al-Ulama Institute) and `shared/faraid/` (Phase B — written
from scratch, zero code from any external repo, Jumhūr/standard fiqh view,
validated against a 134-case ilmsummit.org-derived gold-set, 133/134 passing —
see `shared/faraid/RULES.md`). Both are pure, runtime-agnostic TypeScript with
no network access and no live price feed — gold/silver/currency prices are
always supplied by the scholar/mufti (wrong price = wrong fiqh result). The
model NEVER performs zakat or inheritance arithmetic; it only assembles the
JSON `calculate_zakat` / `calculate_faraid` take and reports their output
verbatim, including each line's Qur'anic dalīl and the mandatory non-fatwā
`note`. `shared/finance/zakat.ts` (the old dead stub) is deleted.

**Two new agent tools, one JSON-string parameter each (Phase C).**
`ToolParam` cannot express a nested object, so `calculate_zakat` and
`calculate_faraid` each take a single `input: string` parameter — a
JSON-encoded `ZakatInput` / `FaraidInput` — parsed and validated in
`dispatch.ts` (desktop) and `webDispatch.ts` (web; both engines are pure, so
web gets full parity, unlike `scan_urdu_prosody`/`lookup_urdu_verse` which
have no web dispatch case). Each call emits a `table` artifact (heir/asset →
share/amount → dalīl) before returning the full result object. Registered as
two new connectors (`zakat`, `faraid`; category `islamic-finance`,
`healthKind: 'compute'`, on by default — no network/download dependency to
gate) and two new playbooks (`zakat-assessment-workflow`,
`faraid-fatwa-workflow`), with matching `toolScoping.ts` domain rules and
`intent.ts` gate guidance.

**`build_spreadsheet` — status unchanged, still not release-ready.** The
original decision stands (`wordBridge.ps1` operations, `NATIVE_ONLY_TOOLS`,
file path + sheets array), but the M12 planning audit found it has no
multi-sheet support, an orphaned `setFormula`/`formatCells` path, a
`format:'pdf'/'csv'` branch that throws before it is reached, and no Excel RTL
support — all deferred to M12 Phase D, not part of this amendment.

**Mufti sign-off is a release gate, not a suggestion.** Neither engine ships
as "final" until a mufti has reviewed `shared/zakat/RULES.md` and
`shared/faraid/RULES.md` (M12 Phase G) — including `shared/faraid/RULES.md`'s
one documented known limitation (a rare compound grandfather + lone-full-
sister + separate-paternal-sibling-tier scenario, §9).

## Consequences

- Deleted: `shared/finance/zakat.ts` and the (dead) `shared/finance/`
  directory.
- New: `shared/zakat/{constants,types,nisab,metals,calculator,charity,RULES.md}`;
  `shared/faraid/{rational,heirs,hajb,shares,asaba,awlRadd,specialCases,
  dhawilArham,calculator,index,RULES.md}`; `calculate_zakat` / `calculate_faraid`
  in `toolSchemas.ts`, `dispatch.ts`, `webDispatch.ts`, `loop.ts` (`labelFor`);
  `zakat` / `faraid` connectors + `islamic-finance` category in
  `connectors.ts` (+ `ConnectorsHub.tsx`'s and the test's own hardcoded
  category-order lists — each had to be updated separately, they are not
  derived from the `ConnectorCategory` union); `zakat-assessment-workflow` /
  `faraid-fatwa-workflow` in `shared/playbooks/registry.ts`; `agent.step.*` +
  `connectors.*.desc` + `connectors.category.islamic-finance` i18n keys ×3
  locales.
- `build_spreadsheet` and its `NATIVE_ONLY_TOOLS` membership are unchanged by
  this amendment — see M12 Phase D for its real fix.
- Tests: `zakatNisab.test.ts`, `zakatCalculator.test.ts`, `zakatCharity.test.ts`
  (20); `faraidGoldSet.test.ts` (135, `it.each` over the gold-set + the one
  documented gap), `faraidEngine.test.ts` (10, contract); `agentDispatch.test.ts`
  / `webDispatch.test.ts` additions for both new tool cases (parse errors
  handled, real engine output, artifact emission); `agentConnectors.test.ts` /
  `agentPlaybooks.test.ts` additions for the two new connectors/playbooks.
