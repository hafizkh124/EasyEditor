# EasyEditor UI/UX Excellence Plan

**Status:** Approved for build-phase use · **Version:** 1.0.0 · **Date:** 2026-08-11
**Owner:** Product + Engineering · **Author:** Engineering
**Stack:** React 18 + TS + Vite + Tailwind + shadcn/ui + TipTap + framer-motion
**Sister docs:** `docs/SPEC-M2.md` (three-pillar shell), `docs/SPEC-M5.9.md` (desktop gates), `docs/STRATEGY-v1.md`
**How to use this doc:** Every task lists *where to change* (file paths) and *what "done" looks like*. Re-run the sign-off checklist (§6) after each phase.

---

## 1. Goal

Make EasyEditor feel **professional** — the way a scholar expects a serious research tool to feel — without adding features or removing power. "Professional" here has a concrete meaning (measured in §6, not vibes):

1. **Consistent** — one elevation ladder, one type scale, one radius, one icon language across web, PWA and Electron.
2. **Calm** — density, spacing and hierarchy that let a long document breathe; no wall of controls.
3. **Trustworthy** — the Trust UI and citation surfaces communicate certainty with restraint.
4. **Multi-script** — Arabic/Urdu RTL and English LTR coexist without breaking layout or typography.
5. **Mobile-first** — primary device is a phone (§1 of README); the complex three-pillar shell must feel simple in one hand.

### 1.1 What we are NOT doing
- No new features, no new tabs, no rebrand.
- No CSS framework swap (keep Tailwind + shadcn/ui).
- No font replacement wholesale — we *discipline* the existing font stack, not toss it.

---

## 2. Benchmark set (who we measure ourselves against)

Keep these open side-by-side during every phase. They are our "what professional looks like" reference, in priority order:

| Tier | Product | What to steal | Where it applies |
|---|---|---|---|
| 1 | **Perplexity** | Inline citation chips + source footnotes; certainty that never shouts | Trust UI, Run Cards, Cite-shared panels |
| 1 | **Scrivener** | Writer + research-scratchpad side-by-side; editor keeps focus, sources stay near | 3-pillar workspace balance |
| 1 | **Linear** | Density, keyboard-first, empty states, restrained accent color | TopBar, panels, task flows |
| 2 | **Google Docs** | RTL font handling, selection toolbar behaviour, track-changes affordances | Editor + bubble menu |
| 2 | **Obsidian / Anytype** | Local-first polish, graph + backlinks, metadata cards that don't overwhelm | Library graph, Shamela reader, personal corpus |
| 2 | **Dorar.net** | Hadith *grading as a quiet chip* (صحیح/ضعیف) — a *status*, not a banner | ESD-2 grading labels (مصحح/موثق/ضعیف/مکذوب) |
| 3 | **Tarteel / Quran.com** | Arabic-first UI polish, recitation/reading calm | Shamela reader, reader settings |
| 3 | **Raycast** | Command palette that is actually dependable and instant | CommandPalette |
| 3 | **Readwise / Hypothesis** | Margin annotation affordances, highlight-to-note flow | Annotation sheet, margin notes |
| 4 | **Elicit / Consensus** | Research-source cards, confidence color language (emerald/amber/red) | SourceCardList, TaskRunCard |

**Rule:** when a design decision is contested inside a task, the tier-1 product in the matching row is the tiebreaker.

---

## 3. Current-state findings (audit 2026-08-11)

What the codebase already does well (keep):

- Token discipline exists: `--radius`, elevation ladder (`--background` 96% → card 100% → popover 100%), WCAG-AA-commented colors in `src/index.css:9-111`.
- Mobile font-size guard (16px inputs, `src/index.css:252-259`).
- Workbench stays mounted so streaming survives; drawers animate via transform (`WorkspaceLayout.tsx:73-84`).
- Fluid type scale exists (`tailwind.config.ts:77-85`).
- Trust UI deliberately refuses to invent confidence (`TrustTab.tsx:19`).

What makes it feel "not professional yet" — concretely:

| # | Problem | Evidence / location |
|---|---|---|
| A | **Two page styles collide** — flat `#f7f7f7` background vs card surfaces with thin borders; elevation reads inconsistently | `--background: 0 0% 96%` + `--border: 0 0% 87%` `src/index.css:11,47` |
| B | **Font soup in chrome** — Work Sans (Latin) jumps to Noto Naskh Arabic mid-word; Nastaliq used only in editor fonts, but Lora adds a third serif mood; the *sans* stack is the wobblier point | `tailwind.config.ts:117-143`, `src/index.css:84-90` |
| C | **Icon language inconsistent** — mixed stroke weights/sizes (`h-3.5`, `h-4`, `w-4`); some `text-primary`, some `text-muted-foreground`, some uncolored | e.g. `TrustTab.tsx:55,69` (`h-4` vs `h-3.5`) |
| D | **Toolbar sprawl** — export (Word/PDF/HTML/TXT) + copy + versioning + direction toggle all crowd one `h-14` bar on mobile | `WorkspaceTopBar.tsx:80-120` |
| E | **Empty states** — panels/home tabs likely show bare lists; no guided first-run (new scholar has no "here's what to do" moment) | HomeTab, Library tabs |
| F | **Density drift** — padding uses raw `p-3 space-y-3`, `px-3`, `gap-2` literals across files rather than a shared spacing vocabulary | `TrustTab.tsx:51`, `WorkspaceTopBar.tsx:81` |
| G | **Mobile three-pillar complexity** — the shell is powerful but the phone experience exposes too many concurrent affordances | drawer toggles + app menu + back + title in one bar (`WorkspaceTopBar.tsx:86-114`) |
| H | **Motion minimal** — only accordion keyframes; framer-motion is in the bundle but barely used; panels snap | `tailwind.config.ts:86-107` |

