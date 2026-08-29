# SPEC-M8 — Agentic Desktop Platform: Driving the Researcher's Own Tools

> **Status:** Draft · **Date:** 2026-08-29 · **Base:** [SPEC-M5.md](./SPEC-M5.md), [SPEC-M5.9.md](./SPEC-M5.9.md), [SPEC-M6.md](./SPEC-M6.md), [ADR-0006](./adr/0006-workspace-backend-adapter.md), [ADR-0007](./adr/0007-shamela-native-read.md), [ADR-0015](./adr/0015-m8-word-inpage-p0-spike.md)

---

## 0. Naming note (read this first)

Earlier drafting of this work (chat history, the `p0-spike/` commit message,
and a briefly-existing `docs/SPEC-M7.md`) called it **"M7."**
`STRATEGY-v1.md` §5 already assigns **M7** to the desktop/privacy line (local
tashkeel, local LLM, local embeddings, local OCR — M7.1–M7.5), decided and
cross-referenced at §7 (risk #5) and §8 (decisions #6, #7). That assignment
predates this work and is load-bearing in an approved strategy document;
this line of work was the newcomer, so **it is renumbered M8** here. Do not
create a `SPEC-M7.md`; that name is reserved for the desktop/privacy line if
and when it gets its own spec document.

`docs/SPEC-M7.md` existed briefly (2026-08-29) as a narrower, evidence-
grounded draft of the Word/InPage bridge specifically — its concrete
op-protocol, IPC design, and packaging sections are merged into §3–§5 below,
and the file itself was removed rather than kept as a second spec
documenting the same work under two names.

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
InPage) file living in their own project folder. The agent edits that file's
**OOXML in place** — surgically, preserving whatever it doesn't understand
(tracked changes, comments, embedded objects) — rather than regenerating it
from some internal representation on every run. See ADR-0018 for why this
rules out a Markdown-source-of-truth design that was considered and rejected
mid-design. "In place" means the file on disk, driven through Word itself —
not a docx-rendering view inside EasyEditor's own canvas that replaces
Word's UI (see §2).

### 1.1 What exists already

- **Desktop shell (M5–M6):** Electron app, `contextIsolation: true`, IPC
  through an explicit channel allowlist (`electron/ipc/registry.ts`); the
  renderer reaches main only via `electron/preload.ts`.
- **The "own long-lived helper process" pattern (ADR-0007):**
  `electron/shamela/` drives Shamela's bundled JRE as a child process, JSON
  commands in / JSON lines out, never string-interpolating caller input into
  a command line. This spec's Word host (§3, Layer 1) is the same pattern
  pointed at PowerShell + COM.
- **`WorkspaceBackend` adapter (ADR-0006):** all renderer data access goes
  through `getBackend()`; desktop-only capability is exposed as new IPC
  actions, not new Supabase calls.
- **Editor:** TipTap rich editor in `CanvasPanel`; import already accepts
  PDF/DOCX/TXT as *sources* (SPEC-v2 FR-4.5.1) but has no structured export
  and no Word/InPage round-trip yet.

### 1.2 What the P0 spike established (2026-08-29, real Windows 11 + Word 16.0)

Full results, rationale, and the constraints they impose are in
**ADR-0015**. In short:

| Proof | Result |
|---|---|
| 1 — Word COM over a long-lived PowerShell/JSON host (open, track changes, RTL page setup, real footnote, save-as) | **PASS** — verified in the output `word/document.xml`/`footnotes.xml` and visually in Word |
| 2 — Word's own PDF reflow (`Documents.Open` on a `.pdf`) | **PASS, but slow** — ~23 s for a 312-word text PDF, no external converter needed |
| 3 — LibreOffice detect + headless convert | **UNVERIFIED** — not installed on the test machine |
| 4 — InPage ↔ RTF round-trip | **UNVERIFIED** — not installed; separately confirmed InPage exposes no COM/CLI/scripting surface, which is why this spec routes through RTF at all |
| 5 — Per-user font install visible to Word | **PASS, only with the real font APIs** (`AddFontResourceW` + `WM_FONTCHANGE` broadcast) — a file-copy-plus-registry-key approach left the font invisible even to a freshly started Word |
| 6 — Orphaned `WINWORD.EXE` after an unclean host exit | **FAIL by design** — Word does not exit when its automating process dies; `process.ts` must actively kill it |

