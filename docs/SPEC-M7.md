# SPEC-M7 — Desktop Document Bridge: Word & InPage Round-Trip

> **Status:** Draft · **Date:** 2026-08-29 · **Base:** [SPEC-M6.md](./SPEC-M6.md), [ADR-0006](./adr/0006-workspace-backend-adapter.md), [ADR-0007](./adr/0007-shamela-native-read.md), [ADR-0015](./adr/0015-m7-word-inpage-p0-spike.md)
>
> M6 turned EasyEditor into an Arabic library application. M7 (this strand)
> connects it to the two tools a working scholar already lives in —
> **Microsoft Word** (`.docx` as the authoritative format: real footnotes,
> tracked changes, RTL page setup) and **InPage** (Nastaliq typesetting, no
> public API) — so a document can move between EasyEditor and those tools
> without losing structure.

---

## 0. A note on the "M7" label

STRATEGY-v1 §5 already assigns **M7** to the *desktop / privacy line*
(two-tier tashkeel, local LLM, local embeddings, local OCR). This document
covers a **different workstream** — the desktop document bridge — that was
planned separately and inherited the "M7" name from its P0 spike commit
(`282125a`, "M7 P0 spike…") and `p0-spike/README.md`.

**Open decision (see §7):** keep this as M7 and renumber the privacy line, or
rename this strand M8. Until that is settled, "M7" in this file means the
document bridge, and the two strands are independent — neither blocks the
other.

---

## 1. Context

### 1.1 What exists

- **Desktop shell (M5–M6):** Electron app, `contextIsolation: true`, IPC
  through an explicit channel allowlist (`electron/ipc/registry.ts`), renderer
  reaches main only via `electron/preload.ts`.
- **The "own long-lived helper process" pattern (ADR-0007):** `electron/shamela/`
  drives Shamela's bundled JRE as a child process, JSON commands in / JSON
  lines out, never string-interpolating caller input into a command line.
  M7's Word host is the same pattern pointed at PowerShell + COM.
- **`WorkspaceBackend` adapter (ADR-0006):** all renderer data access goes
  through `getBackend()`; desktop-only capability is exposed as new IPC
  actions, not new Supabase calls.
- **Editor:** TipTap rich editor in `CanvasPanel`; import already accepts
  PDF / DOCX / TXT as *sources* (SPEC-v2 FR-4.5.1) but has no structured
  export and no Word/InPage round-trip.

### 1.2 What the P0 spike established (2026-08-29, real Windows + Word 16.0)

Full results and rationale are in **ADR-0015**. In short:

| Proof | Result |
|---|---|
| Word COM over a long-lived PowerShell/JSON host (open, track changes, RTL page setup, real footnote, save-as) | **PASS**, verified in output XML and visually |
| Word's own PDF reflow (`Documents.Open` on a `.pdf`) | **PASS**, ~23 s for a short text PDF |
| LibreOffice detect + headless convert | **UNVERIFIED** — not installed on the test machine |
| InPage ↔ RTF round-trip | **UNVERIFIED** — not installed; confirmed InPage has no COM/CLI/scripting surface |
| Per-user font install visible to Word | **PASS only with `AddFontResourceW` + `WM_FONTCHANGE`** — file copy + registry key alone is not enough |
| Orphaned `WINWORD.EXE` after an unclean host exit | **FAIL by design** — Word does not exit when its automating process dies |

The Word core (the load-bearing risk) is proven. The four constraints in §6
come directly from these results.

---

## 2. Non-Goals

- Cloud/server-side document conversion — M7 is desktop-only, all local.
- Editing Word or InPage documents *in place* inside EasyEditor's editor —
  M7 moves documents *between* tools; it does not replace them.
- A general-purpose Office automation API for third parties.
- macOS/Linux Word automation (COM is Windows-only; the LibreOffice path is
  the cross-platform and Office-less fallback).
- Lossless InPage conversion — the plan commits to being **explicit about what
  a conversion drops**, not to dropping nothing (see §4).
- Bulk conversion of large books through Word's PDF reflow (~23 s/short doc —
  use the OCR/chunked import path for those).

---

## 3. Architecture

### 3.1 Three layers

