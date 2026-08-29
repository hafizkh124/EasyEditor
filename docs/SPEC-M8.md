# SPEC-M8 — Agentic Desktop Platform: Driving the Researcher's Own Tools

> **Status:** Draft · **Date:** 2026-08-29 · **Base:** [SPEC-M5.md](./SPEC-M5.md), [SPEC-M5.9.md](./SPEC-M5.9.md), [SPEC-M6.md](./SPEC-M6.md)
>
> Supersedes the "M7" label used for this line of work in earlier drafts and
> chat history — see §0.

---

## 0. Naming note (read this first)

Earlier drafting of this work (chat history, an early `p0-spike/` commit
message) called it **"M7."** `STRATEGY-v1.md` §5 already assigns **M7** to
the desktop/privacy line (local tashkeel, local LLM, local embeddings, local
OCR — M7.1–M7.5), decided and cross-referenced at §7 (risk #5) and §8
(decisions #6, #7). That assignment predates this work and is load-bearing
in an approved strategy document; this line of work was the newcomer, so
**it is renumbered M8** here. Nothing under the old "M7" name has been
committed to `main` — only a `p0-spike/` commit on this feature branch,
which this spec's phases now supersede. Do not create a `SPEC-M7.md`; that
name is reserved for the desktop/privacy line if and when it gets its own
spec document.

---

## 1. Context

A third-party proposal suggested a new standalone app (Tauri + LangGraph +
Qdrant) for Urdu/Arabic academic research and thesis writing. Roughly 70% of
that proposal already exists in EasyEditor v2.0.5: the Electron shell, TipTap
editor with RTL/Nastaliq support, `sqlite-vec` + pgvector search, the native
Maktaba Shamela bridge, BYOK, and Trust UI. **No new app is being built.**

The actual request, arrived at over several rounds of discussion, is broader
than a thesis-writing mode:

> Researchers use many tools beyond a text editor — Word, InPage, PDF
> readers, PowerPoint, Excel, Maktaba Shamela. The agent should be able to
> **drive those tools directly**, the way a skilled human does at their own
> computer. The user states a goal in natural language; **the agent decides
> how to accomplish it** — Word to InPage, InPage to Word, PDF to Word, and
> so on.

This reframes the work from "Word integration" to a **platform**: an
adapter for each tool, plus a way to route between formats, rather than a
hand-written converter for every pair (which is O(n²) work for n tools).

A second, load-bearing decision, reached after reviewing what document a
user's own file actually is: **EasyEditor is not building a Word
replacement.** The researcher's real document is a `.docx` (or `.rtf`, for
InPage) file living in their own project folder. The agent edits that file
*in place* — surgically, preserving whatever it doesn't understand (tracked
changes, comments, embedded objects) — rather than regenerating it from some
internal representation on every run. See ADR-0017 for why this rules out a
Markdown-source-of-truth design that was considered and rejected mid-design.

---

## 2. What's possible, and how

| Tool | Route | Status |
|---|---|---|
| **Word** | COM (`Word.Application`) — full object model: Styles, PageSetup, Footnotes, TOC, Find, Revisions, Options | Fully possible |
| **Excel / PowerPoint** | COM — same route | Fully possible |
| **Reading PDF** | `pdfjs-dist` | Already in the repo (`src/lib/ocr/pdfRenderer.ts`) |
| **PDF → Word** | Word's own PDF Reflow (`Documents.Open` directly on a `.pdf`) | Possible |
| **Scanned PDF** | Existing OCR pipeline | Already in the repo (`src/lib/ocr/`) |
| **Maktaba Shamela** | `master.db` + Shamela's own Lucene/JRE | Already in the repo (`electron/shamela/`) |
| **LibreOffice** | `soffice --headless --convert-to` | Possible — the universal fallback when Office isn't installed |
| **InPage** | ⚠️ **No public API found** | See below |