The Word core — the load-bearing risk — is proven. §5's phases and §6's
constraints follow directly from these six results, not from assumption.

---

## 2. Non-Goals

- Cloud/server-side document conversion — this is desktop-only, all local.
- **Editing Word or InPage documents *in place* inside EasyEditor's own
  editor UI** — this spec moves documents *between* tools and edits their
  OOXML surgically through Word/InPage's own engines; it does not
  reimplement Word's rendering inside `CanvasPanel` or replace Word's UI.
- A general-purpose Office automation API for third parties.
- macOS/Linux Word automation — COM is Windows-only; LibreOffice is the
  cross-platform, Office-less fallback (§3, §5 P4); macOS gets a narrower
  Office-AppleScript route later (§5 P9).
- Lossless InPage conversion — the commitment is to being **explicit about
  what a conversion drops** (§4), not to dropping nothing.
- Bulk conversion of large books through Word's PDF reflow — ~23 s for a
  short document is not viable for a 300-page book; use the OCR/chunked
  import path for those instead.
- A desktop model picker / multi-provider BYOK — stays Gemini-only (§7).
- True background/parallel agent tasks, or an open "Browser" web-search
  tool — both explicitly rejected, with reasons, in ADR-0019.

---

## 3. Architecture — platform first, adapters after

### Layer 1 — Process & session (`electron/host/`) — **shipped in P1**

The shared foundation every COM and CLI adapter builds on.

