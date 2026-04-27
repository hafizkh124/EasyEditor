# ADR 0003: Threshold-gated virtualization for the research chat

- **Status:** Accepted
- **Date:** 2026-04-26
- **Spec reference:** SPEC-v2 §NFR-2, §7 Phase 5

## Context

NFR-2 requires that the research chat handle 500+ messages without jank. The
spec recommends `react-window` virtualization. Most chat UIs that virtualize
do so unconditionally, but our messages have wildly variable heights:

- A typing indicator is ~40 px.
- A short user bubble is ~50 px.
- A streamed assistant response with markdown can exceed 1000 px.
- The "DocumentBox" wrapper around the latest assistant response adds toolbars,
  icons, and conditional refinement overlays.

`react-window`'s `VariableSizeList` requires either a known height up front or
a measure-then-resize loop via `ResizeObserver` + `resetAfterIndex`. Both add
complexity, and incorrect measurements show up as overlapping rows or scroll
glitches that are hard to reproduce.

## Decision

**Render the chat flat below 50 list items; switch to a virtualized list above
that threshold.** A single component `VirtualMessageList` wraps `react-window`'s
`VariableSizeList` with a `ResizeObserver`-backed height cache and an
`AutoSizer` parent.

The threshold is hard-coded at the call site, not configurable.

## Rationale

- **The common case — short chats — is the one we don't want to risk regressing.**
  A simple flat render is always correct for variable-height markdown content;
  virtualization is only correct if measurement is correct.
- **The hard case — long chats — is rare but real.** Power users hit hundreds
  of messages. Without virtualization, scrollback becomes janky as ReactMarkdown
  re-runs over hundreds of nodes.
- **A threshold lets us ship the easy 90% safely.** If a measurement bug surfaces
  in production, it only affects users with 50+ messages — a small, easy-to-find
  cohort.
- **`react-window` v1 over v2.** v2 has a different API and the upstream
  `@types/react-window` has not been updated. v1 is stable, well-typed, and
  widely deployed.

## Consequences

**Positive**
- Zero behavior change for typical sessions.
- Markdown reflow inside a row triggers `ResizeObserver` → `resetAfterIndex`,
  so dynamic content (streaming responses, image loads) self-corrects.
- The threshold is a single constant — easy to lower if we want to stress-test
  virtualization against production traffic.

**Negative**
- Two render paths to maintain. The flat path uses normal scroll behavior;
  the virtualized path uses `scrollToItem(last, "end")` for auto-follow.
- The `bottomAnchorRef` only works in the flat path; auto-scroll in
  virtualized mode is handled internally.
- Initial render of the virtualized list flickers as rows measure for the
  first time (estimated 120 px → real height). Acceptable; would need
  per-row-type estimates to fully eliminate.

## Follow-ups

- If we ever hit a measurement bug, the threshold can drop temporarily to
  reproduce. If we never do, the threshold can stay at 50 indefinitely.
- Consider per-row-type estimates (typing: 40, user: 60, assistant: 200,
  document-box: 400) to reduce first-paint flicker.
