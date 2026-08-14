#!/usr/bin/env node
/**
 * UI-discipline guard (SPEC-UIUX F1, docs/SPEC-UIUX.md §4).
 *
 * Two tiers:
 *   HARD (exit 1)  - zero-tolerance rules that the codebase already passes:
 *                     * `font-serif` in chrome paths (serif is document-only, §4.4)
 *                     * `border-2` outside a spinner (elevation ladder, §4.3)
 *   SOFT (warn)    - spacing tokens outside the §4.1 vocabulary
 *                     (`p-1`, `p-5`, odd literals, `px-5`/`py-20`-style jumps).
 *                     Printed as warnings so existing legitimate micro-paddings
 *                     (badge chips, inline icons) don't break the build, while
 *                     new drift stays visible.
 *
 * Run:  node scripts/check-ui-discipline.mjs
 *       node scripts/check-ui-discipline.mjs --strict   # soft -> hard
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const CHROME_DIRS = ["src/components/workspace", "src/components/layout", "src/components/shamela", "src/components/reader"];

// §4.1 allowed: gap-1/1.5/2/3/4/6 and p-2/3/4/6 (plus px/py halves for tight chips).
// Flag off-vocabulary paddings (5/7/9/11+), skipping empty-state vertical centering.
const BANNED_SPACING_SAFE = /\b(?:p|px|py|pt|pb|pl|pr)-(5|7|9|1[1-9]|2[0-9])(?![.\d])/;

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

/**
 * The scan itself, shared by the CLI (below) and `src/test/uiDiscipline.test.ts`
 * — one rule set, two runners, so `npm run lint` and `npm test` cannot drift
 * apart on what counts as a violation.
 */
export function scanChromeDirs(dirs = CHROME_DIRS) {
  const hard = [];
  const soft = [];

  for (const dir of dirs) {
    if (!statSync(dir, { throwIfNoEntry: false })) continue;
    for (const file of walk(dir)) {
      const rel = file.split(/[\\/]/).slice(-4).join("/");
      const lines = stripComments(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
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