| File | Job |
|---|---|
| `powershell.ts` | `WordHost`: one long-lived PowerShell process; commands/replies as newline-delimited JSON over stdin/stdout, matched strictly FIFO — the app never relaunches PowerShell per call. Per-op timeouts (`OP_TIMEOUT_MS`), structured `HostError` codes, and an `'exit'` event on host crash that rejects every in-flight request. |
| `process.ts` | Owns and **actively kills the `WINWORD.EXE` PID** on host crash (`killOwnedWordIfAlive`), app quit (`killOwnedWordSync`, from `before-quit`), and next launch (`sweepStaleOnStartup`, from a persisted record) — Proof 6 confirmed Word does not exit on its own. Every kill is gated on a **PID + start-time fingerprint** so a recycled PID (or the user's own Word) is never touched. |
| `detectTools.ts` | Whether PowerShell + Word COM work on this machine, and the Word version — determines whether the renderer offers Word conversion at all. |
| `index.ts` | The facade: owns the single `WordHost`, wires its `'exit'` to the orphan guard, exposes `pingHost` / `detectTools` / `initDocBridge` / `shutdownDocBridge(Sync)`. |
| `wordBridge.ps1` | Staged into `resources/bin/` by `scripts/check-doc-bridge.mjs` (wired into `build:electron` / `build:appx` / `pack:electron`, mirroring `check:shamela-helper`); `build.extraResources` already ships `resources/bin` → `bin`. Resolved from `process.resourcesPath/bin` when packaged, the repo path in dev, with a diagnostic "looked in …" error if missing. Adds a headless (`Visible = $false`) Word instance and a **before/after PID diff** so the host knows exactly which `WINWORD.EXE` it started (`ownedByUs`); COM attaching to a Word the user already had open is reported as *not* owned. |

**Core safety rule:** model-generated text is **never** concatenated into a
shell command. Every parameter travels as JSON over stdin, as **data** —
never as a script fragment. The host is a fixed `switch ($cmd.op)`; nothing
reaches `Invoke-Expression`, `cmd /c`, or a shell string — the same rule
`electron/ipc/registry.ts` already enforces for channel names, extended to
the PowerShell boundary. This is where command injection would enter if it
were going to; it stays closed from the start.

#### Op protocol (Layer 1 ↔ Layer 2)

The host speaks the protocol `p0-spike/word-bridge.ps1` already proved.
Every message is a JSON object with a fixed `op`; arguments are data, never
interpolated into a script string.

| op | args | reply | proven in spike |
|---|---|---|---|
| `ping` | — | `{ok, pong}` | ✓ |
| `open` | `path` | `{ok, name}` | ✓ |
| `openPdfReflow` | `path` | `{ok, ms, wordCount}` | ✓ (~23 s) |
| `setTrackRevisions` | `enabled` | `{ok, enabled}` | ✓ |
| `setRtlPageSetup` | — | `{ok}` | ✓ |
| `insertFootnote` | `text` | `{ok, footnoteCount}` | ✓ |
| `installFontCheck` | `fontName` | `{ok, found, fontCount}` | ✓ |
| `save` / `saveAs` | (`path`) | `{ok}` | ✓ |
| `wordPid` | — | `{ok, pid}` | ✓ |
| `close` / `quit` | — | `{ok}` | ✓ |

New ops for P1+ (designed in the phase that needs them): `exportRtf`,
`readStructure` (headings/footnotes/tracked-change inventory, for the
conversion loss report), `applyCitations` (insert a batch of footnotes at
marked positions, §5 P6), `installFont` (the real `AddFontResourceW` +
broadcast registration, §6 constraint 2).

#### IPC surface

One new allowlist entry, action-dispatched exactly like `SHAMELA_INVOKE`:

```
DOC_BRIDGE_INVOKE      'docbridge:invoke'      { action, ... }   renderer → main
DOC_BRIDGE_PROGRESS    'docbridge:progress'    { ... }           main → renderer (long conversions)
```

Actions: `detectTools`, `toWord`, `fromWord`, `toInPage`, `fromInPage`,
`convert` (routes via Layer 3), `installFont`, `cancel`. Typed wrappers are
added to `preload.ts` alongside the handler, matching the existing
`shamela.*` shape.

### Layer 2 — Adapter registry (`shared/adapters/` + `electron/adapters/`)

Each tool is one adapter that declares: which formats it can read/write,
which operations it supports, and whether it's present on this machine.
Adding a new tool means adding one adapter; nothing else in the system
changes.

`electron/adapters/`: `word.ts` (built on Layer 1 — `toWord`/`fromWord`/
`openPdfReflow`/`readStructure`, plus `installFont` wired to the real font
APIs), `excel.ts`, `powerpoint.ts`, `libreoffice.ts` (detect + headless
convert — the Office-less, cross-platform fallback), `pdf.ts`, `inpage.ts`
(docx ↔ RTF ↔ InPage, since InPage has no API of its own), `shamela.ts` —
the last builds on existing code rather than starting fresh.

### Layer 3 — Conversion map (`shared/convert/`)

Format = node, converter = edge, each edge carries a **quality weight**. The
planner finds the best path — `InPage → RTF → docx → Word → PDF` falls out
of the graph automatically, without anyone writing an "InPage to PDF"
converter by hand:

```
InPage ──RTF──→ docx ──Word──→ PDF
  ↑              ↑
  └────RTF───────┘

PDF (text)    ──Word's PDF Reflow──→ docx
PDF (scanned) ──existing OCR (STRATEGY-v1 M7.4)──→ text ──→ docx
Shamela book  ──existing bridge──→ text/docx
```

**Honesty is mandatory.** Not every conversion is lossless. The map knows
each edge's loss profile, and the renderer shows the loss list **before** a
conversion runs (§4), not after. Where two paths exist, prefer the
higher-quality one (Word beats LibreOffice for Office formats).

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
scope — see §7 and ADR-0019.)

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
registry's bounded commands and playbooks (see ADR-0016 for how this
squares with "the model never chooses the steps").

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
  directly, without writing a long prompt. A convert action (source →
  target format, loss list, progress bar) is reachable from the `CanvasPanel`
  toolbar in Document state too — converting doesn't require the agent.
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

**Consistency nudges (lightweight, §5 P9):** when a term or citation changes
in chapter 1, the agent searches other chapters for the same term via
`search_corpus` (scoped to the project folder) and **suggests** a review
there too — never edits automatically. Not a "dependency graph" (prose has
no function/import relationship) — just a lexical search result, presented
plainly.

---

## 4. Conversion map — loss profile

