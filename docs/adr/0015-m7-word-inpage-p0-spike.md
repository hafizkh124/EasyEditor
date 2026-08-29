# ADR 0015 — M7 Desktop Document Bridge: a P0 Spike as a Hard Gate Before Adapter Code

**Status:** Accepted · **Date:** 2026-08-29 · **Related:** [ADR-0006](./0006-workspace-backend-adapter.md), [ADR-0007](./0007-shamela-native-read.md)

## Context

The M7 line has a second strand beyond STRATEGY-v1 §5's local LLM/OCR/embeddings
sequence: a **desktop document bridge** that lets EasyEditor round-trip a
scholar's work through the tools they actually use — Microsoft Word (`.docx` as
the source of truth: real footnotes, tracked changes, RTL page setup) and
InPage (Nastaliq typesetting, no public API). The planned shape is three layers:

- **Layer 1** — `electron/host/`: a long-lived PowerShell host process driving
  Word over COM via JSON on stdio (the same "own long-lived helper process"
  pattern ADR-0007 used for Shamela's JRE), plus `process.ts` for lifecycle.
- **Layer 2** — `electron/adapters/word.ts` and a `shared/adapters/libreoffice.ts`
  fallback for users without Office.
- **Layer 3** — the conversion map (PDF→Word, docx↔RTF↔InPage, …).

The plan committed to one rule: **if any P0 proof fails, the affected layer's
architecture is reconsidered then — not deferred past P1.** So before any
adapter code, `p0-spike/` was written: six runnable proofs plus one manual
checklist. The spike was authored in a Linux container and could not be run
there; it needed a real Windows machine with Word installed.

That run happened on 2026-08-29 (Windows 11, Word 16.0, no LibreOffice, no
InPage). This ADR records what it found and the constraints that now bind P1.

## Decision

**Proceed to P1 for Layers 1 and 2, with four constraints locked in. Record the
LibreOffice and InPage paths as unverified. Fix three defects in the spike
scripts before they are used as a reference for the real code.**

### What the spike proved

| # | Proof | Result |
|---|---|---|
| 1 | Word COM over a long-lived PowerShell/JSON host — open, `TrackRevisions`, RTL `PageSetup`, real `Footnotes.Add`, `SaveAs2` | **PASS.** Verified in the output `word/document.xml` / `footnotes.xml` and visually in Word (RTL margins, Urdu footnote at page bottom, tracked edits). The Layer 1 pattern holds. |
| 2 | Word's own PDF reflow (`Documents.Open` on a `.pdf`) | **PASS but slow** — a text PDF reflowed to 312 words in **~23 s**. No external converter needed. |
| 3 | LibreOffice detect + headless `--convert-to pdf` | **UNVERIFIED** — not installed. |
| 4 | InPage ↔ RTF round-trip | **UNVERIFIED** — not installed. Confirmed separately: InPage exposes no COM/CLI/scripting surface, which is *why* the plan routes through RTF rather than driving InPage. |
| 5 | A per-user font install becoming visible to Word | **PASS only with the real font APIs** — see below. |
| 6 | Orphaned `WINWORD.EXE` after an unclean host exit | **FAIL by design** — Word kept running after the host was `SIGKILL`ed without `{op:"quit"}`. |

### The four constraints on P1

1. **`electron/host/process.ts` must own the `WINWORD.EXE` PID and kill it
   actively.** Proof 6 confirms Word does not exit when its automating process
   dies. The host records the PID (`wordPid` op already returns it) and, on its
   own crash/shutdown, force-kills it. This is not a "nice to have" for the
   cleanup path — it is the default path.

2. **Font installation must call `AddFontResourceW()` + broadcast
   `WM_FONTCHANGE`, not just copy the file and write the HKCU key.** With only
   the copy + `HKCU\...\Fonts` value (what `font-install-test.ps1` does today),
   the font was invisible to Word — not just to the running process, but to a
   freshly-started Word too (font count stuck at 1298). Adding
   `AddFontResourceW` + a `SendMessageTimeout(HWND_BROADCAST, WM_FONTCHANGE)`
   broadcast fixed it: a new Word saw it (1299), **and an already-running Word
   picked it up with no restart.** So the plan's font-verification risk does
   **not** require forcing a Word restart — but the adapter must do the real
   registration and still verify via the `installFontCheck` op, falling back to
   "restart Word" only if verification fails.

3. **Layer 3's PDF→Word path must be async with visible progress.** ~23 s for a
   short document is a foreground-blocking operation. The reflow path stays
   (Proof 2 passed), but it runs off the UI thread with a progress indicator,
   and the OCR path remains the fallback for image-only PDFs.

4. **LibreOffice and InPage are unverified — treat them as such in P1
   scoping.** The "universal fallback for users without Office" claim and the
   entire InPage strategy have not been exercised against real installs. P1
   should not spend engineering time hardening either adapter until the
   corresponding proof has been run on a machine that has the software. The
   InPage RTF checklist (`p0-spike/inpage-rtf-checklist.md`) is the gate for
   that strand.

### Spike-script defects to fix before P1 references them

- **`font-install-test.ps1`** — omits `AddFontResourceW` + `WM_FONTCHANGE`
  (constraint 2). As written it always reports failure.
- **`test-libreoffice.mjs`** — `findSoffice()` returns the `'soffice'` string
  as an unconditional last-resort candidate, so it prints
  `{"ok":true,"step":"detect","found":true}` on a machine with no LibreOffice,
  then dies with `spawn soffice ENOENT`. Detect must return `null` when nothing
  real is found.
- **`p0-spike/README.md`** and the proof-6 row — record the confirmed orphan
  result inline so the finding is not lost when the spike folder is eventually
  deleted.

## Rationale

- **A spike that is never run is not a gate.** The plan's "reconsider the
  architecture now, not at P1" rule only bites if P0 actually executes against
  real Word/InPage. It has now run for the Word half; the ADR captures the
  result so P1 starts from evidence, not the original assumption.
- **The long-lived-host pattern was the biggest risk and it passed.** Proof 1
  is the load-bearing one — if COM automation of footnotes / tracked changes /
  RTL had not worked over a JSON-on-stdio host, Layers 1 and 2 would have
  needed a different foundation entirely. It worked, so the rest is
  implementation detail with known constraints.
- **Two "failures" are cheap findings, not blockers.** Proof 6 is a
  design-detail input to `process.ts`; Proof 5's gap is a three-API-call fix.
  Both are far cheaper to absorb now, pinned in this ADR, than to discover
  during P1.
- **Not blocking P1 on LibreOffice/InPage.** Those adapters are Layer 2/3
  breadth, not the Word core. Gating the whole milestone on installing two more
  applications would stall the part that is proven and ready.

## Consequences

**Positive**

- P1 (`electron/host/powershell.ts`, `process.ts`, `electron/adapters/word.ts`)
  can start against a validated pattern with its four sharp edges already
  known and specified.
- The orphan-process and font-registration behaviours are documented before
  any user hits them.

**Negative**

- The Office-less fallback (LibreOffice) and the entire InPage strategy remain
  unproven. If InPage's RTF round-trip turns out to mangle Nastaliq text, that
  strand needs a separate decision (UI automation vs dropping InPage support) —
  this ADR does not pre-decide it.
- ~23 s PDF reflow constrains Layer 3 UX; a scholar importing a 300-page book
  this way is not viable and will need the OCR/chunked path instead.

## Follow-ups

- Run Proofs 3 and 4 on a Windows machine with LibreOffice and InPage
  installed; append results here (or a follow-up ADR if InPage forces a
  strategy change).
- P1: implement constraints 1 and 2 in `electron/host/`; wire the
  `installFontCheck` verification loop into the font adapter.
- Apply the three spike-script fixes, or delete `p0-spike/` once P1 lands and
  fold its proofs into `docs/` as the ADR record (the folder's own README calls
  this out as the intended end state).
- ~~There is still no `docs/SPEC-M7.md` for this document-bridge strand.~~
  **Done, 2026-08-29** — [`docs/SPEC-M7.md`](../SPEC-M7.md) (Draft). It carries
  §0: the "M7" label collides with STRATEGY-v1 §5's desktop/privacy line and
  needs a rename decision (M7-renumber vs call this strand M8) before it leaves
  Draft.
