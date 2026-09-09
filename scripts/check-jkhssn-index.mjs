#!/usr/bin/env node
/**
 * Build-chain guard (ADR-0045). Verifies the shipped `jkhssn.sqlite` seed:
 *   - exists at resources/data/jkhssn.sqlite
 *   - meta.schema_version matches shared/jkhssn/constants.ts
 *   - row counts are within 5% of the recorded meta.row_counts
 *
 * A missing seed is a WARNING by default (a contributor without the جوامع الكلم
 * install can still build the app; JKHSSN then builds its index on first
 * connect). Set STRICT_JKHSSN_SEED=1 in the release pipeline to make it fatal.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = join(ROOT, 'resources', 'data', 'jkhssn.sqlite');

function fail(msg) {
  console.error(`[check-jkhssn-index] FAIL: ${msg}`);
  console.error('[check-jkhssn-index] run: npm run build:jkhssn-index');
  process.exit(1);
}

const expectedVersion = (() => {
  const src = readFileSync(join(ROOT, 'shared', 'jkhssn', 'constants.ts'), 'utf8');
  const m = src.match(/JKHSSN_INDEX_SCHEMA_VERSION\s*=\s*(\d+)/);
  return m ? Number(m[1]) : null;
})();

if (!existsSync(SEED)) {
  if (process.env.STRICT_JKHSSN_SEED) fail(`seed not found at ${SEED}`);
  console.warn(
    `[check-jkhssn-index] seed absent at ${SEED} — the app will build the JKHSSN index on first connect. ` +
      `Run "npm run build:jkhssn-index" to ship a seed.`,
  );
  process.exit(0);
}

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  console.warn('[check-jkhssn-index] better-sqlite3 not resolvable here — skipping deep check');
  process.exit(0);
}

const db = new Database(SEED, { readonly: true });
const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));

if (Number(meta.schema_version) !== expectedVersion) {
  fail(`schema_version ${meta.schema_version} != expected ${expectedVersion}`);
}

const recorded = JSON.parse(meta.row_counts || '{}');
for (const [table, expected] of Object.entries(recorded)) {
  if (!expected) continue;
  let actual;
  try {
    actual = db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
  } catch {
    fail(`table ${table} missing from the seed`);
  }
  const drift = Math.abs(actual - expected) / expected;
  if (drift > 0.05) fail(`${table}: ${actual} rows, recorded ${expected} (${(drift * 100).toFixed(1)}% drift)`);
}

console.log(
  `[check-jkhssn-index] OK — schema v${meta.schema_version}, ${Object.keys(recorded).length} tables, ` +
    `${(statSync(SEED).size / 1048576).toFixed(0)} MB, built ${meta.build_completed_at}`,
);
db.close();
