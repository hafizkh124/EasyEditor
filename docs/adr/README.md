# Architecture Decision Records

Each ADR captures a non-obvious architectural choice made during v2 — what we
did, what we considered, and why we landed where we did. Use these to
reconstruct rationale without rereading commits.

| # | Title | Status |
|---|---|---|
| [0001](./0001-client-side-audio-chunking.md) | Client-side audio chunking for long-form transcription | Accepted |
| [0002](./0002-three-mode-research.md) | Three-tab research mode (Islamic / Custom Sources / General) | Accepted |
| [0003](./0003-threshold-gated-virtualization.md) | Threshold-gated virtualization for the research chat | Accepted |

## When to write a new ADR

- Choosing between approaches that are both viable.
- Reversing or replacing an earlier ADR.
- A non-obvious constraint shaped the implementation (timeouts, quotas, library limits).

## When **not** to write one

- Routine refactors, bug fixes, dep bumps.
- Decisions already documented in `docs/SPEC-v2.md` Decision Log.
- Things you can read from the code in 30 seconds.
