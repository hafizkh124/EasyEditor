# ADR 0023 — OCR (`ocr_document`) Is a Consent-Gated Cloud Bridge; Local OCR Stays Blocked

**Status:** Accepted · **Date:** 2026-09-06 · **Milestone:** SPEC-M9 (Phase 7, the last M9 phase)

## Context

Use case 4 ("digitise a scanned book") and the scan-witness path of use case 11
need the agent to turn page images into text. The repo already has the pieces:
`supabase/functions/process-ocr` (Gemini-vision OCR, one page image in → text
out, signed-in, token-metered) and `src/lib/ocr/pdfRenderer.ts` (pdf.js
rasterisation). Neither was agent-reachable.

Two constraints shaped this:

1. **Fully-local OCR is blocked** on the M7.4 privacy line — there is no bundled
   offline OCR engine, and adding one (Tesseract/ONNX + language data, +tens of
   MB, a model-quality and packaging review) is its own milestone. M9 does not
   reopen it.
2. **`process-ocr` uploads page images to a cloud service.** For a local-first
   scholarly tool that is a real disclosure — the scholar may be digitising an
   unpublished manuscript. It cannot happen silently the way `search_shamela`
   (all local) or even `search_hadith` (a query string, not a document) do.

## Decision — a renderer bridge, exactly like `transcribe_media`

`ocr_document { scan_path, lang?, pages? }`, `effect: 'write'`. The main-process
agent loop cannot render a PDF or make the signed-in call, so it asks the
renderer (`AGENT_PROGRESS` `kind: 'ocr-request'` → `electron/agent/ocrBridge.ts`
→ reply on the `ocrResult` IPC action) — the same pattern as `search_general`
(ADR-0019 #7) and `transcribe_media` (Phase 5). The renderer
(`AgentPanel.handleOcr`) rasterises the scan with `renderPdfPages`, calls
`src/lib/ocr/ocrClient.ts` `ocrPageImage` once per page, and returns
`{ pages: [{ page, text }] }`.

`electron/agent/adapters/ocr.ts` writes the result to
`sources/<name>.ocr.txt`, page-delimited (`──── صفحہ N ────`) so a proofreader
can line each block up with the scan. The write is `guardWrite`'d, so "Undo this
task" removes it. A live `document` artifact streams the text as it lands.

## Decision — consent is a sticky per-project flag, not a per-call prompt

The first `ocr_document` call in a project where consent has not been given
returns `{ needsConsent: true, message }` and **uploads nothing** — same shape
as `set_global_option` (SPEC-M8 §3 gate #5). The Agent panel shows a consent
card (reusing the `set_global_option` card's styling); approving it calls
`agent.grantOcrConsent(projectRoot)`, which sets `ocrConsent: true` in
`.easyeditor/project.json`. The scholar then re-runs the task.

- **Per-project, not global:** consent travels with the project folder, so a
  shared or synced project carries its own decision.
- **Sticky, not per-call:** a scanned book is dozens of pages; re-prompting each
  page would be unusable, and the disclosure ("images go to the cloud") is the
  same for every page of every scan in the project. `dispatch.ts` reads the flag
  (`run.ts` injects it as `session.ocrConsent`); the bridge is never called
  while it is false.
- **Withdrawable:** `setOcrConsent(root, false)` drops the key. Not surfaced in
  the UI yet (a manifest edit); a revoke button is a cheap follow-up.

## Decision — OCR output is never a citation, and its chapter is labelled

`ocr_document` does **not** touch the retrieval ledger. Its `note` instructs the
agent to pass the path to `create_chapter`'s `from_source` with a title marked
`[OCR — غير مدقّق]` and to tell the scholar to proofread every page. The
`systemPrompt.ts` BASE gained a rule to the same effect, and the `/digitize-book`
playbook's `guidance` spells out that OCR misreads nastaʿlīq and worn scans and
that the draft must be checked line-by-line against the image.

**The plan's third `/digitize-book` step — `draft_section(prose cleanup)` — was
dropped.** The only non-grounded draft mode is `literary-urdu`, which *recasts*
text into fluent prose; run over an OCR draft it would paper over recognition
errors with confident phrasing — the opposite of what a digitisation pass needs.
`/digitize-book` is therefore two steps: `ocr_document` → `create_chapter`.
Cleanup stays a human proofreading pass.

## ADR-0027 checklist (applied, per phase)

- **F2** — a `scan`/`ocr` domain rule in `toolScoping.ts` (`ocr_document`,
  `create_chapter`, `draft_section`).
- **F3** — the `ocr_document` description carries the "Do NOT use when…" clause
  (recordings → `transcribe_media`; digital `.docx` → `read_document`; outside
  the project folder).
- **F4** — the dispatch result returns `ocrPath` + `pageCount` + a
  `capResult`-clamped 1500-char preview, never the whole book.

## Consequences

- No new IPC channel — `ocr-request` rides `AGENT_PROGRESS`; `grantOcrConsent` /
  `ocrResult` are `AGENT_INVOKE` actions.
- `ProjectManifest.ocrConsent?: boolean`; `readOcrConsent` / `setOcrConsent` in
  `projectFolder.ts` next to the connector switches.
- `taskWrote()` treats a `needsConsent` result as inert, so a bare consent
  request does not leave an empty checkpoint in "Undo this task".
- Fully-local desktop OCR remains a documented non-goal (SPEC-M8 hard-blocked
  list, M7.4).
- **Phase 7 completes M9.** All 13 use cases now have a playbook; the OCR one is
  gated as above.
