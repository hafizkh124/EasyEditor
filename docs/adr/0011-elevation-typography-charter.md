# ADR 0011 — Elevation & Typography Charter

**Status:** Accepted · **Date:** 2026-08-14 · **Milestone:** UX-v1 F1 (`docs/SPEC-UIUX.md` §4)

## Context

`SPEC-UIUX.md`'s 2026-08-11 audit (§3, re-verified 2026-08-15) found two of
the "not professional yet" problems were pure token/discipline bugs, not
missing features:

- The CSS elevation ladder was inverted — `--popover` was set to 89%
  lightness, *below* the 96% `--background`, so popovers read as sunken
  rather than raised. Dark mode had the correct relationship (background 9%
  → card/popover 14%, both raised together); only light mode was wrong.
- Chrome UI mixed three font moods (Work Sans, Noto Naskh Arabic, and Lora)
  with nothing stopping a fourth from creeping in on the next PR.

§4.3/§4.4 of that doc defined the target ladder and font charter as prose.
Prose in a spec doesn't stop a regression — nothing enforced either rule.

## Decision

**1. Elevation ladder** (`src/index.css` `:root`):
`--background` (96%) < `--sidebar-background` (98%) < `--card`/`--popover`
(100%, matched to each other), separated by `--border` (87%) where two
layers are adjacent. `--popover` is set *equal* to `--card` rather than a
distinct third value — the original 89% was simply wrong and inverted the
ladder; matching `--card` both fixes the ordering and raises
`text-primary`-on-popover contrast to 5.07:1 (from a WCAG-AA-failing
4.12:1). Both light and dark mode now express the relationship through the
same token pairing, so they can't drift apart again from a single edit to
one mode only.

**2. Typography charter**: chrome (bars, panels, menus, dialogs) uses only
the sans stack (Work Sans → Noto Naskh Arabic → system,
`tailwind.config.ts:117-133`); Nastaliq is confined to `.font-nastaliq`
reader/editor content, never chrome; `font-serif` (Lora) is reserved for
document/editor/reader surfaces exclusively and must never appear in
`src/components/workspace`, `src/components/layout`, `src/components/shamela`,
or `src/components/reader`.

**3. Enforcement**: `scripts/check-ui-discipline.mjs`, wired into
`npm run lint` (the `"lint"` script runs it after `eslint .`) and shared
with `src/test/uiDiscipline.test.ts` through one exported `scanChromeDirs()`
function — deliberately one rule set for both runners, so `lint` and `test`
cannot disagree about what counts as a violation. It hard-fails the build
(`exit 1`) on exactly two rules:

- `font-serif` anywhere in the four chrome directories above.
- Non-spinner `border-2` — a second elevation cue the token ladder doesn't
  otherwise define — exempting small `shrink-0` control indicators
  (checkbox/radio boxes) that legitimately draw their body with a 2px
  border.

A third rule — spacing literals outside the §4.1 vocabulary
(`p`/`px`/`py`/`pt`/`pb`/`pl`/`pr`-`5`/`7`/`9`/`11+`) — is **soft** (warns,
doesn't fail) unless run with `--strict`, which `npm run lint` does not
pass. It exists to keep drift visible without blocking unrelated PRs on
pre-existing micro-padding.

## Consequences

- The elevation ladder is now the single source of truth for "which surface
  reads as raised" — but the *ordering itself* (background < sidebar <
  card) has no automated check; only the font and border-width rules do. A
  future edit to the raw lightness percentages could re-invert the ladder
  without `check-ui-discipline.mjs` or any test catching it. This is a
  known gap, not an oversight — worth closing with a numeric-ordering test
  if elevation regresses again.
- Icon size/color consistency (§4.2) and app-wide spacing consistency (§4.1
  beyond the four chrome directories) are **not** covered by any guard —
  they rest on convention established in components like `TrustTab.tsx`,
  not enforcement. Don't assume `check-ui-discipline.mjs` catches every §4
  rule; it catches exactly the two hard rules and one soft rule above.
- Any new top-level directory under `src/components/` that renders chrome
  (bars, panels, menus) needs to be added to `CHROME_DIRS` in
  `scripts/check-ui-discipline.mjs`, or it silently falls outside every
  rule in this charter.