```
Layer 1 — electron/host/            the process boundary
  powershell.ts   long-lived PowerShell host; one process, JSON in / JSON lines out
  process.ts      lifecycle + orphan cleanup (owns the WINWORD.EXE PID)
  wordBridge.ps1  shipped as an extraResource; the script the host runs

Layer 2 — electron/adapters/        the tool adapters
  word.ts         Word COM operations, built on Layer 1
  libreoffice.ts  detect + headless convert; the Office-less / cross-platform fallback
  inpage.ts       docx ↔ RTF ↔ InPage via RTF (InPage has no API)

Layer 3 — conversion map            the routing
  which adapter handles which {from,to} pair, and what each route is known to lose
```

### 3.2 Op protocol (Layer 1 ↔ Layer 2)

The host speaks the protocol the spike's `word-bridge.ps1` already proved.
Every message is a JSON object with a fixed `op`; arguments are **data**, never
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

New ops for P1+ (design in the phase that needs them): `exportRtf`,
`readStructure` (headings / footnotes / tracked-change inventory for the
conversion report), `applyCitations` (insert a batch of footnotes at marked
positions), `installFont` (the real `AddFontResourceW` + broadcast, per §6.2).

### 3.3 Security principle

Carried verbatim from the spike and ADR-0007: **model or user text is never
evaluated as script.** The host is a fixed `switch ($cmd.op)`; paths and
payloads are read as data. Nothing reaches `Invoke-Expression`, `cmd /c`, or a
shell string. This is the same rule `electron/ipc/registry.ts` enforces for
channel names, extended to the PowerShell boundary.

### 3.4 IPC surface

One new allowlist entry, action-dispatched like `SHAMELA_INVOKE`:

```
DOC_BRIDGE_INVOKE            'docbridge:invoke'     { action, ... }
DOC_BRIDGE_PROGRESS          'docbridge:progress'   main → renderer (long conversions)
```

Actions: `detectTools`, `toWord`, `fromWord`, `toInPage`, `fromInPage`,
`convert` (routes via Layer 3), `installFont`, `cancel`. Typed wrappers added
to `preload.ts` alongside the handler, matching the `shamela.*` shape.

### 3.5 Packaging

`wordBridge.ps1` ships via electron-builder `extraResources` (like
`shamela-helper.jar`); Layer 1 resolves it from `process.resourcesPath` in a
packaged build and from the repo path in dev, with a diagnostic "looked in …"
error if missing — same helper-path logic as `getHelperJarPath()`. A
`scripts/check-doc-bridge.mjs` pre-build check mirrors `check:shamela-helper`.

---

## 4. Layer 3 — the conversion map

Each route names the adapter and what it is **known to lose**. The renderer
shows the loss list before running a conversion (risk item #6: explicit about
lossy conversions).

| From → To | Adapter | Known loss |
|---|---|---|
| EasyEditor doc → `.docx` | `word.ts` (or `libreoffice.ts`) | none expected for text + footnotes + RTL |
| `.docx` → EasyEditor doc | `word.ts` `readStructure` | Word fields, macros, embedded objects |
| `.pdf` (text layer) → `.docx` | `word.ts` `openPdfReflow` | exact layout; slow (~23 s+) |
| `.pdf` (image only) → text | **OCR path (STRATEGY-v1 M7.4), not this strand** | — |
| `.docx` → `.rtf` → InPage | `inpage.ts` | footnotes, headings likely; **must verify (Proof 4)** |
| InPage → `.rtf` → `.docx` | `inpage.ts` | depends on Unicode vs legacy Noori encoding |
| any → any, no Office installed | `libreoffice.ts` | **must verify (Proof 3)** |

Legacy InPage (non-Unicode Noori nastaliq encoding) needs a legacy↔Unicode
mapping step before the RTF is usable — scoped in the InPage phase, gated on
Proof 4.

---

## 5. Phases

### P0 — Spike ✅ done (ADR-0015)

### P1 — Layer 1: the host
`electron/host/powershell.ts` + `process.ts`. Promote `p0-spike/host.mjs` and
`word-bridge.ps1` to production: reconnect on host crash, per-op timeouts,
structured errors, and **`process.ts` owning the `WINWORD.EXE` PID and killing
it on host shutdown/crash** (§6.1). IPC: `detectTools`, `ping`. No renderer UX
yet — exit criterion is an integration test that drives the real host.

### P2 — Layer 2: Word adapter
`electron/adapters/word.ts` — `toWord` / `fromWord` / `openPdfReflow` /
`readStructure`, each an op sequence over Layer 1. Wire `installFont` with the
real font APIs (§6.2) and the `installFontCheck` verification loop.