**InPage is the weakest link.** No COM interface, command line, or
scripting surface was found despite looking; `.inp` is also a closed,
proprietary binary format with no public specification. But InPage itself
**imports and exports RTF**, and that is the bridge the whole Urdu
publishing community already relies on for interop with other tools. Both
directions of this spec go through RTF, plus a legacy (pre-Unicode) ↔
Unicode converter so older InPage archives can be brought in. UI automation
(driving InPage's own menus via keystrokes) is possible in principle but
fragile — **explicitly out of scope for the first pass**; revisit only if
RTF proves insufficient (see the P0 spike, §5).

---

## 3. Architecture — platform first, adapters after

### Layer 1 — Process & session (`electron/host/`)

The shared foundation every COM and CLI adapter builds on.

| File | Job |
|---|---|
| `powershell.ts` | One long-lived PowerShell process; commands/replies as newline-delimited JSON over stdin/stdout — the app never relaunches PowerShell per call |
| `process.ts` | Timeouts, hang detection, **cleanup of orphaned `WINWORD.EXE`/`soffice.exe` processes** |
| `detect.ts` | What's installed on this machine, which version — this is what determines the agent's declared capabilities |

**Core safety rule:** model-generated text is **never** concatenated into a
shell command. Every parameter travels as JSON over stdin, as **data** —
never as a script fragment. This is where command injection would enter if
it were going to; it stays closed from the start. See §5's P0 spike and
`p0-spike/word-bridge.ps1` / `p0-spike/host.mjs` for the pattern this layer
formalizes.

### Layer 2 — Adapter registry (`shared/adapters/`)

Each tool is one adapter that declares: which formats it can read/write,
which operations it supports, and whether it's present on this machine.
Adding a new tool means adding one adapter; nothing else in the system
changes.

`electron/adapters/`: `word.ts`, `excel.ts`, `powerpoint.ts`,
`libreoffice.ts`, `pdf.ts`, `inpage.ts`, `shamela.ts` — the last two build on
existing code rather than starting fresh.

### Layer 3 — Conversion map (`shared/convert/`)

Format = node, converter = edge, each edge carries a **quality weight**. The
planner finds the best path:

```
InPage ──RTF──→ docx ──Word──→ PDF
  ↑              ↑
  └────RTF───────┘

PDF (text)    ──Word's PDF Reflow──→ docx
PDF (scanned) ──existing OCR──→ text ──→ docx
Shamela book  ──existing bridge──→ text/docx
```

**Honesty is mandatory.** Not every conversion is lossless. The map knows
each edge's loss profile, and the agent **states up front** what will be
lost (e.g., page layout on PDF→Word, character styles on Word→InPage). Where
two paths exist, prefer the higher-quality one (Word beats LibreOffice for
Office formats).

### Layer 4 — Playbooks (`shared/playbooks/`)

"How a skilled human does this task," as data. Example — "prepare a thesis
in university format": apply template → styles → page setup → TOC →
footnotes → PDF. The agent doesn't invent a procedure, it **selects** one.
Adding a new playbook is one registry entry, not code.

### Layer 5 — Project folder

```
my-thesis/              ← an ordinary folder, can live inside a synced drive
├── 01-introduction.docx
├── sources/ · templates/ · export/
└── .easyeditor/         ← backups (excluded from sync)
```

Google Drive, OneDrive, and Dropbox desktop clients present a synced folder
as an **ordinary local folder** — so syncing costs **zero code**: the
researcher just keeps their project folder inside `~/Google Drive/` (etc.).
`electron/ipc/fsHandlers.ts` follows the working pattern already in
`electron/ipc/voiceHandlers.ts:189` (`dialog.showSaveDialog` +
`fs.writeFileSync`). `src/core/backend/fileBackend.ts` is a third
implementation of the existing `WorkspaceBackend` interface —
**`cloudBackend` is untouched**, so the web app is unaffected. See
ADR-0018 for why the vector index specifically must never live inside a
synced folder, and why real-time (Google-Docs-style) co-editing is out of
scope for this model.

### Layer 6 — Agent (in the main process)

The filesystem, adapters, `sqlite-vec`, Shamela, and the BYOK key are all
already in the main process, so the loop runs there too — no IPC round trip
per tool call, and the key stays in the trusted process. **Only one agent
task runs at a time** — an explicit choice to avoid COM automation
re-entrancy; a second task queues, visibly, in the UI. The user can keep
reading/scrolling the document meanwhile, just not start a second agent task
concurrently. (True background/parallel agent tasks are explicitly out of
scope — see §7.)

`electron/agent/` (loop, dispatch, streaming) + `shared/agent/`
(`toolSchemas.ts`, `loop.ts`, `grounding.ts`, `systemPrompt.ts`).

**Tools:** `list_capabilities` (what's possible on this machine), `convert`
(via the conversion map), `run_playbook`, adapter-specific commands
(`word.insert_footnote`, `word.add_style`, `excel.write_range`, …),
`install_font`, `install_template`, and the existing research tools
(`search_corpus`, `search_shamela`, `search_general`, `run_task`).
`search_general` routes through the existing "General" research mode's edge
function — **not** open web browsing — so every result stays tagged with
`TaskRunSource.channels`/`domain`, preserving Trust UI's provenance
guarantee (see §7 and ADR-0019 for why an open browser tool was rejected).

**Core rule:** the agent never improvises a free-form prompt against the
underlying model for content generation — it selects and sequences from the
registry's bounded commands and playbooks.

#### Security gates (one place, applies to every adapter)

1. **No string ever built into a command** — every parameter is JSON data.
2. **Writes stay inside the project folder** — resolve the path and confirm
   it's actually inside (block `..`, symlinks, absolute escapes); allowlist
   of file extensions.
3. **Backup before every edit** (`.easyeditor/history/`), then **verify**
   the file still opens afterward, or roll back.
4. **Fonts only from a file the user explicitly chose** — never an automatic
   download from the internet.
5. **Global settings** (`Application.Options`, `Normal.dotm`) affect *every*
   document the user has — explicit consent, a record of the change, and a
   way back.
6. Permissions are explicit, visible in the UI, and revocable.

**Review gate:** every text change first lands as Word's own tracked change
(`Document.TrackRevisions = true`). `insert_footnote` only succeeds when the
citation resolves to a real retrieved chunk (book + volume + page);
otherwise it **errors rather than inventing a citation**. Two tiers of
verification: (1) an **integrity gate** — does the citation resolve to a
real chunk at all (deterministic, cheap); (2) an optional **claim check** —
does the excerpt actually support the paragraph's claim (one lightweight LLM
check, inside `insert_footnote` itself) — not a separate "verifier agent",
because every extra agent is another model call and multiplies cost. The
full transcript lands in `task_runs` → the Trust tab. Budget uses the
existing `calculateTaskCost` + `SolvencyDialog`.

**Task-level recovery:** each agent *task* (not each write) gets its own
checkpoint — all of that task's writes as one group in
`.easyeditor/history/`. One button, **"Undo this task,"** reverts the whole
group at once. This is distinct from gate #3's per-write backup (which
exists for corruption recovery) — this one exists for the researcher's
peace of mind.

