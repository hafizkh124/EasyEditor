#!/usr/bin/env node
/**
 * Export the golden citation dataset (Approve / Edit & Correct feedback) as JSONL.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/export-golden-citations.mjs [out.jsonl] [--all]
 *
 * Only rows with `consent_training = true` are exported unless `--all` is given
 * (for the scholar's own review). Reads with the service role key from the
 * environment — never run automatically, never commit the output.
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const all = args.includes('--all');
const out = args.find((a) => !a.startsWith('--')) ?? 'golden-citations.jsonl';
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const PAGE = 1000;
let offset = 0;
let written = 0;
const fd = fs.openSync(out, 'w');
for (;;) {
  const q = new URL(`${url}/rest/v1/citation_feedback`);
  q.searchParams.set('select', 'action,source_id,verify_status,original,corrected,created_at');
  q.searchParams.set('order', 'created_at.asc');
  if (!all) q.searchParams.set('consent_training', 'eq.true');
  const res = await fetch(q, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${offset}-${offset + PAGE - 1}` },
  });
  if (!res.ok) {
    console.error(`export failed: HTTP ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const rows = await res.json();
  for (const r of rows) {
    fs.writeSync(fd, `${JSON.stringify(r)}\n`);
    written += 1;
  }
  if (rows.length < PAGE) break;
  offset += PAGE;
}
fs.closeSync(fd);
console.log(`wrote ${written} row(s) to ${out}`);
