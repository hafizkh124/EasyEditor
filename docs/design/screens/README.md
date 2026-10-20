# EasyEditor 2026 — screen prototypes (Phase B)

Static HTML prototypes of the redesigned screens. No build step: open `index.html` in a browser.
Use the toggles in the top bar to switch light/dark and Urdu RTL / English LTR.

- `_shared/tokens.css`: design tokens (same brand hue and elevation ladder as `src/index.css`, plus the new `success / warning / weak / info / danger` families, a strictly increasing shadow ladder and the motion scale).
- `_shared/ui.css`: the component kit (buttons, chips, cards, sheets, tabs, nav, skeleton, empty/error states). Logical CSS properties only, so RTL is safe.
- `_shared/kit.js`: prototype helper only (inline icons, bilingual text, toggles). Not shipped.
- `01`..`08`: screens, each shown on the platforms that have it (mobile 375px, desktop/web 1280px, tablet 820px).

Decisions encoded here are listed in `index.html` and in `docs/UIUX-AUDIT-2026.md` (section 2). Phase C ports the tokens into `src/index.css` / `tailwind.config.ts` and rebuilds the screens with the existing shadcn components.