#### UI shape

No new standalone shell — the existing `/workspace` (ADR-0010), with the
middle column (`CanvasPanel`) gaining two states: **"Document"** or
**"Agent,"** toggled. The library column (right, in RTL) is shared by both
states. In Agent state:

- **Right — Library:** the same project/document tree; several chapters can
  stay open as tabs — Word's own `Documents` collection can hold multiple
  open files inside one `Application` instance, which matches Layer 1's
  long-lived process.
- **Middle — conversation:** two modes — **"Ask"** (read-only; no file
  changes) and **"Do"** (agentic; tracked-change proposals). Every step is
  preceded by **live, step-by-step progress** ("reading the file… searching
  Shamela… inserting the footnote…") — not decoration, a trust requirement.
  Typing `/` in the chat box opens a quick picker (following the existing
  `CommandPalette.tsx` pattern) to select a playbook or specific tool
  directly, without writing a long prompt.
- **Left — capabilities:** scope chips (`search_corpus`/`search_shamela`/
  `run_playbook`) and an **"Open in Word/InPage"** button.
- **Bottom:** an **"This machine's capabilities"** strip — what's installed,
  what's possible, what isn't.

New **Agent** tab in `WorkbenchPanel.tsx`, gated by **both** `isDesktop()`
and `VITE_AGENT_MODE` (the same pattern as `WorkspaceTopBar.tsx:245`). Voice
input (a microphone in the chat box) uses the existing `electron/voice/`
(Whisper) — no new engine, just another input path.

### Layer 7 — Context & rules (`@` mentions + project rules)

Two more additions, patterned after Cursor/Claude Code, but a thin UI layer
over existing tools rather than a new deep layer:

**`@` Mentions (`shared/mentions/`):** typing `@` in the chat box surfaces
the project's chapters, Shamela books, and outline. Picking one gives the
agent an **explicit reference** (file path / book id) — it doesn't have to
guess which file "@Ihya_Ulum-al-Din" means. Not a new tool — a UI path that
supplies explicit parameters to the existing `search_corpus`/
`search_shamela`/`word.*` commands.

**Project rules (`قواعد.md`):** a plain, human-readable file at the project
folder's root — the researcher or supervisor writes it themselves: font,
footnote style (traditional/APA/Chicago), maximum quotation length, etc.
Included in every agent call's system prompt
(`shared/agent/systemPrompt.ts`). **Distinct from a playbook:** a playbook
is "how to do this task" (a sequence); rules are "what always holds"
(a standing constraint). Missing file → silently ignored, not required.

**Consistency nudges (P5, lightweight):** when a term or citation changes in
chapter 1, the agent searches other chapters for the same term via
`search_corpus` (scoped to the project folder) and **suggests** a review
there too — never edits automatically. Not a "dependency graph" (prose has
no function/import relationship) — just a lexical search result, presented
plainly.

---

## 4. Conversion map — loss profile

| Route | What's lost |
|---|---|
| InPage → RTF → docx | Character styles beyond bold/italic/underline may not map 1:1; footnotes are not guaranteed to survive (see the P0 checklist) |
| docx → RTF → InPage | Track changes and comments do not survive (RTF has no equivalent); complex tables may simplify |
| PDF (text) → docx (Word Reflow) | Page layout/pagination is not preserved; multi-column layouts often flatten |
| PDF (scanned) → OCR → docx | Original layout is lost entirely; OCR error rate depends on scan quality |
| docx → PDF (via Word/LibreOffice) | One-way by nature — no loss relative to the docx, but the PDF itself cannot be edited back |

Every lossy step must be **stated to the user before the conversion runs**,
not discovered afterward.

---

## 5. Phases

| Phase | What ships | Why |
|---|---|---|
| **P0 — spike** (~1 week) | Six proofs on a real Windows machine: (1) Word COM from a packaged Electron app; (2) Word's PDF Reflow; (3) LibreOffice detect + convert; (4) InPage ↔ RTF round-trip, in real InPage; (5) a per-user-installed font actually visible in Word; (6) orphaned-process cleanup. Scripts: `p0-spike/` (already committed on this branch). | **The gate.** Any failure changes the architecture now, not after P1 is written. |
| **P1** | Layer 1 + 2: `electron/host/` + adapter registry + the **Word adapter** (deepest one) + the six security gates | The base everything else stands on, and the template every later adapter follows |
| **P2** | Layer 3: conversion map + planner + loss disclosure; adapters: LibreOffice, PDF, InPage (RTF) | "Convert this to that" — works from a menu even before the agent exists |
| **P3** | Layer 5: project folder + `fileBackend` + moving the index to `userData` | Privacy, drive sync, multi-device |
| **P4** | Layer 4 + 6 + 7: playbooks + agent loop + `@` mentions + `قواعد.md` + task checkpoints + claim verification + the UI shape above + the capabilities page | **"Just ask, the agent knows how"** — the actual goal |
| **P5** | Excel/PowerPoint adapters, font/template/settings commands, more playbooks, consistency nudges, macOS AppleScript route | Full coverage |

**Dependency:** P1 is the foundation everything else needs. Security gates
land **inside P1**, not alongside P4. Overlap with M6 (Library Mode) is low:
P1–P3 are new layers that can proceed in parallel; P4 touches
`WorkbenchPanel`, so it's better sequenced after M6.

---

## 6. Explicit decisions and their ADRs

| # | Decision | ADR |
|---|---|---|
| 1 | The agent chooses *how* to accomplish a stated goal, superseding "the model never chooses the steps" — compensated by tracked-change review + the grounding gate | [0016](./adr/0016-m8-agentic-loop-supersedes-fixed-tasks.md) |
| 2 | One adapter per tool + a conversion graph, not N² converters; drive the researcher's real tools rather than reimplement them | [0017](./adr/0017-m8-adapter-platform.md) |
| 3 | `.docx`/`.rtf` in an ordinary project folder is the source of truth, not an internal document model; the vector index never lives in that folder | [0018](./adr/0018-m8-folder-projects-and-sync.md) |
| 4 | `@` mentions, `قواعد.md`, task-level checkpoints, claim verification — and why a literal multi-agent Planner/Executor/Verifier triad, raw full-book context stuffing, and an open "Browser" tool were all rejected | [0019](./adr/0019-m8-context-rules-and-checkpoints.md) |
| 5 | P0 spike results and the constraints they impose on P1 | *0015 — reserved, pending real results from a Windows/Word/InPage run (see `p0-spike/README.md`)* |

---

## 7. Open decisions and explicit non-goals

- **Windows-first.** COM is a Windows technology. macOS gets a separate,
  less complete route via Office AppleScript (P5). Linux gets LibreOffice +
  pure file converters only. The app must say this plainly, not behave
  differently in silence.
- **No InPage API** — RTF only. If proof (4) in the P0 spike shows RTF is
  too lossy, UI automation or dropping InPage support are both separate,
  bigger decisions — not something to improvise mid-implementation.
- **Not every conversion is lossless** — the agent states what will be lost
  before converting (§4).
- **Desktop-only BYOK stays Gemini-only.** No model picker in this spec;
  multi-provider support is a separate, larger decision (per-provider key
  storage, tool-calling support differs per provider).
- **One agent task at a time.** True background/parallel agent tasks are out
  of scope, to avoid COM re-entrancy.
- **No open "Browser" tool.** Web access is limited to the existing
  "General" research channel (`search_general`), to keep Trust UI's
  source-tagging guarantee intact.
- **No literal multi-agent architecture.** Citation integrity is handled by
  the single loop plus the two-tier check inside `insert_footnote` (§3,
  Layer 6) — not a separate Planner/Executor/Verifier pipeline, which would
  multiply model-call cost for marginal benefit.
- **No raw full-book context stuffing.** The existing RAG/vector search
  (`search_corpus`) gives page/volume-precise retrieval and scales further
  than pasting 5–10 whole books into context.
- **"Dependency graph" is not literal.** Prose has no function/import
  relationship; the consistency nudge (§3, Layer 7) is a lexical search, not
  a graph data structure.
- **The web app is not touched.** `supabase/`, `cloudBackend`, and the edge
  functions stay exactly as they are; every new UI element is gated by
  `isDesktop()`.
- **Cost.** The agent loop spends far more tokens than a single-shot task;
  the budget dialog ships with P4, not after.

---

## 8. Exit criteria

**Per phase:**
- **P0:** all six proofs pass on a real Windows machine with Word and InPage
  installed, with terminal output/checklists attached to the P0 ADR (0015).
  Any failure is resolved (architecture revised) before P1 starts.
- **P1:** `word.ts` adapter passes `docs/QA-M8.md` items 1–7 (open, track
  changes, page setup, footnote, orphan cleanup, global-setting consent,
  Word-closed-mid-task recovery) on a real machine; `npm run typecheck`,
  `npm run check:shared`, and the new unit tests (see below) pass; the web
  build (`npm run build`) is unaffected.
- **P2:** a conversion between every pair in §4's table succeeds (or is
  correctly refused with a clear reason) from the menu, without the agent.