| From → To | Adapter | Known loss |
|---|---|---|
| EasyEditor doc → `.docx` | `word.ts` (or `libreoffice.ts`) | None expected for text + footnotes + RTL |
| `.docx` → EasyEditor doc | `word.ts` `readStructure` | Word fields, macros, embedded objects |
| `.pdf` (text layer) → `.docx` | `word.ts` `openPdfReflow` | Exact page layout; slow (~23 s+ per document, confirmed in the P0 spike) |
| `.pdf` (image only) → text | Existing OCR pipeline (STRATEGY-v1 M7.4) — not this strand | Original layout lost entirely; error rate depends on scan quality |
| `.docx` → `.rtf` → InPage | `inpage.ts` | Character styles beyond bold/italic/underline may not map; footnotes are not guaranteed to survive — **must verify (Proof 4)** |
| InPage → `.rtf` → `.docx` | `inpage.ts` | Depends on Unicode vs. legacy Noori (pre-Unicode) encoding; the legacy path needs a mapping step before the RTF is usable — **must verify (Proof 4)** |
| Any → any, no Office installed | `libreoffice.ts` | Fallback quality generally lower than the native Office route — **must verify (Proof 3)** |

Every lossy step must be **stated to the user before the conversion runs**,
not discovered afterward.

---

## 5. Phases

The document-bridge core (P0–P6) is the evidence-grounded, narrowly-scoped
slice — Word, InPage, PDF, LibreOffice. The platform-breadth phases (P7–P9)
build on that core once it's solid.

| Phase | What ships | Why / gate |
|---|---|---|
| **P0 — Spike** | Six proofs on a real Windows machine (`p0-spike/`) | ✅ **Done** for the Word core (proofs 1, 2, 5, 6); **unverified** for LibreOffice (3) and InPage (4) — see §1.2, ADR-0015 |
| **P1** | ✅ **Done** (2026-08-29). Layer 1: `electron/host/` — `powershell.ts` (`WordHost`), `process.ts` (fingerprinted orphan guard), `detectTools.ts`, `index.ts`, `wordBridge.ps1`. `DOC_BRIDGE_INVOKE`/`DOC_BRIDGE_PROGRESS` on the allowlist; `detectTools` + `ping` actions; `docBridge` preload wrapper; `main.ts` wires `initDocBridge()` (startup sweep) and `shutdownDocBridgeSync()` (`before-quit`). `scripts/check-doc-bridge.mjs` in the build. Three unit files (26 tests) + `src/test/hostLive.test.ts` (`DOC_BRIDGE_LIVE=1`, needs real Word) — **the live test passed against Word 16.0: full docx round-trip, and `host.kill()` orphan → `killOwnedWordIfAlive()` confirmed the WINWORD.EXE gone.** Also fixed the three P0 spike-script defects from ADR-0015. | Exit criterion met: live integration test drives the real host |
| **P2** | Layer 2: `electron/adapters/word.ts` — `toWord`/`fromWord`/`openPdfReflow`/`readStructure`; `installFont` wired to the real APIs (constraint 2, §6) with the `installFontCheck` verification loop | The deepest adapter, and the template every later one follows |
| **P3** | Renderer: a convert dialog in `CanvasPanel` — pick source/target, show the Layer 3 loss list, run with a progress bar (conversions are async, §6 constraint 3), open the result. `getBackend()` only; desktop-gated. | "Convert this to that" works from a menu, before the agent exists |
| **P4** | `electron/adapters/libreoffice.ts` | **Blocked on Proof 3** — run `p0-spike/test-libreoffice.mjs` for real first, and fix its `findSoffice()` false-positive (§6) |
| **P5** | `electron/adapters/inpage.ts` (docx ↔ RTF ↔ InPage) + the legacy-Noori encoding mapping | **Blocked on Proof 4** — complete `p0-spike/inpage-rtf-checklist.md` on a machine with InPage. If the round-trip mangles Nastaliq text badly, this phase stops and the InPage strategy is re-decided separately, not improvised |
| **P6** | `applyCitations` op — insert EasyEditor's citation output as real Word footnotes at marked positions, reusing the web citation-integrity gates | "Add citations" can target a `.docx` directly |
| **P7** | Layer 5: project folder + `fileBackend` + moving the vector index to `userData` | Privacy, drive sync, multi-device (ADR-0018) |
| **P8** | Layer 4 + 6 + 7: playbooks + agent loop + `@` mentions + `قواعد.md` + task checkpoints + claim verification + the UI shape (§3) + the capabilities page | **"Just ask, the agent knows how"** — the actual goal |
| **P9** | Excel/PowerPoint adapters, font/template/settings commands, more playbooks, consistency nudges, macOS AppleScript route | Full coverage |

