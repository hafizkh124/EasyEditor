/**
 * Offline builder for the shipped `jkhssn.sqlite` seed.
 *
 *   npm run build:jkhssn-index -- [--data "D:\JKHSSN\Data\HadithDB"] [--out resources/data/jkhssn.sqlite]
 *
 * Uses the SAME `buildJkhssnIndex` the runtime rebuild uses (ADR-0045), so the
 * seed and a user's on-machine rebuild can never diverge. Run via `tsx`.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJkhssnIndex } from '../electron/jkhssn/buildIndex.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dataPath = arg('data', 'D:\\JKHSSN\\Data\\HadithDB');
const outPath = path.resolve(ROOT, arg('out', path.join('resources', 'data', 'jkhssn.sqlite')));
const withMatnComparison = process.argv.includes('--with-matn-comparison');

console.log(`[build-jkhssn-index] data=${dataPath}`);
console.log(`[build-jkhssn-index] out =${outPath}`);
console.log(`[build-jkhssn-index] matn-comparison=${withMatnComparison}`);

let lastTable = '';
const result = await buildJkhssnIndex({
  dataPath,
  outPath,
  withMatnComparison,
  onProgress: (p) => {
    if (p.table !== lastTable) {
      lastTable = p.table;
      process.stdout.write(`\n  ${p.phase.padEnd(6)} ${p.table}`);
    }
    if (p.total) process.stdout.write(`\r  ${p.phase.padEnd(6)} ${p.table.padEnd(24)} ${p.done}/${p.total}   `);
  },
});

console.log('\n\n[build-jkhssn-index] done in', (result.elapsedMs / 1000).toFixed(1), 's');
console.log('[build-jkhssn-index] rows:', JSON.stringify(result.rowCounts, null, 2));
if (result.skipped.length) console.log('[build-jkhssn-index] SKIPPED:', result.skipped.join(', '));
