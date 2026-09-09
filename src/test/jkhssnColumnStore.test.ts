// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseTableCatalog,
  tableRowCount,
  readInt32Column,
  readBoolColumn,
  readTextColumn,
  assertReadable,
  CompressedColumnError,
} from '../../electron/jkhssn/columnStore';
import { decodeCp1256 } from '../../electron/jkhssn/cp1256';

/**
 * Synthetic جوامع الكلم table, hand-built in the confirmed framing:
 *   - int32 column   : records.bin = N * 4 bytes, LE
 *   - bool column    : records.bin = N bytes
 *   - text (plain)   : records.bin = [cp1256 text][(N+1) * 8-byte trailer]
 *                      trailer entry i, first u32 = start offset of record i
 */
const CP1256_ENC: Record<string, number> = {
  'ا': 0xc7, 'ب': 0xc8, 'ت': 0xca, 'ث': 0xcb, 'ج': 0xcc, 'ح': 0xcd, 'خ': 0xce,
  'د': 0xcf, 'ذ': 0xd0, 'ر': 0xd1, 'ز': 0xd2, 'س': 0xd3, 'ش': 0xd4, 'ص': 0xd5,
  'ض': 0xd6, 'ط': 0xd8, 'ظ': 0xd9, 'ع': 0xda, 'غ': 0xdb, 'ف': 0xdd, 'ق': 0xde,
  'ك': 0xdf, 'ل': 0xe1, 'م': 0xe3, 'ن': 0xe4, 'ه': 0xe5, 'و': 0xe6, 'ي': 0xed,
  'ة': 0xc9, ' ': 0x20,
};
function encodeCp1256(s: string): Buffer {
  return Buffer.from([...s].map((ch) => CP1256_ENC[ch] ?? 0x3f));
}

const ROWS = ['ثقة', 'صدوق', 'ضعيف', 'متروك', 'مجهول الحال'];
const IDS = [10, 20, 30, 40, 50];
const BOOLS = [1, 0, 1, 1, 0];

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jkhssn-fixture-'));
  const tableDir = path.join(dir, 'MiniVerdict');
  fs.mkdirSync(path.join(tableDir, 'ID'), { recursive: true });
  fs.mkdirSync(path.join(tableDir, 'IsTaqreeb'), { recursive: true });
  fs.mkdirSync(path.join(tableDir, 'Text'), { recursive: true });

  fs.writeFileSync(
    path.join(tableDir, 'Catalog.xml'),
    `<Table Engine="1.909" Indexer="1.907"><Fields>` +
      `<Field Name="ID" Type="3" CustomType="0"/>` +
      `<Field Name="Text" Type="203" CustomType="0"/>` +
      `<Field Name="IsTaqreeb" Type="11" CustomType="0"/>` +
      `<Field Name="Nasab" Type="202" CustomType="1"/>` +
      `</Fields><Query>SELECT ID, Text, IsTaqreeb, Nasab FROM MiniVerdict</Query></Table>`,
  );

  const idBuf = Buffer.alloc(IDS.length * 4);
  IDS.forEach((v, i) => idBuf.writeInt32LE(v, i * 4));
  fs.writeFileSync(path.join(tableDir, 'ID', 'records.bin'), idBuf);

  fs.writeFileSync(path.join(tableDir, 'IsTaqreeb', 'records.bin'), Buffer.from(BOOLS));

  const chunks = ROWS.map(encodeCp1256);
  const text = Buffer.concat(chunks);
  const offsets: number[] = [];
  let acc = 0;
  for (const c of chunks) { offsets.push(acc); acc += c.length; }
  offsets.push(acc); // start[N] == textEnd
  const trailer = Buffer.alloc((ROWS.length + 1) * 8);
  offsets.forEach((o, i) => { trailer.writeUInt32LE(o, i * 8); trailer.writeUInt32LE(offsets[i + 1] ?? o, i * 8 + 4); });
  fs.writeFileSync(path.join(tableDir, 'Text', 'records.bin'), Buffer.concat([text, trailer]));
});

afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('jkhssn columnStore', () => {
  it('decodes Windows-1256 to Arabic', () => {
    expect(decodeCp1256(encodeCp1256('ثقة صدوق'))).toBe('ثقة صدوق');
  });

  it('parses the table catalog and classifies field kinds', () => {
    const cat = parseTableCatalog(path.join(dir, 'MiniVerdict'));
    expect(cat.table).toBe('MiniVerdict');
    expect(cat.originatingQuery).toContain('FROM MiniVerdict');
    expect(cat.fields.find((f) => f.name === 'ID')?.kind).toBe('int32');
    expect(cat.fields.find((f) => f.name === 'Text')?.kind).toBe('text');
    expect(cat.fields.find((f) => f.name === 'Text')?.readable).toBe(true);
    expect(cat.fields.find((f) => f.name === 'IsTaqreeb')?.kind).toBe('bool');
    expect(cat.fields.find((f) => f.name === 'Nasab')?.readable).toBe(false);
  });

  it('sizes the table from an int32 column', () => {
    const cat = parseTableCatalog(path.join(dir, 'MiniVerdict'));
    expect(tableRowCount(cat)).toBe(ROWS.length);
  });

  it('reads an int32 column', () => {
    expect(Array.from(readInt32Column(path.join(dir, 'MiniVerdict'), 'ID'))).toEqual(IDS);
  });

  it('reads a bool column', () => {
    expect(Array.from(readBoolColumn(path.join(dir, 'MiniVerdict'), 'IsTaqreeb'))).toEqual(BOOLS);
  });

  it('reads a plain text column via the trailing offset table', () => {
    expect(readTextColumn(path.join(dir, 'MiniVerdict'), 'Text', ROWS.length)).toEqual(ROWS);
  });

  it('rejects a compressed column', () => {
    const cat = parseTableCatalog(path.join(dir, 'MiniVerdict'));
    expect(() => assertReadable(cat, 'Nasab')).toThrow(CompressedColumnError);
    expect(() => assertReadable(cat, 'Text')).not.toThrow();
  });

  it('detects a malformed trailer', () => {
    expect(() => readTextColumn(path.join(dir, 'MiniVerdict'), 'Text', ROWS.length + 3)).toThrow();
  });
});
