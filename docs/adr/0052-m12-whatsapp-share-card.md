# ADR 0052 — WhatsApp Share Card (Renderer SVG, Not a Main-Process Tool)

**Status:** Accepted · **Date:** 2026-09-12 · **Milestone:** M12 (Phase F) · **Extends:** [ADR-0049](./0049-m11-derived-agent-affordances.md)

## Context

A zakat/farā'iḍ result (or any table artifact) had no path to a shareable
image. This was the largest gap in M12's export trio: nothing existed for
it at all — no component, no tool, no wiring.

Two constraints ruled out the obvious "add an agent tool" shape immediately:
the Electron MAIN process cannot generate an image at all (no `sharp`,
`puppeteer`, or `satori` in `package.json`, and adding one is out of scope —
see ADR-0048's "out of scope" table), and `.png` is not in the `DocExt` write
allowlist `assertSafeOutputPath` enforces (`electron/adapters/paths.ts`) —
correctly so, since this was never meant to be a file the bridge writes, but
a browser download the scholar explicitly triggers.

Investigating the existing `ArtifactToolbar`'s PNG/SVG export buttons
surfaced a second, unrelated but real bug: `isVisual` (the condition that
shows those buttons) included `artifact.type === "table"` since M11 Phase 4,
but `exportAs()` only ever serialises `bodyRef.current.querySelector("svg")`
— a table artifact renders an HTML `<table>`, not an `<svg>`, so the button
was there, clickable, and did nothing, every single time.

## Decisions

**Renderer-only, no new agent tool, no file-bridge involvement.**
`src/components/workspace/artifacts/ShareCard.tsx` is a plain React
component rendering a 1200×1200 `<svg>` — a teal/gold Islamic border with
corner accents, the artifact's title, its table (hand-laid-out as
`<rect>`/`<text>`, capped at 8 rows with a "+N more" row rather than
overflowing), an optional caption, and a fixed disclaimer footer
("Prepared with EasyEditor — please verify with a qualified mufti").
`ArtifactToolbar` mounts it OFF-SCREEN (`position: fixed; left: -99999px`,
not `display: none` — some engines skip text-metric layout for a
non-displayed subtree) whenever the active artifact is a `table` with data,
so its ref is ready before the button is even clicked. Clicking rasterises
it through the EXISTING `svgElementToPng` (scale 1 — the card is already a
real 1200×1200 SVG, not something to further oversample) and downloads it
with the EXISTING `downloadBlob` — the same renderer-only pipeline
`sanad-tree`/`matn-diff` already use, extended to a purpose-built SVG rather
than the artifact's own displayed one.

**Hard-coded colours, not CSS custom properties.** `svgElementToPng` loads
the serialised SVG as a STANDALONE document (`new Image()` against an
object URL) — it has no access to the host page's `:root` variables, so a
`var(--x, #fff)` would silently render as its fallback only, every time.
Since a branded share card should look identical regardless of the app's
current light/dark theme anyway, every colour in `ShareCard.tsx` is a plain
hex literal.

**Nastaliq via the already-bundled local font, best-effort.** The card's
`font-family` is `"Noto Nastaliq Urdu"` (the same family `.font-nastaliq`
uses app-wide), backed by the already-vendored `@fontsource/noto-nastaliq-urdu`
package — no network fetch, fully offline. That face is lazy-loaded on
demand (`loadEditorFont("nastaliq")`, only pulled in once the reader
actually uses it), so the toolbar's click handler explicitly loads it (and
awaits `document.fonts.ready`, best-effort) before rasterising, rather than
assuming it is already registered.

**This is also the fix for the M11 table-export no-op.** `isVisual` (raw
PNG/SVG export of `bodyRef`'s own `<svg>`) drops `"table"` — it never
applied there correctly. A table artifact now shows the Share Card button
in its place; `sanad-tree`/`matn-diff` are unaffected.

**No PDF/table-shaped "flat" SVG path.** The plan considered a simpler
"just serialise the visible `<table>` as if it were an SVG" fallback; there
is no such thing — an `<img>`-rasterised SVG cannot render HTML at all
(`<table>`, `<foreignObject>` support is inconsistent across engines for
that exact path), which is why `ShareCard` hand-lays-out its own table
rather than reusing `ArtifactBody`'s HTML one.

## Consequences

- New: `src/components/workspace/artifacts/ShareCard.tsx`.
- `ArtifactToolbar.tsx`: `isVisual` narrowed to `sanad-tree`/`matn-diff`
  only; new `isTable` gate + Share Card button + off-screen `<ShareCard>`
  mount + `doShareCard()` handler.
- `src/lib/export/svgExport.ts`: unchanged — `svgElementToPng` already did
  everything needed; this milestone is its first real exercise beyond the
  two visualisation types.
- i18n: `artifact.share_card`, `artifact.share_card_footer` ×3 locales.
- Tests: `shareCard.test.tsx` (8 — 1200×1200 viewBox, table/caption/overflow/
  truncation rendering, the Nastaliq font-family style, the ref forward,
  the text-only fallback), `svgExport.test.ts` additions (4 — `svgElementToPng`
  itself, previously untested: sizing from the viewBox × scale, the white
  background paint, object-URL cleanup on both success and decode failure),
  `artifactToolbar.test.tsx` (new file, 5 — the fixed `isVisual` gating
  pinned directly, the full click → font-load → rasterise → download
  pipeline, and that a font-load failure never blocks the download).
- Not machine-verifiable end-to-end: real PNG rasterisation (jsdom has no
  image decoder or canvas 2d rasteriser) was checked manually by rendering
  `ShareCard` to static SVG markup and opening it in a browser — the design
  renders correctly (RTL column order, truncation, the corner accents); the
  actual `svgElementToPng` → downloaded-file path still wants a manual
  smoke test against a real agent run producing a `calculate_zakat`/
  `calculate_faraid` table artifact.
