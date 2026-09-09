// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildJkhssnIndex } from '../../electron/jkhssn/buildIndex';

/** Minimal synthetic HadithDB — enough source tables to exercise the loader,
 *  the FTS build and the meta/skip handling. */
const CP1256_ENC: Record<string, number> = {
  'ا': 0xc7, 'ب': 0xc8, 'ت': 0xca, 'ث': 0xcb, 'ج': 0xcc, 'ح': 0xcd, 'خ': 0xce, 'د': 0xcf,
  'ذ': 0xd0, 'ر': 0xd1, 'ز': 0xd2, 'س': 0xd3, 'ش': 0xd4, 'ص': 0xd5, 'ض': 0xd6, 'ط': 0xd8,
  'ظ': 0xd9, 'ع': 0xda, 'غ': 0xdb, 'ف': 0xdd, 'ق': 0xde, 'ك': 0xdf, 'ل': 0xe1, 'م': 0xe3,
  'ن': 0xe4, 'ه': 0xe5, 'و': 0xe6, 'ي': 0xed, 'ة': 0xc9, 'ى': 0xec, ' ': 0x20,
};
const enc = (s: string): Buffer => Buffer.from([...s].map((c) => CP1256_ENC[c] ?? 0x3f));

function writeInt32(dir: string, col: string, values: number[]): void {
  fs.mkdirSync(path.join(dir, col), { recursive: true });
  const buf = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => buf.writeInt32LE(v, i * 4));
  fs.writeFileSync(path.join(dir, col, 'records.bin'), buf);
}
function writeBool(dir: string, col: string, values: number[]): void {
  fs.mkdirSync(path.join(dir, col), { recursive: true });
  fs.writeFileSync(path.join(dir, col, 'records.bin'), Buffer.from(values));
}
function writeText(dir: string, col: string, rows: string[]): void {
  fs.mkdirSync(path.join(dir, col), { recursive: true });
  const chunks = rows.map(enc);
  const text = Buffer.concat(chunks);
  const trailer = Buffer.alloc((rows.length + 1) * 8);
  let acc = 0;
  chunks.forEach((c, idx) => { trailer.writeUInt32LE(acc, idx * 8); acc += c.length; });
  trailer.writeUInt32LE(acc, rows.length * 8);
  fs.writeFileSync(path.join(dir, col, 'records.bin'), Buffer.concat([text, trailer]));
}
function catalog(dir: string, fieldsXml: string, query: string): void {
  fs.writeFileSync(path.join(dir, 'Catalog.xml'), `<Table><Fields>${fieldsXml}</Fields><Query>${query}</Query></Table>`);
}

let dataPath: string;
let outPath: string;