**Dependency:** P1 is the foundation everything from P2 onward needs.
Security gates land **inside P1/P2**, not alongside P8. Overlap with M6
(Library Mode) is low: P1–P7 are new layers that can proceed in parallel;
P8 touches `WorkbenchPanel`, so it's better sequenced after M6.

---

## 6. Constraints locked in by the P0 spike (ADR-0015)

1. **`electron/host/process.ts` must own the `WINWORD.EXE` PID and kill it
   actively.** Proof 6 confirmed Word does not exit when its automating
   process dies. The host records the PID (the `wordPid` op already returns
   it) and, on its own crash/shutdown, force-kills it — the default path,
   not a fallback.
2. **Font installation must call `AddFontResourceW()` + broadcast
   `WM_FONTCHANGE`, not just copy the file and write the `HKCU` key.** File
   copy + registry alone left the font invisible — not just to the running
   process, but to a freshly-started Word too. Adding the real API call plus
   a `SendMessageTimeout(HWND_BROADCAST, WM_FONTCHANGE)` broadcast fixed it:
   **an already-running Word picked it up with no restart needed.** So the
   font-verification risk does **not** require forcing a Word restart — the
   adapter does the real registration and verifies via `installFontCheck`,
   falling back to "please restart Word" only if verification fails.
3. **Layer 3's PDF→Word path must be async with visible progress.** ~23 s
   for a short document is foreground-blocking. The reflow path stays
   (Proof 2 passed), but runs off the UI thread with a progress indicator
   (`docbridge:progress`); the OCR path remains the fallback for image-only
   PDFs.
4. **LibreOffice and InPage are unverified — scope P4/P5 as blocked, not
   ready work.** Neither the "universal fallback" claim nor the InPage
   strategy has been exercised against a real install yet.

**Spike-script defects to fix before P1/P2 reference them as ground truth:**
`p0-spike/font-install-test.ps1` (add `AddFontResourceW` + `WM_FONTCHANGE` —
as written it always reports failure), `p0-spike/test-libreoffice.mjs`
(`findSoffice()`'s bare-`'soffice'` fallback reports a false positive on a
machine with nothing installed — must return `null` instead), and
`p0-spike/README.md` (record the Proof 6 result inline).

See ADR-0016–0019 for the four architectural decisions this spec makes
beyond the P0 constraints (agentic loop, adapter platform, project-folder
source of truth, context/rules — including what was deliberately rejected).

---

## 7. Open decisions and explicit non-goals

- **Windows-first.** COM is a Windows technology. macOS gets a separate,
  less complete route via Office AppleScript (§5 P9). Linux gets LibreOffice
  + pure file converters only. The app must say this plainly, not behave
  differently in silence.
- **Word required, or LibreOffice-first?** Current assumption: if most
  target users have Word, the Word adapter is primary and LibreOffice is the
  fallback (P2 before P4). If not, the priority flips. Revisit once Proof 3
  has actually run.
- **No InPage API** — RTF only. If Proof 4 shows RTF is too lossy, UI
  automation or dropping InPage support are both separate, bigger decisions
  — not something to improvise mid-implementation.
- **Where the convert action lives** — `CanvasPanel` toolbar, a
  `LibraryPanel` import/export tab, or both. Undecided; P3 picks one.
- **Bundled fonts** — this spec ships no Nastaliq fonts (licensing). Does
  the app point the user at their own licensed file, or integrate with a
  font the user already has installed? Affects the `install_font` UX.
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
  the budget dialog ships with P8, not after.

See ADR-0019 for the full reasoning behind each rejection above.

---

## 8. Exit criteria

