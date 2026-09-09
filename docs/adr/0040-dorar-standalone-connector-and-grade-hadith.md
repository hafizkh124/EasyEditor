# ADR 0040 — الدرر السنية as a standalone connector, and `grade_hadith`

**Status:** Accepted · **Date:** 2026-09-09 · **Milestone:** Connectors Hub (Phase 4) · **Extends:** [ADR-0028](./0028-m9-federated-knowledge-tiers.md), [ADR-0037](./0037-connectors-hub-and-curated-registry.md)

## Context

الدرر السنية (dorar.net) is the reference for "is this hadith ṣaḥīḥ / ḍaʿīf and
where is it graded". Today it is reachable only *indirectly*: `islamic-search`'s
Tier A calls `fetchDorar` in `islamic-api-fetch`, and the agent only ever
touches it through `search_hadith` → the renderer research bridge, which mixes
Dorar in with several other domains and returns a synthesised answer, not
Dorar's own per-narration verdict. There is no way for the agent to ask "grade
this hadith" and get الراوي / المحدث / المصدر / الحكم back verbatim.

## Decision

### API, not MCP — Dorar's own public endpoint, in-process

`dorar.net/dorar_api.json?skey=…` is **Dorar's own official public API** — the
endpoint their published docs sample uses, consumed by many hadith apps. It
returns `{ ahadith: { result: "<html>" } }` (rendered HTML in a JSON envelope).

We connect to it **directly from the main process** — no MCP intermediary — the
same pattern as `adapters/repositories.ts` (ADR-0028): a fixed endpoint, the URL
built here from the hadith text and nothing else, no auth, no key.

An MCP path was rejected. There is **no official Dorar MCP server**; a community
wrapper would add a third-party service we do not control between us and Dorar —
*less* durable, not more — plus a whole new `electron/dorar/` client subsystem
(mcpClient + allowlist + IPC channel + handler) to maintain, for what is one
search call. The one real fragility — parsing the HTML Dorar returns inside its
JSON — is inherent to Dorar's API format and would hit any MCP wrapper of it
equally; the direct path just has no *extra* failure mode. The parse (the
`hadith` / `hadith-info` block regex, the Cloudflare-clearing browser headers)
is ported verbatim from `fetchDorar`, which the team already fixed once with a
3-line header change (never a paid bypass — the "prefer the free fix" pattern).

### `grade_hadith` — a distinct, citable tool

`electron/agent/adapters/dorar.ts` → `gradeHadith({ text, limit })` →
`{ chunks, note?, error? }`, never throws. Each chunk:
`id: dorar:<sha1(matn)[:12]>`, `reference: <source> — الراوي: … — المحدث: … —
الحكم: <grade> (الدرر السنية)`, `content: <matn>`, and a new `RetrievedChunk.grade`
field carrying the verdict for a **distinct chip**, not folded into the
reference. `dispatch.ts`'s `grade_hadith` case adds the chunks to the ledger and
emits a `citation-list` artifact whose entries carry `grade`; `AgentArtifactPanel`
renders it through the existing `classifyHadithGrade` / `GRADE_FAMILY_STYLE` +
`citations.grade_disclaimer` ("graded by the source, not by us") — the same
infrastructure `CitationBadge` uses for the Research side (STRATEGY-v1 P2).

`grade_hadith` joins `CITABLE_SEARCH_TOOLS`, so citation closure still exposes
`insert_footnote` alongside it.

### The connector, and gating

`dorar` connector: `category: 'hadith-rijal'`, `healthKind: 'http'` (a cheap
GET to `dorar_api.json?skey=الصدقة` with the browser headers), **ships enabled**
(no download, no key). `toolScoping` gains a **tight grading rule ABOVE the
general hadith rule** with `connector: 'dorar'` (keywords: درجہ حدیث / صحت حدیث /
حکم الحدیث / "is this hadith authentic" / صحیح ہے / ضعیف ہے …). Both rules fire
on a grading ask, so `classifyIntent` (ADR-0038) now collapses connectors that
share a category to the most-specific (first) one — a grading question gates to
`dorar`, not "dorar + hadith = ambiguous".

### `search_hadith` and `grade_hadith` overlap — deliberately

`search_hadith` still reaches Dorar via the edge function (topical, multi-domain,
uses the signed-in session). `grade_hadith` is grading-specific, in-process,
Dorar only. This is intentional, not a dedup miss: the classifier and the domain
rules route a *grading* ask to `grade_hadith` and a *topical* hadith search to
`search_hadith`.

## Consequences

**Positive**
- "Grade this hadith" now returns Dorar's own الراوي / المحدث / المصدر / الحكم,
  citable, with a quiet grade chip — no synthesis, no our-verdict risk.
- Zero new infrastructure: one adapter file, one endpoint, in-process.
- The grade-chip and disclaimer infra is shared with the Research side, so the
  "graded by the source, not us" framing is identical everywhere.

**Negative**
- The parse depends on dorar.net's HTML structure inside `ahadith.result`. If
  they change it the regex yields nothing (a clean "no narrations" note, not a
  crash) — a small, well-understood fix, as history shows.
- Two code paths reach Dorar. Documented here so it is not "refactored away".
- `healthKind: 'http'` shows green on a 200 even if Cloudflare served a
  challenge page; acceptable for a liveness dot (the real call re-checks the
  JSON shape).

## Follow-ups

- Web parity: a `grade_hadith` edge-function counterpart (or route it through
  the existing `islamic-api-fetch` Dorar path) when web parity is picked up.
- Ilm (Phase 5) gives narrator biographies their own `lookup_narrator` — the
  grading rule already forbids using `grade_hadith` for a narrator-only question.
