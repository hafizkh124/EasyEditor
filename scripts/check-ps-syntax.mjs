#!/usr/bin/env node
/**
 * Parse-checks every `.ps1` in the repo with the real PowerShell parser.
 *
 * `electron/host/wordBridge.ps1` is a single long-lived script that drives Word,
 * Excel and PowerPoint over COM. A syntax error anywhere in it is a WHOLE-FILE
 * parse failure — PowerShell refuses to load it, so every Office op dies at
 * once, and nothing in the JS/TS test suite catches it (the host is always
 * mocked). This ran once, shipped, and took the desktop app's entire document
 * bridge offline. This gate stops that.
 *
 * Uses `pwsh` (PowerShell Core, on the CI Ubuntu image) or Windows
 * `powershell`. If neither is on PATH it SKIPS with a warning rather than
 * failing — a Mac dev without PowerShell should still be able to run
 * `npm run lint`; CI always has `pwsh`.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// `resources/bin/` is a build-time staging copy of electron/host/*.ps1
// (scripts/check-doc-bridge.mjs writes it) — not a source, so it is not scanned;
// its source under electron/ is.
const ROOTS = ["electron", "scripts", "tools", "p0-spike"];
const SKIP_DIRS = new Set(["node_modules", "dist", "release", ".git"]);

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.ps1$/i.test(entry)) yield full;
  }
}

function findPwsh() {
  for (const exe of ["pwsh", "powershell"]) {
    const probe = spawnSync(exe, ["-NoProfile", "-Command", "exit 0"], {
      encoding: "utf8",
      timeout: 20_000,
    });
    if (probe.status === 0) return exe;
  }
  return null;
}

/**
 * Parse one file. Windows PowerShell 5.1 does NOT populate `$args` from
 * trailing `-Command` arguments, so the path is baked into the script string
 * (single-quoted; `'` in a path is doubled). One spawn per file — there are
 * only a handful of `.ps1` files.
 */
function parseErrors(exe, file) {
  const lit = `'${file.replace(/'/g, "''")}'`;
  const script = `
$errors = $null
$tokens = $null
[System.Management.Automation.Language.Parser]::ParseFile(${lit}, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors -and $errors.Count -gt 0) {
  foreach ($e in $errors) { Write-Output ("{0}: {1}" -f $e.Extent.StartLineNumber, $e.Message) }
  exit 1
}
exit 0
`;
  const r = spawnSync(exe, ["-NoProfile", "-Command", script], { encoding: "utf8", timeout: 30_000 });
  return { failed: r.status !== 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

const files = ROOTS.flatMap((r) => [...walk(r)]);
if (files.length === 0) {
  console.log("check-ps-syntax: no .ps1 files found.");
  process.exit(0);
}

const pwsh = findPwsh();
if (!pwsh) {
  console.warn(
    "check-ps-syntax: no `pwsh` or `powershell` on PATH — SKIPPING. " +
      "(CI has pwsh; this is only for local dev without PowerShell.)",
  );
  process.exit(0);
}

let bad = 0;
for (const file of files) {
  const { failed, out, err } = parseErrors(pwsh, file);
  if (failed) {
    bad += 1;
    console.error(`\n${file} — PARSE ERRORS:`);
    if (out) console.error(out.split("\n").map((l) => `  ${l}`).join("\n"));
    if (err) console.error(`  ${err}`);
  }
}

if (bad > 0) {
  console.error(`\ncheck-ps-syntax: ${bad}/${files.length} .ps1 file(s) have parse errors.`);
  process.exit(1);
}

console.log(`check-ps-syntax: ${files.length} .ps1 file(s) parse clean (${pwsh}).`);