- **P3:** a project folder placed inside a synced drive round-trips across
  two machines; the vector index never appears inside that folder.
- **P4:** a natural-language instruction spanning `read → propose_edit →
  insert_footnote → export` completes end-to-end with a Trust-tab
  transcript, and an ungrounded claim is refused rather than footnoted.
- **P5:** at least one Excel or PowerPoint command and one new playbook ship
  without touching Layer 1/2's shared code.

**Milestone-level:** `docs/QA-M8.md` fully checked off on a real Windows
machine with Word and InPage; `docs/adr/0015`–`0019` all in `Accepted`
status; `npm run build` (web) and `npm run pack:electron` both succeed with
no change to web-app behavior.

---

## 9. Verification

```sh
npm run typecheck        # app + electron
npm run check:shared     # shared/adapters|convert|playbooks|agent|mentions purity
npm run test             # new unit tests
npm run lint              # eslint + check-ui-discipline
npm run build              # web build — proof the web app is unaffected
npm run smoke:functions   # edge functions still alive
npm run pack:electron     # desktop build
npm run test:e2e          # packaged app smoke
```

New unit tests (`src/test/`, alongside the existing 129), against mocked
sessions — no real Word/InPage required:

- `commandBuilder.test.ts` — **most important**: every parameter travels as
  data; quotes, newlines, `;`, `$(…)`, and Urdu text never get concatenated
  into a command string (direct command-injection guard).
