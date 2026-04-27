# ADR 0002: Three-tab research mode (Islamic / Custom Sources / General)

- **Status:** Accepted
- **Date:** 2026-04-26
- **Spec reference:** SPEC-v2 §FR-4, §6.3

## Context

V1 had a binary toggle: "general web research" vs "Islamic research." This
muddled three distinct user intents:

1. Search Islamic primary sources (Quran, Hadith, fiqh commentary).
2. Query a user's own uploaded corpus (PDF / DOCX / TXT).
3. Search the open web.

Each intent has different appropriate UI controls (madhhab filter vs file
upload vs nothing) and a different default source set.

## Decision

**Three top-level tabs at the top of the Research page: `Islamic`,
`Custom Sources`, `General`.** Mode-specific options render in an adaptive
panel below the tabs; shared options (language, spelling/citation chips) stay
visible across all tabs.

- **Islamic mode** auto-queries all supported Islamic domains (Dorar, Sunnah,
  AlQuran, Quran.com, Tanzil) in parallel. No domain checklist is shown to the
  user. Madhhab is a single-select dropdown.
- **Custom Sources mode** accepts only user file uploads. No URL input, no
  web search.
- **General mode** uses web search only. No file upload, no Islamic domains.

Switching modes prompts confirmation if there is unsaved draft text in the
composer.

## Rationale

- **Three intents, three tabs, three option sets.** A binary toggle forced one
  mode to host options that didn't apply to it (e.g., madhhab filter visible
  in general mode, or file upload during Islamic queries).
- **Removing the Islamic domain checklist** matches what the primary user
  base (scholars / researchers) actually does in practice — they want all
  domains queried in parallel and summarized. The checklist was friction
  without value.
- **Custom Sources strictly excludes URLs.** URL ingestion has correctness and
  trust problems (paywalls, JS-rendered pages, unreliable scrapes). Files are
  bounded and verifiable.

## Consequences

**Positive**
- UI is mode-locked: a screenshot of the composer in any mode is unambiguous
  about what sources are in play.
- The edge function contract carries an explicit `mode: 'islamic' | 'custom' | 'general'`
  field, making backend routing trivial and per-mode rate-limiting natural.
- Spelling/citation assist chips (FR-1) stack orthogonally on top of any mode.

**Negative**
- Three modes is more screen real estate than a toggle, especially on mobile.
  Mitigated by a compact segmented control and adaptive options panel.
- Mode switching with a draft in the composer requires a confirmation dialog,
  which is a minor friction.

## Follow-ups

- Per-mode session history is already covered by `user_sessions.section = 'research'`;
  if needed later, mode could become a metadata field for filtering.
