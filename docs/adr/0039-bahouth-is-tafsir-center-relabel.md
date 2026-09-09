# ADR 0039 — "Bahouth" is Markaz Tafsir, not a second connector

**Status:** Accepted · **Date:** 2026-09-09 · **Milestone:** Connectors Hub (Phase 3) · **Extends:** [ADR-0012](./0012-tafsir-web-via-edge-function.md), [ADR-0037](./0037-connectors-hub-and-curated-registry.md)

## Context

The Connectors Hub plan lists "باحوث (Bahouth)" as a connector for Qur'anic
roots, word analysis and qirāʾāt, separate from "تفسیر سینٹر". Investigation:
بحوث (buḥūth, "research") is Markaz Tafsir's own research brand, and its MCP
server already carries the lexical tools —
`analyze_word`, `find_root_occurrences`, `get_root_stats`,
`get_qeraat_variants`, `search_quran_text`, `search_in_tafsir` are all in the
17-tool allowlist verified during the SPEC-TAFSIR Phase 0 spike. So a "Bahouth
connector" would be a second wrapper around the same server, the same client,
and the same allowlist.

## Decision

### One connector, relabelled

The existing `tafsir` connector becomes **"باحوث — مركز تفسير"** in the registry
(`category: 'quranic-lexicon'`, `healthKind: 'mcp'`). No new connector id, no new
MCP client, no new IPC channel. The retrieved-chunk reference now reads
`… (باحوث / tafsir.net)`.

### A failover endpoint

Markaz Tafsir serves the same MCP server behind two brand hostnames —
`mcp.tafsir.net` and `bahouth.tafsir.net`. `allowlist.ts` gains
`REMOTE_ENDPOINTS = [mcp…, bahouth…]` (`REMOTE_ENDPOINT` stays as `[0]` for
diagnostics and the existing test). `connectRemote()` and `pingRemote()` try
them in order and use the first that answers; the live one is recorded on the
session (`currentEndpoint()`) and surfaced in `TafsirConnectResult.endpoint`
(shown in the connect panel). A missing or identical fallback is harmless — the
loop just moves on or succeeds on the first.

### Lexical modes on `query_tafseer`

`TafseerMode` gains `'root'` and `'qeraat'`:

- **`root`** — the `reference` (or `query`) carries a triliteral root
  (`"نصر"` / `"ن ص ر"`); the adapter calls `find_root_occurrences` **and**
  `get_root_stats` and merges them into one citable chunk (`tafsir:root:<root>`).
  If the stats call fails, the occurrences still come back.
- **`qeraat`** — an āyah reference plus a `word_no` (new optional param on the
  tool schema, shared with `word`); maps to `get_qeraat_variants`.

The `query_tafseer` description now names roots and qirāʾāt, and its "Do NOT use"
clause is tightened to exclude hadith **grading** and **rijāl** questions (which
Phases 4–5 give their own connectors). The `toolScoping` tafsir domain rule
gains root / qirāʾāt keywords so a lexical ask is gated to `tafsir` (ADR-0038).

## Consequences

**Positive**
- No duplicate client / allowlist / IPC surface to keep in sync.
- The failover makes the connector resilient to one hostname being down or
  renamed, at the cost of one extra request only when the primary fails.
- Qur'anic-root and qirāʾāt lookups — real Bahouth features — are now reachable
  from the agent, citable, and correctly gated.

**Negative**
- `bahouth.tafsir.net/mcp` is assumed to be the same server; if it ever diverges
  (different tool set) the shared allowlist would be wrong for it. The connect
  path re-`listTools()` on whichever endpoint wins, so a divergence surfaces as a
  tool-not-allowlisted error rather than silent bad data — acceptable.
- `root` mode spends two MCP calls per lookup. Bounded (one extra, best-effort)
  and worth the merged answer.

## Follow-ups

- Web parity: `tafsir-proxy` (ADR-0012) already reaches the same server; add the
  failover list and the lexical modes there when web parity is picked up.