- `conversionGraph.test.ts` — path-finding: InPage→docx in two hops; the
  higher-quality path wins when two exist; an impossible pair is refused
  clearly, never silently.
- `capabilityDetect.test.ts` — correct fallback and a clear message when
  Word/LibreOffice aren't found.
- `processLifecycle.test.ts` — timeout, hang detection, orphan cleanup.
- `fontInstall.test.ts` — correct path and registry entry; a non-font file
  is rejected.
- `fsSink.test.ts` — path traversal (`../`, absolute paths, symlinks) and
  disallowed extensions are rejected.
- `agentLoop.test.ts` — mocked model: tool call → result → next turn → stop;
  step-limit; cancel.
- `agentGrounding.test.ts` — an unsourced claim is refused;
  `insert_footnote` errors on a citation that doesn't resolve.
- `desktopGating.test.ts` — the Agent tab and adapter UI never appear in a
  web build.
- `mentionResolver.test.ts` — `@chapter`/`@book` resolve to the right file/
  book id; an unknown name gives a clear message, not a silent failure.
- `rulesInjection.test.ts` — `قواعد.md`'s content lands in every agent
  call's system prompt; a missing file is silently ignored.
- `taskCheckpoint.test.ts` — one task's several writes form one group;
  "Undo" reverts the whole group, not part of it.
