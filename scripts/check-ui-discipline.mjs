#!/usr/bin/env node
/**
 * UI-discipline guard (SPEC-UIUX F1, docs/SPEC-UIUX.md §4).
 *
 * Two rule scopes:
 *   CHROME_DIRS   - the workspace/layout/shamela/reader "chrome" (ADR-0011's
 *                    elevation + typography charter). Unchanged from before
 *                    SPEC M10: `font-serif` (serif is document-only, §4.4),
 *                    `border-2` outside a spinner (§4.3), and the §4.1
 *                    spacing vocabulary all stay scoped here on purpose — a
 *                    marketing page's highlighted pricing card or a dropzone's
 *                    dashed `border-2` is a legitimate emphasis border, not an
 *                    elevation violation, and widening these three rules to
 *                    `src/pages` (tried during M10 Phase 0) immediately
 *                    proved that: PricingInfo.tsx, OCR.tsx and
 *                    PendingApproval.tsx all flagged for exactly that reason.
 *   APP_WIDE_DIRS - CHROME_DIRS plus research/editor/pages. RTL correctness
 *                    and mobile-viewport correctness are not an elevation
 *                    concern scoped to the workspace shell — SPEC M10 Phase 0
 *                    widens exactly these two new HARD rules (and the new
 *                    fixed-width SOFT rule) to the whole app:
 *                     * a physical-direction utility (`ml-`, `pr-`, `left-`,
 *                       `text-right`, `border-l`, …). Exempt a line by
 *                       trailing it with `/* physical: <why> *\/` (the
 *                       Electron caption bar is the canonical reason).
 *                       Pre-existing files are grandfathered in
 *                       `LEGACY_PHYSICAL_DIRECTION` below — new files get no
 *                       such pass.
 *                     * `h-screen` / `w-screen` / `100vh` — mobile browsers
 *                       collapse the URL bar, so `100vh` clips real content;
 *                       use `dvh`/`svh`. Same grandfather pattern via
 *                       `LEGACY_VIEWPORT`.
 *
 * One tier of enforcement:
 *   HARD (exit 1)  - font-serif, border-2, physical-direction, viewport.
 *   SOFT (warn)    - the §4.1 spacing vocabulary, and a fixed pixel/large
 *                     width (`w-[400px]`, `w-64`+) with no `sm:`/`md:`/`lg:`
 *                     anywhere on the line. Warn-only: a fixed width is
 *                     sometimes deliberate (a sidebar that never reflows on
 *                     desktop-only chrome), but new drift should be visible
 *                     before Phase 3 triages it.
 *
 * Run:  node scripts/check-ui-discipline.mjs
 *       node scripts/check-ui-discipline.mjs --strict   # soft -> hard
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const CHROME_DIRS = ["src/components/workspace", "src/components/layout", "src/components/shamela", "src/components/reader"];
export const APP_WIDE_DIRS = [...CHROME_DIRS, "src/components/research", "src/components/editor", "src/pages"];

// §4.1 allowed: gap-1/1.5/2/3/4/6 and p-2/3/4/6 (plus px/py halves for tight chips).
// Flag off-vocabulary paddings (5/7/9/11+), skipping empty-state vertical centering.
const BANNED_SPACING_SAFE = /\b(?:p|px|py|pt|pb|pl|pr)-(5|7|9|1[1-9]|2[0-9])(?![.\d])/;

// A physical-direction Tailwind utility. Written as a class-token match (word
// boundaries), not a bare substring, so `border-red-500` and `timer-2` can't
// false-positive against `border-r`/`mr-`. `left-`/`right-`/`ml-`/`mr-`/
// `pl-`/`pr-` all require a value suffix (`-4`, `-[10px]`, `-1/2`, `-auto`);
// `text-left`, `text-right`, `border-l`, `border-r` are complete on their own.
const PHYSICAL_DIRECTION = new RegExp(
  [
    String.raw`\b(?:ml|mr|pl|pr)-[\w.\/\[\]%-]+`,
    String.raw`\b(?:left|right)-[\w.\/\[\]%-]+`,
    String.raw`\btext-left\b`,
    String.raw`\btext-right\b`,
    String.raw`\bborder-l\b`,
    String.raw`\bborder-r\b`,
  ].join("|"),
);
// A trailing `/* physical: ... */` on the SAME line marks a deliberate
// exception (checked against the pre-strip source, since stripComments blanks
// out the very marker this looks for).
const PHYSICAL_EXEMPT_MARKER = /\/\*\s*physical:/;

// `(?<!-)` keeps `min-h-screen`/`max-h-screen` (a different, common, and not
// what this rule is about) from matching just because `h-screen` appears as
// a substring of them.
const VIEWPORT_UNIT = /(?<!-)\bh-screen\b|(?<!-)\bw-screen\b|100vh\b/;

// A handful of literal pixel widths and the large end of Tailwind's width
// scale, unguarded by any breakpoint variant on the same line.
const FIXED_WIDTH = /\bw-(?:\[\d+px\]|64|72|80|96)\b/;
const HAS_BREAKPOINT = /\b(?:sm|md|lg):/;

/**
 * Legacy debt: every file the two new HARD rules would have failed on the day
 * they were introduced (SPEC M10 Phase 0, 2026-09-07 baseline — 47 physical-
 * direction hits / 30 files, 3 viewport hits / 2 files). New files may NEVER
 * be added to either set — that is the whole point of the ratchet. Phase 3
 * removes an entry the moment its file is fixed to use logical utilities /
 * `dvh`; a shrinking list is the visible measure of that work.
 */
const LEGACY_PHYSICAL_DIRECTION = new Set([
  "src/components/editor/EditorToolbar.tsx",
  "src/components/editor/ResourceCountCard.tsx",
  "src/components/editor/ResourceResultCard.tsx",
  "src/components/editor/ResourceSearchDialog.tsx",
  "src/components/editor/RichEditor.tsx",
  "src/components/editor/SlashCommandMenu.tsx",
  "src/components/research/ChatDisplay.tsx",
  "src/components/research/CitationPanel.tsx",
  "src/components/research/CitationResponse.tsx",
  "src/components/research/EmptyState.tsx",
  "src/components/research/ScholarlyPromptModal.tsx",
  "src/components/research/SpellingResponse.tsx",
  "src/components/research/chat/ChatAtoms.tsx",
  "src/components/research/chat/DocumentBox.tsx",
  "src/components/shamela/ReaderToolbar.tsx",
  "src/components/shamela/ShamelaConnectPanel.tsx",
  "src/components/shamela/ShamelaImportDialog.tsx",
  "src/components/shamela/ShamelaImportToWorkspaceDialog.tsx",
  "src/components/shamela/SplitReader.tsx",
  "src/components/shamela/TocTree.tsx",
  "src/components/workspace/AnnotationList.tsx",
  "src/components/workspace/BrowseTab.tsx",
  "src/components/workspace/FavoritesTab.tsx",
  "src/components/workspace/RecentBooksGrid.tsx",
  "src/components/workspace/SearchTab.tsx",
  "src/pages/FaqAiHaram.tsx",
  "src/pages/OCR.tsx",
  "src/pages/OcrReview.tsx",
  "src/pages/Transcribe.tsx",
  "src/pages/TranslationWorkspace.tsx",
]);
const LEGACY_VIEWPORT = new Set([
  "src/components/workspace/WorkspaceLayout.tsx",
  "src/pages/OcrReview.tsx",
]);

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, lead) => lead);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx$/.test(entry)) yield full;
  }
}

function relFromSrcOf(filePath) {
  const parts = filePath.split(/[\\/]/);
  const i = parts.lastIndexOf("src");
  return i === -1 ? filePath : parts.slice(i).join("/");
}

/**
 * The scan itself, shared by the CLI (below) and `src/test/uiDiscipline.test.ts`
 * — one rule set, two runners, so `npm run lint` and `npm test` cannot drift
 * apart on what counts as a violation.
 *
 * `chromeDirs` gates font-serif/border-2/spacing (ADR-0011's elevation
 * charter); `appWideDirs` gates physical-direction/viewport/fixed-width
 * (RTL and mobile-viewport correctness, which are not chrome-only concerns).
 * Passing the same list for both collapses this back to the pre-M10 shape,
 * which is exactly what the existing single-argument callers do.
 */
export function scanChromeDirs(chromeDirs = CHROME_DIRS, appWideDirs = APP_WIDE_DIRS) {
  const hard = [];
  const soft = [];
  const chromeSet = new Set(chromeDirs.map((d) => d.replace(/\\/g, "/")));

  for (const dir of appWideDirs) {
    if (!statSync(dir, { throwIfNoEntry: false })) continue;
    const isChromeDir = chromeSet.has(dir.replace(/\\/g, "/"));

    for (const file of walk(dir)) {
      const relSlashes = file.split(/[\\/]/);
      const rel = relSlashes.slice(-4).join("/");
      const relFromSrc = relFromSrcOf(file);

      const raw = readFileSync(file, "utf8");
      const origLines = raw.split("\n");
      const lines = stripComments(raw).split("\n");

      lines.forEach((line, i) => {
        if (isChromeDir) {
          if (/\bfont-serif\b/.test(line)) hard.push({ file: rel, line: i + 1, label: "font-serif in chrome", text: line.trim().slice(0, 80) });
          if (/\bborder-2\b/.test(line) && !/\banimate-spin\b/.test(line)) {
            // Exempt control indicators (checkbox/radio/switch boxes), which are small
            // fixed-size shapes that draw their body with border-2 — not elevation.
            const isControlIndicator = /\b(w-3|w-4|w-5|w-6|h-3|h-4|h-5|h-6)\b/.test(line) && /\bshrink-0\b/.test(line);
            if (!isControlIndicator) {
              hard.push({ file: rel, line: i + 1, label: "border-2 (non-spinner)", text: line.trim().slice(0, 80) });
            }
          }

          const spacing = line.match(BANNED_SPACING_SAFE);
          if (spacing) {
            // Empty-state illustration spacing (flex-col items-center justify-center with
            // large py-*) is a deliberate "calm" pattern, not chrome drift (§4.1 note).
            const isEmptyState = /\b(flex-col|justify-center)\b/.test(line) && /py-(12|16|20|24)/.test(line);
            if (!isEmptyState) soft.push({ file: rel, line: i + 1, label: `spacing '${spacing[0]}'`, text: line.trim().slice(0, 80) });
          }
        }

        if (PHYSICAL_DIRECTION.test(line) && !LEGACY_PHYSICAL_DIRECTION.has(relFromSrc)) {
          const exempt = PHYSICAL_EXEMPT_MARKER.test(origLines[i] ?? "");
          if (!exempt) {
            hard.push({ file: rel, line: i + 1, label: "physical-direction utility (use ms-/me-/start-/end-)", text: line.trim().slice(0, 80) });
          }
        }

        if (VIEWPORT_UNIT.test(line) && !LEGACY_VIEWPORT.has(relFromSrc)) {
          hard.push({ file: rel, line: i + 1, label: "h-screen/w-screen/100vh (use dvh/svh)", text: line.trim().slice(0, 80) });
        }

        const fixedWidthMatch = line.match(FIXED_WIDTH);
        if (fixedWidthMatch && !HAS_BREAKPOINT.test(line)) {
          soft.push({ file: rel, line: i + 1, label: `fixed width '${fixedWidthMatch[0]}' with no sm:/md:/lg:`, text: line.trim().slice(0, 80) });
        }
      });
    }
  }

  return { hard, soft };
}

// Only run as a CLI when invoked directly (`node scripts/check-ui-discipline.mjs`),
// not when `uiDiscipline.test.ts` imports `scanChromeDirs` above. `pathToFileURL`
// (not manual string surgery) is what makes this comparison work on Windows,
// where a bare "file://" + drive-letter path is missing the empty-authority
// slash `file:///E:/...` needs.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const STRICT = process.argv.includes("--strict");
  const { hard, soft } = scanChromeDirs();

  if (hard.length > 0) {
    for (const v of hard) console.error(`${v.file}:${v.line}  ${v.label}\n    ${v.text}`);
    console.error(`\n${hard.length} hard violation(s). See docs/SPEC-UIUX.md §4.`);
    process.exit(1);
  }

  if (soft.length > 0) {
    console.log(`check-ui-discipline: ${soft.length} soft spacing warning(s) (${STRICT ? "STRICT" : "warn"}):`);
    for (const v of soft) console.log(`  ${v.file}:${v.line}  ${v.label}  ${v.text}`);
    if (STRICT) process.exit(1);
  }

  console.log(`check-ui-discipline: clean (${hard.length} hard, ${soft.length} soft).`);
}