---

## 4. Design tokens & vocabulary (the discipline layer)

Define these once; enforce with ESLint rules where possible.

### 4.1 Spacing
- New utility: `space-i-3`-style? No — use established scale only: **`gap-1/1.5/2/3/4/6`, `p-2/3/4/6`**. Ban `p-1`, `p-5`, odd literals in new code.
- Panel gutter: standard **`p-3`** inside side panels, **`p-4`** for cards, **`p-6`** for main canvas chrome.

### 4.2 Icon language
- **One size per role:** icon buttons `h-8 w-8` + `h-4 w-4` glyph; inline-with-text `h-3.5 w-3.5`; headline `h-5`.
- One color rule: icons carry **`text-muted-foreground`** unless they signal state (primary/action/danger).
- All icons `lucide-react` (already standard); no emoji as UI glyphs in chrome (editor content exempt).

### 4.3 Elevation (light mode target)
| Layer | Surface | Use |
|---|---|---|
| Page | `--background` (#f7f7f7) | canvas outside panels |
| Card | `--card` (white) | cards, dialogs, dropdowns, popovers |
| Sidebar | `--sidebar-background` (98%) | library pillar — deliberately *below* card level |
| Border | `--border` (87%) | 1px separators; **no 2px borders** |
Replace heavier shadow tier if used; shadows stay at `--shadow-sm` max for contained surfaces.

### 4.4 Typography charter
| Role | Font | Sizes |
|---|---|---|
| UI / chrome (latin) | **Work Sans** | `text-xs` 11-12px, `text-sm` (default) 13-14px |
| UI / chrome (arabic script) | **Noto Naskh Arabic** (auto via stack) | same sizes as above |
| Document / editor serif | **Lora** + Naskh fallback | fluid scale |
| Nastaliq | **Noto Nastaliq Urdu** — ONLY document/reader body, never chrome | as set in `.font-nastaliq` |
| Quranic | **Amiri Quran** — only quoted scripture | reader/editor only |

Tighten `--font-sans`: move Work Sans → Noto Naskh Arabic → system (already correct order); keep. **Chrome must never use serif** (Lora is document-only, verified by rule: no `font-serif` in panel/bar components).

### 4.5 Color semantics (trust/citation language)
| Meaning | Token family |
|---|---|
| Verified / strong (مصحح) | `emerald` |
| Authenticated-but-nuanced (موثق) | `amber` |
| Weak (ضعیف) | `orange` (distinct from amber) |
| Forged / needs-review (مکذوب) | `red` / `destructive` |
| Neutral / source-plain | `muted-foreground` |

Use as quiet chips (Dorar-style), never full-width banners unless it's one of the two destructive states.

---

## 5. Phases (build order)

Each phase is self-contained, shippable, and ends with the §6 sign-off. Do NOT start F2 until F1 tokens are in.

### F1 — Discipline pass (2-4 days) · everywhere
- **Where:** `src/index.css`, `tailwind.config.ts`, shared list components in `src/components/workspace/*`.
- Apply §4 rules: collapse spacing drift, normalize icon sizes/colors, remove 2px borders, ensure elevation ladder.
- Add ESLint soft-warning rules: `react-refresh` already; add a guard banning `font-serif` in chrome paths and odd spacing via a small custom rule or codemod check (optional; ideal as `scripts/check-ui-discipline.mjs`).
- **Done =** sibling components (TopBar, panels, cards) read visually identical in hierarchy; no `p-1`/`p-5`/`gap-1` newly added; icons one size per role.

### F2 — Empty states & first-run (1-2 days) · HomeTab, Library tabs, SearchTab
- Every tab gets a **3-part empty state:** calm illustration/icon, one-line "what this is", one primary action.
- Dashboard/home gets a **2-step first-run hint** ("نیا پروجیکٹ بنائیں ⏎ ادھر شروع کریں") dismissed on use, persisted in localStorage (consistent with `APP_THEME_STORAGE_KEY` pattern in `src/lib/theme.ts`).
- **Done =** no bare empty list anywhere reachable in normal flow.

### F3 — Mobile calm (3-5 days) · WorkspaceLayout, WorkspaceTopBar
- **Where:** `WorkspaceTopBar.tsx:80-120`, `WorkspaceLayout.tsx`.
- Reduce top bar to **priority-2 rule:** primary (back/library/title) always; secondary (save status, share, export) fold into a single `More` menu on <768px. Direction toggle moves into the app menu.
- Verify drawers: single-visible affordance, no duplicate toggles; keep script (`WorkbenchPanel`) mounted.
- **Done =** on a 360px viewport the workspace shows ≤2 top-bar control clusters and no overflow.

### F4 — Motion & micro-interaction (2-3 days) · workspace shell, dialogs
- **Where:** panels, dialogs (`vaul`, Radix Dialog), sheets (`VersionHistorySheet`, `AnnotationSheet`).
- Standard 150–250ms ease-out transitions on: panel open/close, drawer slide, dialog scale, run-card confidence change (TrustTab).
- One `page-fade` on route change. Respect `prefers-reduced-motion` (set a `motion-safe:`/`motion-reduce:` guard).
- **Done =** no element snaps; all movement ≥150ms ease; reduced-motion users get instant states.

### F5 — Trust UI refinement (2-3 days) · TrustTab, TaskRunCard, SourceCardList
- **Where:** `TrustTab.tsx`, `SourceCardList.tsx`, `src/components/workspace/TaskRunCard.tsx`.
- Confidence → §4.5 color chip (emerald/amber/orange/red) instead of a bare bar; keep the "weakest link is the headline" logic (`TrustTab.tsx:35-36`).
- Source chips get print-like footnotes style (Perplexity): small, numbered-ish, grouped by source; click → opens source panel.
- **Done =** a scholar can read "how much to trust this" in under 3 seconds without hunting.

### F6 — Mobile editor feel (3-5 days) · RichEditor, bubble menu, slash commands
- **Where:** `src/components/editor/RichEditor`, selection bubble menu, mobile task sheet (`SPEC-M3` menus).
- Selection bubble: Perplexity/Google-Docs-style compact actions; ≥44px touch targets (`min-h-touch`/`min-w-touch` tokens already exist in `tailwind.config.ts:71-75`).
- Slash menu: group items (Text / Structure / AI Tasks), keyboard-navigable, ~150ms.
- **Done =** selecting a paragraph on phone shows ≤5 actions, all tappable, no editor scroll jump.

### F7 — Reader & library calm (2-4 days, desktop-friendly) · ShamelaReader, Library
- **Where:** `ShamelaReader`, `LibraryPanel` tabs, `KnowledgeGraphTab`.
- Reader typography already strong (`src/index.css:270-337`); add: page-turn gesture affordance, quiet scrollbar, theme-switch stays off reading column.
- Graph tab: Obsidian-style — entities as workable cards, suggested-merge as quiet inline chip (already "suggestions only" by design: README §personal corpus).
- **Done =** opening a 500-page Sahih book feels closer to a nice ebook reader than a file browser.

### F8 — PWA/Electron parity polish (1-2 days)
- Same token/type/motion on `--mode desktop` build; no desktop-only styling drift.
- Install/prompt splash and offline shell styled to match.
- **Done =** screenshots of web, PWA, Electron on default path are visually interchangeable.

---

## 6. Sign-off checklist (run after each phase, and at the end)

Manual pass on a phone (360px) + desktop (1440px) + Electron:

1. No layout overflow or horizontal scroll at 360px in the workspace.
2. Top bar shows ≤2 control clusters; all secondary actions reachable in ≤2 taps.
3. Chrome is one face: no serif in bars/panels/menus; icons one size per role.
4. Elevation: page < card < popover reads correctly in light & dark.
5. Empty states everywhere; first-run hint present and dismissable.
6. Trust read time ≤3 seconds; graded citations use the §4.5 chips.
7. All motion has a reduce-motion fallback.
8. RTL (ur/ar) and LTR (en) both clean in editor, reader, and top bar.
9. `npm run typecheck`, `npm run lint`, `npm run test` green.
10. Screenshot set (web light/dark, PWA, Electron, mobile) filed under `scratch/ui-signoff-*` for review.

---

## 7. Goals you can hold us to (measurable)

- Developer-facing: **no regression in `typecheck`/`lint`/`test`** across all phases.
- Density: workspace chrome vertical footprint on phone reduced (top bar clusters ≤2).
- Consistency: same component families use identical spacing tokens after F1 (spot-check list kept in `docs/UI-AUDIT-spot.md` if needed — see §8).

---

## 8. Follow-ups (log here)
- [ ] Build the `scripts/check-ui-discipline.mjs` guard (F1 optional; recommendation: include).
- [ ] After sign-off, file an ADR under `docs/adr/` capturing the elevation/type charter so future phases inherit it (pattern precedent exists).
- [ ] Revisit whether `mawsuah` / P6 additions need reader-affordance work (wait for `docs/STRATEGY-v1.md` P1 report).