- `claimVerification.test.ts` — a citation that exists but doesn't support
  the claim is flagged/rejected.
- `taskQueue.test.ts` — starting a second task while one runs queues it;
  never two simultaneous COM calls.
- `searchGeneralChannel.test.ts` — `search_general` results never lack
  `channels`/`domain`.

Manual QA (`docs/QA-M8.md`), on a real Windows machine with Word and InPage
installed:

1. InPage file → Word, and Word → InPage; open both results in the real
   apps to confirm.
2. A text PDF → Word (Reflow), and a scanned PDF → OCR → Word.
3. Install Jameel Noori Nastaleeq (or similar) and confirm it appears in
   **Word's own font list**.
4. Style sheet, page setup, TOC, footnotes — all driven by Word's own
   engine.
5. A supervisor's tracked changes and comments survive the agent's edits.
6. Attempting a global setting change surfaces the consent gate, and can be
   reverted.
7. Closing Word mid-task — the app recovers, no orphaned process remains.
8. A machine without Office — the LibreOffice route works, with a clear
   message.
9. A project folder inside `~/Google Drive/`, opened on a second machine.
10. Open the web app and confirm nothing changed.
11. Type `@chapter_two` and ask the agent something — the right file opens,
    no guessing.
12. Write a font/footnote rule in `قواعد.md` and have the agent do a task —
    the rule is honored.
13. After a multi-step task, press "Undo this task" — all writes revert, not
    one.
14. Insert a citation that exists in a book but doesn't support the
    paragraph's claim — the agent flags or refuses it.
15. Start agent tasks on two chapters at once — the second queues, no
    collision.
16. `search_general`'s results each show a clear source/channel.
