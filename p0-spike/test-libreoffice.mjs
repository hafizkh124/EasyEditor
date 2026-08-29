// test-libreoffice.mjs — M7/M8 P0 spike, proof (3): detect a LibreOffice
// install and run a real headless conversion. This is the "Office نہ ہو
// تب بھی" fallback path (تہہ ۲، electron/adapters/libreoffice.ts).
//
// Usage:
//   node test-libreoffice.mjs <path-to-a-real-.docx-with-urdu-nastaliq-text>
//
// Pass criteria (see p0-spike/README.md §3):
//   - soffice is found without the user having to tell us where
//   - --convert-to pdf produces a non-empty PDF
//   - Urdu/Nastaliq text in the source is visibly correct in the output
//     (this last check is manual — open the PDF and look)
//
// P0 spike RESULT (2026-08-29): UNVERIFIED — the test machine had no
// LibreOffice installed, so `detect` returned false and the convert step
// never ran. M8 P4 (the real libreoffice.ts adapter) stays blocked until
// this proof runs for real on a machine that has LibreOffice.

import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const CANDIDATE_PATHS = [
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice',
  '/usr/local/bin/soffice',
];

/**
 * Returns a real, runnable soffice path, or null. The earlier version of
 * this function returned the bare string 'soffice' as an unconditional
 * last resort, so `detect` reported found:true on a machine with nothing
 * installed and then died with ENOENT at spawn time. Now the PATH lookup
 * is actually resolved before it counts as "found".
 */
function findSoffice() {
  for (const candidate of CANDIDATE_PATHS) {
    if (existsSync(candidate)) return candidate;
  }
  // PATH lookup: only counts if `soffice --version` actually launches.
  const probe = spawnSync('soffice', ['--version'], { timeout: 15_000 });
  if (!probe.error && (probe.status === 0 || String(probe.stdout || '').toLowerCase().includes('libreoffice'))) {
    return 'soffice';
  }
  return null;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit' });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  });
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('usage: node test-libreoffice.mjs <path-to.docx>');
    process.exit(2);
  }

  const soffice = findSoffice();
  if (!soffice) {
    console.log(JSON.stringify({ ok: false, step: 'detect', found: false }));
    console.error('LibreOffice not found in known install paths or PATH.');
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, step: 'detect', found: true, path: soffice }));

  const outDir = path.dirname(input);
  const t0 = Date.now();
  try {
    await run(soffice, ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir, input]);
    const ms = Date.now() - t0;
    const expectedOut = path.join(outDir, path.basename(input, path.extname(input)) + '.pdf');
    const produced = existsSync(expectedOut);
    console.log(JSON.stringify({ ok: produced, step: 'convert', ms, outputPath: expectedOut }));
    if (!produced) process.exit(1);
    console.log(`\nOpen ${expectedOut} now and confirm the Nastaliq/RTL text rendered correctly.`);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, step: 'convert', error: String(e) }));
    process.exit(1);
  }
}

main();
