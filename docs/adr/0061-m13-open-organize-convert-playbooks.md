# ADR 0061 — Open, collect and convert the scholar's files by chat; three desktop playbooks

**Status:** Accepted · **Date:** 2026-09-29 · **Milestone:** M13 Scholar Desktop Agent · **Extends:** [ADR-0020](./0020-m9-playbook-execution.md), [ADR-0056](./0056-m13-outside-project-file-edits.md), [ADR-0059](./0059-m13-computer-search-and-folder-library.md)

## Context

The scholar asked for "more capabilities, so any task can be done by chat".
After search (ADR-0059) and Word editing (ADR-0057), the everyday gaps were:
open a found file, gather files into one folder, and convert a file that is
not in a project.

## Decision

- **`open_file` (read)** opens a document in its default program via
  `shell.openPath`, after the scholar approves the card. Document extensions
  only (`openFile.ts`) — never an executable, script or shortcut, so a path
  from a model or a web page can never become "run this". Being `read`, it
  works in Ask mode (opening changes nothing).
- **`organize_files` (write)** copies (default) or moves up to 200 documents
  into one folder, approved per call. It never deletes and never overwrites:
  a clash becomes `name (2).ext`, and every file is placed with
  `COPYFILE_EXCL` / an existence check. A cross-drive move is copy → size
  check → remove. Every copy/move is returned on the run result
  (`fileOps`), and the result card's **"فائلیں واپس کریں"** undoes them: a
  move goes back only if its original spot is still free; a copy is removed
  only while the original still exists and the copy is unchanged in size.
  Destination: absolute, not a drive root, not a system or AppData folder,
  created only one level below an existing parent.
- **`convert_document` accepts a full `path`** as well as a chapter: the
  converted copy is written **beside** the source as `name.pdf` (or
  `name (2).pdf`), after approval; the source is never touched.
- **Ask-mode "direct" route** (ADR-0038) now also exposes
  `read_external_document` and `search_my_computer`, so "summarise my file
  D:\x.docx" can read it.
- **Three playbooks** (ADR-0020 format): `/format-urdu` (find → fonts +
  Arabic-Indic page numbers with backup), `/shamela-cite` (search Shamela →
  read the page → footnote with the deterministic reference), and
  `/collect-files` (find → copy/move into a folder). Keywords are specific so
  they do not capture existing asks.

## Consequences

- No delete tool exists or is planned: removing a scholar's file stays a
  human action.
- Undo of `organize_files` is per run (the result card), not part of task
  checkpoints — the files usually live outside any project.

## Tool scoping — found by the live model checks

- **`agentDesktopTools.live.test.ts`** (opt-in, `M13_AGENT_LIVE=1`) runs the
  blueprint's own example asks through real Gemini + the real registry,
  scoping and intent routing (recording stub dispatch). It caught two routing
  bugs the mocked suite could not: "مکتبہ شاملہ میں … حدیث" was gated to the
  hadith connector so `search_shamela` was never offered (fixed: an explicit
  Shamela domain rule, checked first), and "یہ صفحہ پڑھ کر خلاصہ بتاؤ <url>"
  was routed as a plain edit with no tools (fixed: a URL counts as needing a
  source). All five scenarios now pass.
- **The existing live eval caught a regression**: `.docx` as a keyword
  matched every chapter name ("باب 01-fiqh.docx پر …"), narrowing the tools so
  `set_page_layout` vanished (0/3 vs main 2/2). File-extension keywords were
  removed and generic words (collect, organize, folder) replaced by phrases.
- **`DOMAIN_ONLY_TOOLS`**: the seven M13 desktop tools are offered only when
  a domain rule or playbook names them (or Plan/Auto runs with no project
  open), never on the un-narrowed full-registry route — seven more tools on
  every open ask measurably diluted tool choice (draft-grounded-section 0/5).
  After the fix the eval is at parity with main (82% vs 83%, same three
  pre-existing flaky scenarios; a playbook scenario times out on both).
