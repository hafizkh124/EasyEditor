#!/usr/bin/env node
/**
 * Stages electron/host/wordBridge.ps1 into resources/bin/ so electron-builder
 * packages it (build.extraResources already ships resources/bin → bin).
 *
 * SPEC-M8 Layer 1: the renderer never spawns PowerShell; the main process
 * runs this exact script as the long-lived Word host. Unlike shamela-helper
 * there is no compiled artifact to go stale — a .ps1 diff is visible in
 * review — so this only checks presence + a couple of invariants, then copies.
 *
 * Run before packaging (build:electron / build:appx / pack:electron).
 */
import { existsSync, readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'electron', 'host', 'wordBridge.ps1');
const STAGED = join(ROOT, 'resources', 'bin', 'wordBridge.ps1');

function fail(msg) {
  console.error(`[check-doc-bridge] ${msg}`);
  process.exit(1);
}

if (!existsSync(SRC)) fail(`missing: ${SRC}`);

const text = readFileSync(SRC, 'utf8');

// Strip comments (block <# #> and #-to-end-of-line) before scanning for
// banned constructs, so the security note in the header that *names* them
// does not trip the check.
const code = text
  .replace(/<#[\s\S]*?#>/g, '')
  .split('\n')
  .map((line) => line.replace(/#.*$/, ''))
  .join('\n');

// The security invariant that must never regress (SPEC-M8 §3.3): no
// script-from-string evaluation of caller input.
for (const banned of [/\bInvoke-Expression\b/i, /\biex\b/i]) {
  if (banned.test(code)) fail(`wordBridge.ps1 uses ${banned} — the host must never eval caller input as script.`);
}
// The op loop and the per-app ownership diffs must all be present (SPEC-M8
// §6 constraint 1 — Office apps do not exit when their automator dies).
if (!code.includes('switch ($cmd.op)')) fail('wordBridge.ps1 has no op switch — wrong file?');
for (const marker of ['ownedWordPid', 'ownedExcelPid', 'ownedPptPid']) {
  if (!code.includes(marker)) fail(`wordBridge.ps1 is missing ${marker} ownership tracking (SPEC-M8 §6 constraint 1).`);
}

// A syntax error anywhere in this single script is a whole-file parse failure
// that takes the entire Word/Excel/PowerPoint bridge offline at runtime, and
// nothing in the mocked test suite catches it. Refuse to package a broken host.
for (const exe of ['pwsh', 'powershell']) {
  const probe = spawnSync(exe, ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8', timeout: 20_000 });
  if (probe.status !== 0) continue;
  const lit = `'${SRC.replace(/'/g, "''")}'`;
  const r = spawnSync(exe, ['-NoProfile', '-Command',
    `$e=$null;$t=$null;[System.Management.Automation.Language.Parser]::ParseFile(${lit},[ref]$t,[ref]$e)|Out-Null;` +
    `if($e -and $e.Count -gt 0){$e|ForEach-Object{Write-Output ("{0}: {1}" -f $_.Extent.StartLineNumber,$_.Message)};exit 1};exit 0`,
  ], { encoding: 'utf8', timeout: 30_000 });
  if (r.status !== 0) fail(`wordBridge.ps1 has PowerShell syntax errors:\n${(r.stdout || '').trim()}`);
  break;
}

mkdirSync(dirname(STAGED), { recursive: true });
copyFileSync(SRC, STAGED);

console.log('[check-doc-bridge] wordBridge.ps1 checked and staged for packaging.');
