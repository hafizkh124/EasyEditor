# ADR 0058 — Shamela citation cards: author, volume and printed page from Shamela's own SQLite

**Status:** Accepted · **Date:** 2026-09-29 · **Milestone:** M13 Scholar Desktop Agent · **Extends:** [ADR-0044](./0044-cloud-shamela-connector.md), [ADR-0033](./0033-m9-disclosure-and-source-view.md), [ADR-0049](./0049-m11-derived-agent-affordances.md)

## Context

Local `search_shamela` hits (the Lucene helper) carried `<bookId>-<pageId>`,
where pageId is Shamela's **internal** page id, and an **empty** title. The
footnote the agent inserted therefore read «الشاملة، ص 29» — no author, no
volume, and a page number that is not the printed page a reader can find.
Book import had the same defect: volume hard-coded to `NaN`, the internal id
stored as the page.

## Decision

- **Read the metadata where Shamela keeps it**, read-only, with the existing
  `better-sqlite3` (no helper-jar change): `master.db` (`book`, `author` —
  title, author, death year; 99999 = unknown) and
  `database/book/<id % 1000>/<id>.db` `page(id, part, page)` — `id` is the
  internal id the Lucene hit carries, `part` the volume, `page` the printed
  page. Schema confirmed against `D:\shamela4`
  (`electron/shamela/pageMeta.ts`). Book metadata is cached; every lookup is
  best-effort and never fails a search.
- **The reference is built deterministically** by
  `shared/citation/shamelaFootnote.ts`: «المؤلف (ت 256هـ)، الكتاب، ج 1، ص 6».
  A single-volume book omits ج; a page with no printed number falls back to
  «ص N (ترقيم الشاملة)» so it is never passed off as a printed page. It
  becomes the retrieval-ledger `reference`, so `insert_footnote` writes it
  verbatim — the model never composes a footnote.
- **Citation cards.** `search_shamela` emits a `citation-list` artifact (top
  8) whose entries carry `footnote`; the card's «حاشیہ لگائیں» button
  **pre-fills** the composer (a window `agent-prefill` event → `useAgentRun`),
  switching Ask → Plan. It never inserts by itself (ADR-0049). The prefill
  names the source id and asks for `read_shamela_page` first, because the
  retrieval ledger is per task and `insert_footnote` refuses an id the
  current task has not retrieved.
- **Import** maps each page through the same table: printed page + numeric
  volume are stored on the chunk.
- Cloud and Turath transports are unchanged (Turath already supplies a
  printed `pageLabel`).

## Consequences

- Live-verified: e.g. internal page 29 of عمدة القاري → «بدر الدين العيني
  (ت 855هـ)، عمدة القاري شرح صحيح البخاري، ج 1، ص 30», matching the book DB.
- Books imported before this change keep their old page numbers until
  re-imported.
