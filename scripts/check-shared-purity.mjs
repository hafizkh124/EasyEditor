#!/usr/bin/env node
/**
 * Fails when anything in shared/ reaches for a runtime-specific global.
 *
 * shared/ is imported by BOTH the Deno edge functions and the Electron main
 * process (SPEC-M5 FR-1.5, NFR-8). A `node:` import or a `window` reference
 * there breaks one of the two at import time, and risk R2 is that the two
 * runtimes quietly grow separate copies instead.
 *
 * Comments are stripped before matching: the prose explaining this rule
 * necessarily names the very patterns it forbids, and a guard that trips on
 * its own documentation trains people to ignore it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "shared";

const FORBIDDEN = [
  { label: "Deno global", re: /\bDeno\s*\./ },
  { label: "node: import", re: /from\s*['"]node:/ },
  { label: "npm: import", re: /from\s*['"]npm:/ },
  { label: "Vite env", re: /import\s*\.\s*meta\s*\.\s*env/ },
  { label: "browser window", re: /\bwindow\s*\./ },
  { label: "Node process", re: /\bprocess\s*\./ },
];

/** Removes block and line comments so prose cannot trigger a match. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, lead) => lead);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry)) yield full;
  }
}

const violations = [];
for (const file of walk(ROOT)) {
  const lines = stripComments(readFileSync(file, "utf8")).split("\n");
  lines.forEach((line, i) => {
    for (const { label, re } of FORBIDDEN) {
      if (re.test(line)) violations.push({ file, line: i + 1, label, text: line.trim() });
    }
  });
}

if (violations.length > 0) {
  for (const v of violations) {
    console.error(`${v.file}:${v.line}  ${v.label}\n    ${v.text}`);
  }
  console.error(
    `\n${violations.length} violation(s). shared/ must stay runtime-agnostic — ` +
      `see SPEC-M5 FR-1.5 and docs/adr/0006-workspace-backend-adapter.md`,
  );
  process.exit(1);
}

console.log("shared/ is runtime-agnostic.");