beforeAll(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jkhssn-build-'));
  dataPath = path.join(tmp, 'HadithDB');
  outPath = path.join(tmp, 'jkhssn.sqlite');

  const garh = path.join(dataPath, 'NounsGarh');
  fs.mkdirSync(garh, { recursive: true });
  writeInt32(garh, 'ID', [1, 2, 3]);
  writeText(garh, 'Text', ['ثقة', 'صدوق يهم', 'ضعيف الحديث']);
  writeBool(garh, 'IsTaqreeb', [1, 1, 0]);
  catalog(garh, '<Field Name="ID" Type="3" CustomType="0"/><Field Name="Text" Type="203" CustomType="0"/><Field Name="IsTaqreeb" Type="11" CustomType="0"/>', 'SELECT ID, Text, IsTaqreeb FROM NounsGarh');

  const nouns = path.join(dataPath, 'Nouns');
  fs.mkdirSync(nouns, { recursive: true });
  writeInt32(nouns, 'ID', [11, 22]);
  writeInt32(nouns, 'DeathYearNum', [204, 256]);
  writeText(nouns, 'MartabaIbnHajar', ['ثقة حافظ', 'صدوق يهم']); // plain-text rank, not a code
  writeBool(nouns, 'IsRawy', [1, 1]);
  catalog(
    nouns,
    '<Field Name="ID" Type="3" CustomType="0"/><Field Name="DeathYearNum" Type="3" CustomType="0"/><Field Name="MartabaIbnHajar" Type="203" CustomType="0"/><Field Name="IsRawy" Type="11" CustomType="0"/><Field Name="Name" Type="202" CustomType="1"/>',
    'SELECT ID, DeathYearNum, MartabaIbnHajar, IsRawy, Name FROM Nouns',
  );

  const authors = path.join(dataPath, 'Authors');
  fs.mkdirSync(authors, { recursive: true });
  writeInt32(authors, 'ID', [7]);
  writeText(authors, 'Name', ['محمد بن اسماعيل البخاري']);
  catalog(authors, '<Field Name="ID" Type="3" CustomType="0"/><Field Name="Name" Type="203" CustomType="0"/>', 'SELECT ID, Name FROM Authors');

  const forms = path.join(dataPath, 'NounsForms');
  fs.mkdirSync(forms, { recursive: true });
  writeInt32(forms, 'RawyID', [11, 11, 22]);
  writeText(forms, 'RawyTextShape', ['شعبة', 'شعبة بن الحجاج', 'مالك']);
  writeInt32(forms, 'Frequency', [50, 9, 30]);
  catalog(forms, '<Field Name="RawyID" Type="3" CustomType="0"/><Field Name="RawyTextShape" Type="202" CustomType="0"/><Field Name="Frequency" Type="3" CustomType="0"/><Field Name="RawyText" Type="202" CustomType="1"/>', 'SELECT * FROM NounsForms');
});

afterAll(() => {
  try { fs.rmSync(path.dirname(dataPath), { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('buildJkhssnIndex (integration, synthetic HadithDB)', () => {
  it('builds an index and records meta', async () => {
    const result = await buildJkhssnIndex({ dataPath, outPath });
    expect(result.rowCounts.jarh_verdict).toBe(3);
    expect(result.rowCounts.narrator).toBe(2);
    expect(result.rowCounts.author).toBe(1);
    expect(result.rowCounts.narrator_form).toBe(3);

    const db = new Database(outPath, { readonly: true });
    const meta = Object.fromEntries((db.prepare('SELECT key, value FROM meta').all() as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]));
    expect(Number(meta.schema_version)).toBe(1);
    expect(meta.source_path).toBe(dataPath);

    // plain-text apparatus round-trips
    expect((db.prepare("SELECT text FROM jarh_verdict WHERE id = 2").get() as { text: string }).text).toBe('صدوق يهم');
    expect((db.prepare('SELECT name FROM author WHERE jk_author_id = 7').get() as { name: string }).name).toContain('البخاري');

    // narrator.name_shape rolled up from the most frequent form
    expect((db.prepare('SELECT name_shape FROM narrator WHERE jk_rawy_id = 11').get() as { name_shape: string }).name_shape).toBe('شعبة');

    // Ibn Hajar rank is stored as the plain-text التقريب formula, not a code
    expect((db.prepare('SELECT martaba_ibn_hajar m FROM narrator WHERE jk_rawy_id = 22').get() as { m: string }).m).toBe('صدوق يهم');

    // FTS (contentless) matches, maps back to the source row
    const hit = db
      .prepare("SELECT m.kind, m.ref_id FROM jkhssn_fts f JOIN fts_map m ON m.fts_rowid = f.rowid WHERE f.text MATCH 'ضعيف'")
      .get() as { kind: string; ref_id: number } | undefined;
    expect(hit).toEqual({ kind: 'verdict', ref_id: 3 });

    db.close();
  });

  it('skips a table whose source is absent without failing the build', async () => {
    const result = await buildJkhssnIndex({ dataPath, outPath });
    expect(result.skipped).toContain('matn_comparison');
    expect(result.skipped).toContain('isnad_node'); // no AsanedTree in the fixture
    expect(result.rowCounts.jarh_verdict).toBe(3); // real tables still loaded
  });
});
