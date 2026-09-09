/**
 * Phase 1.0 gate — confirm the جوامع الكلم (JKHSSN) column-store framing before
 * any indexer work. Throwaway/diagnostic: run once, keep for the record.
 *
 *   node scripts/probe_jkhssn_framing.mjs [D:\JKHSSN\Data\HadithDB]
 *
 * Gate: PASS requires clean Arabic from BOTH `NounsGarh.Text` (short jarh
 * verdicts) and `HadithJudgmentSays.Say` (multi-KB imam rulings).
 *
 * Result 2026-09-10: PASS. Framing is a trailing `(N+1)*8`-byte offset table;
 * text is Windows-1256; `CustomType="1"/"3"` columns are compressed. Recorded in
 * ADR-0045 and `electron/jkhssn/columnStore.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || 'D:\\JKHSSN\\Data\\HadithDB';

const CP1256_HIGH = [
  0x20ac, 0x067e, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0679, 0x2039, 0x0152, 0x0686, 0x0698, 0x0688,
  0x06af, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x06a9, 0x2122, 0x0691, 0x203a, 0x0153, 0x200c, 0x200d, 0x06ba,
  0x00a0, 0x060c, 0x00a2, 0x00a3, 0x00a4, 0x00a5, 0x00a6, 0x00a7, 0x00a8, 0x00a9, 0x06be, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x00af,
  0x00b0, 0x00b1, 0x00b2, 0x00b3, 0x00b4, 0x00b5, 0x00b6, 0x00b7, 0x00b8, 0x00b9, 0x061b, 0x00bb, 0x00bc, 0x00bd, 0x00be, 0x061f,
  0x06c1, 0x0621, 0x0622, 0x0623, 0x0624, 0x0625, 0x0626, 0x0627, 0x0628, 0x0629, 0x062a, 0x062b, 0x062c, 0x062d, 0x062e, 0x062f,
  0x0630, 0x0631, 0x0632, 0x0633, 0x0634, 0x0635, 0x0636, 0x00d7, 0x0637, 0x0638, 0x0639, 0x063a, 0x0640, 0x0641, 0x0642, 0x0643,
  0x00e0, 0x0644, 0x00e2, 0x0645, 0x0646, 0x0647, 0x0648, 0x00e7, 0x00e8, 0x00e9, 0x00ea, 0x00eb, 0x0649, 0x064a, 0x00ee, 0x00ef,
  0x064b, 0x064c, 0x064d, 0x064e, 0x00f4, 0x064f, 0x0650, 0x00f7, 0x0651, 0x00f9, 0x0652, 0x00fb, 0x00fc, 0x200e, 0x200f, 0x06d2,
];
const dec = (buf, s, e) => {
  let out = '';
  for (let i = s; i < e; i++) { const b = buf[i]; out += b < 0x80 ? String.fromCharCode(b) : String.fromCharCode(CP1256_HIGH[b - 0x80]); }
  return out;
};
const ARABIC = /[\u0600-\u06FF]/;
const arFrac = (t) => { if (!t.length) return 0; let a = 0; for (const c of t) if (ARABIC.test(c)) a++; return a / t.length; };

function fields(table) {
  const xml = fs.readFileSync(path.join(ROOT, table, 'Catalog.xml'), 'utf8');
  return [...xml.matchAll(/<Field\b[^>]*\/>/g)].map((m) => ({
    name: (m[0].match(/\bName="([^"]*)"/) || [])[1],
    type: Number((m[0].match(/\bType="([^"]*)"/) || [])[1]),
    customType: (m[0].match(/\bCustomType="([^"]*)"/) || [])[1],
  }));
}
function rowCount(table) {
  const num = fields(table).find((f) => f.type === 3);
  return fs.statSync(path.join(ROOT, table, num.name, 'records.bin')).size / 4;
}
function readText(table, col, limit) {
  const buf = fs.readFileSync(path.join(ROOT, table, col, 'records.bin'));
  const rows = rowCount(table);
  const textEnd = buf.length - (rows + 1) * 8;
  const off = (i) => buf.readUInt32LE(textEnd + i * 8);
  const tailOk = off(0) === 0 && off(rows) === textEnd;
  const out = [];
  const n = limit ? Math.min(limit, rows) : rows;
  for (let i = 0; i < n; i++) out.push(dec(buf, off(i), off(i + 1)));
  return { rows, tailOk, out, textEnd };
}

const CASES = [
  { table: 'NounsGarh', col: 'Text', gate: true },
  { table: 'HadithJudgmentSays', col: 'Say', gate: true },
  { table: 'NounsScientistsSays', col: 'Say' },
  { table: 'Authors', col: 'Name' },
  { table: 'NounsForms', col: 'RawyTextShape' },
  { table: 'Nouns', col: 'Name', expectCompressed: true },
];

console.log('JKHSSN framing probe —', ROOT, '\n');
let gatePass = true;
for (const c of CASES) {
  try {
    const r = readText(c.table, c.col, 6);
    const frac = r.out.reduce((s, x) => s + arFrac(x), 0) / r.out.length;
    const verdict = frac > 0.5 ? 'ARABIC OK' : 'NOISE';
    if (c.gate && frac <= 0.5) gatePass = false;
    console.log(`${c.table}/${c.col}  rows=${r.rows} tailOk=${r.tailOk} avgArabic=${frac.toFixed(3)}  -> ${verdict}${c.expectCompressed ? ' (compressed, as expected)' : ''}`);
    for (const s of r.out.slice(0, 3)) console.log('   ' + JSON.stringify(s.slice(0, 80)));
  } catch (e) {
    console.log(`${c.table}/${c.col}  ERROR ${e.message}`);
    if (c.gate) gatePass = false;
  }
}
console.log('\nGATE:', gatePass ? 'PASS' : 'FAIL');
process.exit(gatePass ? 0 : 1);