### P3 — Renderer: convert dialog
`CanvasPanel` action → pick source/target → show the Layer 3 loss list →
run with a progress bar (§6.3, conversions are async) → open the result.
`getBackend()` only; desktop-gated.

### P4 — LibreOffice fallback
`electron/adapters/libreoffice.ts`. **Blocked on Proof 3** — run the spike's
`test-libreoffice.mjs` on a machine with LibreOffice first; fix its
`findSoffice()` false-positive (§6, ADR-0015).

### P5 — InPage
`electron/adapters/inpage.ts` (docx ↔ RTF ↔ InPage) + the legacy-Noori mapping.
**Blocked on Proof 4** — complete `p0-spike/inpage-rtf-checklist.md` on a
machine with InPage. If the RTF round-trip mangles Nastaliq text badly, this
phase stops and the InPage strategy is re-decided (ADR follow-up), not
improvised.

### P6 — Citation integration
`applyCitations` op: take EasyEditor's citation output and insert it as real
Word footnotes at marked positions, so "add citations" can target a `.docx`
directly. Reuses the web citation-integrity gates.

---

## 6. Constraints carried from ADR-0015

**6.1 — `process.ts` actively kills `WINWORD.EXE`.** Proof 6 confirmed Word
survives an unclean host exit. The host records the PID (`wordPid`) and
force-kills it on its own shutdown or crash. This is the default path, not an
error-only fallback. A stale-PID sweep on host start covers the case where the
app itself was killed.

**6.2 — Font install must call the real APIs.** File copy +
`HKCU\…\Fonts` key left the font invisible even to a freshly started Word.
`AddFontResourceW()` + `SendMessageTimeout(HWND_BROADCAST, WM_FONTCHANGE)`
fixed it, and an already-running Word then picked it up with no restart. The
adapter does the real registration, then verifies with `installFontCheck`, and
only falls back to "please restart Word" if verification fails.

**6.3 — Conversions are async with visible progress.** ~23 s for a short PDF
reflow is foreground-blocking. All Layer 3 routes run off the UI thread and
emit `docbridge:progress`.

**6.4 — LibreOffice and InPage are unverified.** P4 and P5 do not start until
their proof has run on a machine with the software. Scope them as blocked, not
as ready work.

**Spike-script fixes (before P1 references them):** `font-install-test.ps1`
(add the font APIs), `test-libreoffice.mjs` (`findSoffice()` must return `null`
when nothing real is found), `p0-spike/README.md` (record the Proof 6 result
inline).

---

## 7. Open decisions

1. **M7 vs M8 naming** (§0) — resolve before this file leaves Draft.
2. **Word required, or LibreOffice-first?** If most target users have Word, the
   Word adapter is primary and LibreOffice is the fallback (current
   assumption). If not, the priority flips and P4 moves ahead of P2.
3. **InPage support at all?** Contingent on Proof 4. If it fails, options are
   UI automation (bigger) or dropping InPage — a separate ADR.
4. **Where the convert action lives** — `CanvasPanel` toolbar, a
   `LibraryPanel` import/export tab, or both.
5. **Bundled fonts** — M7 ships no Nastaliq fonts (licensing). Does the app
   point the user at their own licensed file, or integrate with a font the
   user already installed? Affects the `installFont` UX.

---

## 8. Exit criteria

### Per phase
- [ ] `npm run typecheck && npm run test && npm run lint && npm run build` — pass
- [ ] `npm run build:electron` succeeds; `wordBridge.ps1` present in the packaged resources
- [ ] New IPC actions registered in `electron/ipc/registry.ts` **and** exercised through a typed `preload.ts` wrapper
- [ ] No renderer code path reaches PowerShell except through Layer 1
- [ ] RTL / Urdu / Arabic text round-trips correctly in every route the phase adds

### Milestone
- [ ] A scholar can take a `.docx`, add citations as real footnotes from
  EasyEditor, and reopen it in Word with footnotes, tracked changes, and RTL
  intact
- [ ] Every lossy route shows its loss list before running
- [ ] No orphaned `WINWORD.EXE` after normal use, app quit, or app crash
- [ ] Proof 3 and Proof 4 have been run for real, and their results are
  recorded (here or in an ADR)
- [ ] `docs/adr/` has an ADR for any architecture change P1–P6 forced beyond
  ADR-0015
