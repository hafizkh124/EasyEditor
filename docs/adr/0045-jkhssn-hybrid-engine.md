# ADR 0045 — JKHSSN: a hybrid local hadith engine over the جوامع الكلم column-store

**Status:** Accepted · **Date:** 2026-09-10 · **Milestone:** JKHSSN + Workspace overhaul (Phase 1) · **Extends:** [ADR-0007](./0007-shamela-native-read.md), [ADR-0019](./0019-agent-architecture.md), [ADR-0041](./0041-rijal-connector-lookup-narrator.md), [ADR-0044](./0044-cloud-shamela-connector.md)

## Context

The user owns a desktop install of **جوامع الكلم** ("جامع خادم الحرمين الشريفين
للسنة النبوية") — a hadith engine with isnād-tree analysis, 30k narrator
biographies, jarh-wa-taʿdīl apparatus, takhrīj, matn comparison, imam rulings and
a 1.35M-link fiqh/thematic index. Its data lives at `D:\JKHSSN\Data\HadithDB` as a
**proprietary column-store export** (originally SQL Server, baked into a file
engine, EngineVer 1.909). Earlier repo scripts
(`scripts/*_jkhssn.py`) only scraped its full-text dictionary — ~48 junk rows,
explicitly BLOCKED in `supabase_bulk_load.py`. Nothing from it reached Supabase.

A Phase 1.0 probe (`scripts/probe_jkhssn_framing.mjs`, run 2026-09-10) **decoded
the format**:

- Per column: `records.bin` (+ `.ind`/`.ord` = sort permutations, *not* offsets;
  `.inf` unused; `RecordsWC.bin` = an FTS word index).
- Row count `N` = any `Type="3"` sibling column's `records.bin` length ÷ 4.
- `Type 3` = int32 LE array; `Type 11` = 1 byte/row bool.
- Text (`Type` 200–203) with **`CustomType="0"`** = plain Windows-1256:
  `records.bin` is `[cp1256 text][trailer]`; trailer = `(N+1)` × 8-byte entries at
  `len − (N+1)*8`; entry `i`'s first u32 = start byte offset of record `i`.
- Text with **`CustomType="1"` / `"3"`** = compressed, format uncracked. This is
  the verbatim diacritised matn (`HCompoundMatn.Matn`), narrator formal names
  (`Nouns.Name/Nasab`), `AsanedTree.Name`, `Subject.SubjectTitle`,
  `BookTOC_Hadith.Tarf/Content`.

So the store yields a **complete relational skeleton** (every id, FK, nested-set
tree, flag, count, hijri date) and the **plain-text scholarly apparatus** (jarh
verdicts, critic quotes, imam rulings, author names, section titles, printed
hadith numbers), but **not** clean narrator display names or matn text.

## Decision

### Hybrid: local skeleton + Supabase/dorar for names & matn

Build a local **`jkhssn.sqlite`** from the readable plain columns only
(`electron/jkhssn/{columnStore,tableMap,buildIndex,schema}.ts`). At query time
the 6 axes resolve:

| Need | Source |
|---|---|
| isnād topology, takhrīj pivots, teacher/student edges, subject tree, service flags, jarh/ruling **text** | `jkhssn.sqlite` (local, instant) |
| narrator **display names** | Supabase `islamicurdubooks-rijal` (`citation_ref.rawy_id`), fallback `classical-rijal`; weak local fallback = most-frequent `NounsForms.RawyTextShape` |
| verbatim **matn** | Supabase `islamicurdubooks-hadith` / `urdu-hadith` |
| canonical **grading** | the `dorar` connector (`grade_hadith`) — جوامع الكلم has `Degree` flags + imam rulings but no single ṣaḥīḥ/ḍaʿīf verdict per narration |
| thematic **titles** (`Subject.SubjectTitle` compressed) | deferred — tree + hits are local; titles resolve later from Shamela's own subject tree |

The Electron **main process cannot reach the signed-in edge functions**
(ADR-0019 #7): the Supabase joins happen **renderer-side** (`useJkhssnAxis` +
`resolveNames.ts`) for UI, and through the existing `session.researchSearch`
bridge for the agent adapter (`electron/agent/adapters/jkhssn.ts`), mirroring how
`lookup_narrator` already works.

### Ship a seed, keep a runtime rebuild

The readable-columns index is **~245 MB (~80 MB LZMA)** with matn-comparison
excluded — a `flags_bits` bitfield instead of JSON on `service_state`, a
contentless FTS5 with a small `fts_map`, and no `subject_hit(hadith_main_id)`
index keep it there. It ships as `resources/data/jkhssn.sqlite` (electron-builder
`extraResources`) so JKHSSN works on first launch **even for users who do not own
جوامع الكلم**. A runtime
rebuild (`buildJkhssnIndex`) handles staleness / a newer source and gives CI a
deterministic regeneration path. `scripts/build-jkhssn-index.mts` and the runtime
call the **same** `buildJkhssnIndex`, so they cannot diverge.

### What is deferred

- Cracking the `CustomType="1"/"3"` compression (would give local matn +
  canonical narrator names). If it is ever cracked, it is an additive change.
- `matn_comparison` (axis 4) is capped — 8M pairs; indexed only when the union is
  under 12M rows.
- A `trace_isnad` narrator-graph schema (still deferred from ADR-0041).

## Consequences

- **+** All six axes work offline and in ~10 ms, keyed to جوامع الكلم's own ids.
- **+** No new Supabase migration — reuses `islamicurdubooks-rijal` /
  `classical-rijal` / `islamicurdubooks-hadith` / `urdu-hadith` / `dorar` as-is.
- **−** A narrator with no `islamicurdubooks-rijal` match shows the raw name
  shape or "نام دستیاب نہیں"; matn depends on a corpus match by collection +
  printed number.
- **−** The seed adds ~55 MB to the installer.
- The framing model + this decision are recorded so a future session does not
  re-derive them: `electron/jkhssn/columnStore.ts` header, and the memory note
  `easyeditor-jkhssn-columnstore-format`.