**Per phase:**
- [ ] `npm run typecheck && npm run test && npm run lint && npm run build` pass
- [ ] `npm run build:electron` succeeds; `wordBridge.ps1` present in the
  packaged resources
- [ ] New IPC actions are registered in `electron/ipc/registry.ts` **and**
  exercised through a typed `preload.ts` wrapper
- [ ] No renderer code path reaches PowerShell except through Layer 1
- [ ] RTL/Urdu/Arabic text round-trips correctly in every route the phase
  adds
- **P0:** all six proofs run on a real Windows machine with Word and InPage
  installed, results recorded in ADR-0015. Any failure is resolved
  (architecture revised) before P1 starts — done for the Word core; P4/P5
  stay blocked until Proofs 3/4 run for real.
- **P1:** ✅ an integration test drives the real host end-to-end (open, track
  changes, footnote, save, PID cleanup after a simulated crash) —
  `src/test/hostLive.test.ts`, passed against Word 16.0 on 2026-08-29.
- **P2:** `word.ts` passes `docs/QA-M8.md` items 1–7 on a real machine.
- **P3:** every pair in §4's table converts successfully from the menu (or
  is refused with a clear reason), without the agent.
- **P4/P5:** Proofs 3 and 4 have actually run and are recorded (here or in a
  follow-up ADR); if InPage fails badly, a separate decision is made rather
  than shipping a silently-lossy adapter.
- **P6:** a citation inserted via `applyCitations` reopens correctly as a
  real Word footnote.
- **P7:** a project folder placed inside a synced drive round-trips across
  two machines; the vector index never appears inside that folder.
- **P8:** a natural-language instruction spanning `read → propose_edit →
  insert_footnote → export` completes end-to-end with a Trust-tab
  transcript, and an ungrounded claim is refused rather than footnoted.
- **P9:** at least one Excel or PowerPoint command and one new playbook ship
  without touching Layer 1/2's shared code.

**Milestone-level:**
- [ ] A scholar can take a `.docx`, add citations as real footnotes from
  EasyEditor, and reopen it in Word with footnotes, tracked changes, and RTL
  intact
- [ ] Every lossy route shows its loss list before running
- [ ] No orphaned `WINWORD.EXE` after normal use, app quit, or app crash
- [ ] Proofs 3 and 4 have been run for real, and their results recorded
- [ ] `docs/adr/0015`–`0019` all in `Accepted` status, with 0015 updated if
  P1–P9 force any architecture change beyond what it already predicts
- [ ] `npm run build` (web) and `npm run pack:electron` both succeed with no
  change to web-app behavior

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

- **P1, shipped:** `hostPowershell.test.ts` (FIFO reply matching, per-op
  timeout frees the slot, host-crash rejects all pending + emits `'exit'`,
  refuses off Windows), `hostProcess.test.ts` (the PID + start-time
  fingerprint — a mismatch discards the record without killing anything;
  startup sweep), `docBridgeHandlers.test.ts` (allowlist + action dispatch).
  `hostLive.test.ts` is the gated real-Word integration test.
- `commandBuilder.test.ts` — **most important**: every parameter travels as
  data; quotes, newlines, `;`, `$(…)`, and Urdu text never get concatenated
  into a command string (direct command-injection guard).
- `conversionGraph.test.ts` — path-finding: InPage→docx in two hops; the
  higher-quality path wins when two exist; an impossible pair is refused
  clearly, never silently.
- `capabilityDetect.test.ts` — correct fallback and a clear message when
  Word/LibreOffice aren't found.
- `processLifecycle.test.ts` — timeout, hang detection, orphan cleanup.
- `fontInstall.test.ts` — correct path, registry entry, **and the real
  `AddFontResourceW`/`WM_FONTCHANGE` calls** (constraint 2); a non-font file
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
   **Word's own font list**, in an already-running Word, without restart.
4. Style sheet, page setup, TOC, footnotes — all driven by Word's own
   engine.
5. A supervisor's tracked changes and comments survive the agent's edits.
6. Attempting a global setting change surfaces the consent gate, and can be
   reverted.
7. Closing Word mid-task — the app recovers, no orphaned process remains.
8. A machine without Office — the LibreOffice route works, with a clear
   message (once Proof 3 has run).
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
