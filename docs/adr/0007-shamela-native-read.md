# ADR 0007 — Reading a local Shamela 4 library

**Status:** Accepted · **Date:** 2026-07-29 · **Milestone:** M5.0 spike → M5.4

## Context

M5 promises that a user who has Maktaba Shamela installed can connect it to
EasyEditor with **one button and no extra software** (SPEC-M5 FR-5.8). The
plan assumed Shamela 4 stores its books in SQLite, so `better-sqlite3` — a
dependency M5.3 already needs — would be enough to read them.

This ADR records what the spike actually found, because the assumption was
only half right and the difference decides M5.4's design.

## What is actually on disk

Layout, from a real Shamela 4 installation:

```
<library-root>/                     e.g. D:\shamela4   (NOT the program folder)
├── shamela.exe
├── app/
│   ├── lucene/2/                   Lucene 10.4.0 jars + AlKhalil Arabic analyzer
│   └── win/{32,64}/jre/2/bin/      bundled OpenJDK 21 (java.exe)
└── database/
    ├── master.db                   catalogue — SQLite
    ├── cover.db                    book covers — SQLite
    ├── book/NNN/<book_id>.db       per-book page structure — SQLite (8,598 files)
    ├── service/{S1,S2,hadeeth,tafseer,trajim}.db   indexes — SQLite
    ├── store/page/                 ← THE BOOK TEXT — Lucene index (284 MB .cfs)
    └── user/data.db                user's own notes/bookmarks — SQLite
```

Two findings matter.

**1. The program folder and the library folder are different.**
The installer put the program in `C:\Program Files\shamela`, but the library —
`app/`, `database/`, and `shamela.exe` — lives in `D:\shamela4`. Discovery
must look for a directory containing `database/master.db`, not for the
uninstall entry's `InstallLocation`.

**2. The page text is not in SQLite.** It is in a Lucene 10.4 index.

The SQLite files are readable and useful:

| File | Contents | Verified |
|---|---|---|
| `master.db` | `book` (8,593 rows), `author` (3,188), `category` (41), `author_book`, `coauthor_book` | ✔ opened read-only |
| `book/NNN/<id>.db` | one `page` table: `id, part (volume), page (printed no.), number, services` | ✔ opened read-only |
| `service/S2.db` | `roots(token, root)` — 3.2M Arabic root pairs | ✔ |

But `page` has **no text column**, and the per-book files are 30–370 KB for
hundreds of pages. The prose lives in `database/store/page/`, a Lucene
compound file. Nothing in the SQLite layer can produce a sentence of a book.

Book files are sharded by `book_id mod 1000`, zero-padded to three digits:
book `1001` → `book/001/1001.db`, book `13000` → `book/000/13000.db`.

SQLite is in WAL mode (`.db-wal` / `.db-shm` present), so opens must be
read-only but **not** `immutable=1`.

## Decision

**Read the catalogue and page structure directly with `better-sqlite3`, and
read page text through a small Java helper that runs on the JRE Shamela
already ships.**

Concretely:

- `electron/shamela/discover.ts` — find a directory containing
  `database/master.db`; remember it in `corpus_meta`; always offer manual
  selection.
- `electron/shamela/readBook.ts` — SQLite for catalogue, authors, categories,
  volume/page mapping. Read-only, WAL-aware.
- `electron/shamela/textHelper.ts` — spawn `app/win/64/jre/2/bin/java.exe`
  with a helper jar of ours on a classpath that includes Shamela's own
  `app/lucene/2/*.jar`, and read extracted page text back over stdout.

## Alternatives considered

**Reimplement the Lucene 10 stored-fields codec in TypeScript.** Reading
stored fields is more tractable than reimplementing search, but it is still a
compressed, versioned binary format, and Shamela can ship a new Lucene at any
update. A decoder that is subtly wrong returns mangled Arabic rather than an
error — the worst possible failure for a citation tool. Rejected.

**Bundle our own JRE.** Adds 40 MB+ to an installer whose whole selling point
is that it stays small, to duplicate a runtime the user already has. Rejected.

**Depend on `shamela-mcp`.** It is MIT and it solves exactly this problem the
same way (Node server + `shamela-helper.jar` + Shamela's JRE). But requiring
the user to install and configure a second product is precisely what FR-5.8
forbids, and it is what M5 exists to remove. Rejected as a *dependency* —
though its approach is the one adopted here, and it is worth crediting.

## Consequences

**Decision 11 ("zero external dependency") still holds, in letter and spirit.**
The user installs Shamela and EasyEditor, nothing else. The JRE and the Lucene
jars come from Shamela; the only new artifact is our own helper jar, which
ships inside our installer (tens of KB — `shamela-mcp`'s equivalent is 44 KB).

**But M5.4 grows a Java toolchain.** Building and signing a jar is a new step
in a repo that has never compiled Java. M5.4 moves from 4 days to **6**.

**The diagnostic gains a step.** FR-5.9's checklist becomes seven, not six:
a "Java runtime found?" check between "version recognised" and "schema as
expected", with its own message and its own fix (point at a JRE / repair the
Shamela install). Shamela ships 32- and 64-bit JREs; prefer 64.

**Route A (free keyword search over the whole library) also needs the helper.**
The plan assumed keyword search was free because it was "just SQLite". It is
not: search means querying the Lucene index. Still free of embedding cost and
still available across all 8,593 books — but it goes through Java, so the
helper is on the critical path for both routes, not only for import.

**A version check is mandatory.** The jars on disk are Lucene 10.4.0 and the
JRE is OpenJDK 21. The helper must verify the Lucene major version it finds
and refuse clearly if Shamela ships something it was not built against, rather
than returning empty results.

## Verification performed

- `master.db`, `book/001/1001.db`, `book/003/3003.db`, `service/S1.db`,
  `service/S2.db` all opened read-only and enumerated while Shamela was
  installed; schemas above are transcribed from `sqlite_master`.
- `D:\shamela4\app\win\64\jre\2\bin\java.exe -version` → OpenJDK 21.0.10 LTS.
- `D:\shamela4\app\lucene\2\` contains `lucene-core-10.4.0.jar` and the
  AlKhalil Arabic analyzer.
- No file was written or modified.
