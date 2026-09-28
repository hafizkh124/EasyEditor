// @vitest-environment node
// M13 Phase 2 (ADR-0059) — reading documents found on the machine, and
// adding a folder of them to the library.
import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { readZipEntry, docxXmlToText, extractDocumentText, assertReadableDocument, looksGarbledRtl } from '../../electron/agent/documentText';
import { listFolderDocuments, planFolderIngest, ingestFolderFiles, resolveLibraryFolder, type LibraryPort } from '../../electron/agent/folderIngest';
import { fuseRanked } from '../../electron/agent/dispatch';

const FIXTURE = path.resolve(__dirname, 'fixtures/minimal.docx');
const base = path.join(process.cwd(), 'test-results', `doctext-${process.pid}`);
fs.mkdirSync(base, { recursive: true });
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

describe('readZipEntry / docxXmlToText', () => {
  it('reads word/document.xml out of a real .docx without Word', () => {
    const xml = readZipEntry(fs.readFileSync(FIXTURE), 'word/document.xml');
    expect(xml).not.toBeNull();
    const text = docxXmlToText(xml!.toString('utf8'));
    expect(text).toMatch(/[\u0600-\u06FF]/);
    expect(text).not.toMatch(/<w:/);
  });

  it('returns null for a missing entry and throws on a non-zip', () => {
    expect(readZipEntry(fs.readFileSync(FIXTURE), 'no/such.xml')).toBeNull();
    expect(() => readZipEntry(Buffer.from('not a zip at all, just some bytes here'), 'x')).toThrow(/ZIP/);
  });

  it('handles a stored and a deflated entry the same', () => {
    // Build a minimal one-entry zip by hand: deflated "hello".
    const data = zlib.deflateRawSync(Buffer.from('hello'));
    const name = Buffer.from('a.txt');
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
    const cdOffset = local.length + name.length + data.length;
    const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(central.length + name.length, 12); eocd.writeUInt32LE(cdOffset, 16);
    const zip = Buffer.concat([local, name, data, central, name, eocd]);
    expect(readZipEntry(zip, 'a.txt')!.toString()).toBe('hello');
  });

  it('ignores drawing offsets and the mc:Fallback copy of a text box', () => {
    const xml = '<w:p><w:r><w:drawing><wp:positionH><wp:posOffset>1927860</wp:posOffset></wp:positionH></w:drawing></w:r>' +
      '<mc:AlternateContent><mc:Choice><w:p><w:r><w:t>بسم الله</w:t></w:r></w:p></mc:Choice>' +
      '<mc:Fallback><w:p><w:r><w:t>بسم الله</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent></w:p>';
    expect(docxXmlToText(xml)).toBe('بسم الله');
  });

  it('flags reordered (visual-order) Urdu PDF text as garbled', () => {
    const good = 'ایک آدمی نے سوال کیا کہ کیا نماز میں ایسا کرنا جائز ہے اور اس کے بارے میں شریعت کیا کہتی ہے براہ کرم رہنمائی فرمائیں شکریہ';
    const bad = 'ا کی آدیم ےنیت وخایت ےکاسےنماینپ ویب ی وکیت الطںیق ا کی اسھتدےد ںی ۔ ایک ابانیک دوابرہحلصوہیتکس ےہ امہر ی رشیع رامنہئ رفامںیئ ےس ےک ںیم';
    expect(looksGarbledRtl(good)).toBe(false);
    expect(looksGarbledRtl(bad)).toBe(true);
  });

  it('drops tracked deletions and field codes, keeps paragraphs and tabs', () => {
    const xml = '<w:p><w:r><w:t>one</w:t></w:r><w:r><w:tab/><w:t>two</w:t></w:r></w:p>' +
      '<w:p><w:r><w:delText>gone</w:delText></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:t xml:space="preserve">three &amp; four</w:t></w:r></w:p>';
    expect(docxXmlToText(xml)).toBe('one\ttwo\nthree & four');
  });
});

describe('extractDocumentText', () => {
  it('reads .docx via the XML path and .txt as UTF-8', async () => {
    const d = await extractDocumentText(FIXTURE);
    expect(d.method).toBe('docx-xml');
    const txt = path.join(base, 'note.txt');
    fs.writeFileSync(txt, '\uFEFFنماز کا بیان');
    expect(await extractDocumentText(txt)).toEqual({ text: 'نماز کا بیان', method: 'plain' });
  });

  it('refuses non-document types and relative paths', () => {
    expect(() => assertReadableDocument('rel.docx')).toThrow(/absolute/);
    const key = path.join(base, 'id_rsa.pem');
    fs.writeFileSync(key, 'x');
    expect(() => assertReadableDocument(key)).toThrow(/cannot read/);
  });
});

describe('fuseRanked', () => {
  it('reciprocal-rank fuses and de-duplicates', () => {
    const out = fuseRanked(['a', 'b', 'c'], ['c', 'd'], (x) => x);
    expect(out[0]).toBe('c'); // in both lists
    expect(new Set(out).size).toBe(4);
  });
});

describe('folder ingest', () => {
  const folder = path.join(base, 'books');
  fs.mkdirSync(path.join(folder, 'sub', 'node_modules'), { recursive: true });
  const long = 'باب الطهارة '.repeat(40);
  fs.writeFileSync(path.join(folder, 'a.txt'), long);
  fs.writeFileSync(path.join(folder, 'sub', 'b.md'), long);
  fs.writeFileSync(path.join(folder, 'sub', 'short.txt'), 'x');
  fs.writeFileSync(path.join(folder, 'sub', 'node_modules', 'c.txt'), long);
  fs.writeFileSync(path.join(folder, 'tool.exe'), 'MZ');
  fs.writeFileSync(path.join(folder, '~$a.docx'), 'lock');

  function fakeLib(existing: Record<string, { id: string; size?: number; mtimeMs?: number; done: boolean }> = {}) {
    const created: Array<{ title: string; source_ref: Record<string, unknown>; meta: Record<string, unknown> }> = [];
    const lib: LibraryPort & { created: typeof created; deleted: string[] } = {
      created,
      deleted: [],
      findLocalDocumentItem: vi.fn(async (p: string) => existing[p] ?? null),
      createItem: vi.fn(async (item) => { created.push(item); return { id: `lib_${created.length}` }; }),
      deleteItem: vi.fn(async (id: string) => { lib.deleted.push(id); }),
      ingestLibraryItem: vi.fn(async ({ offset = 0 }) => (offset === 0 ? { next_offset: 50, done: false, total_chunks: 70 } : { next_offset: 70, done: true, total_chunks: 70 })),
    };
    return lib;
  }

  it('lists only documents, skipping node_modules, lock files and executables', () => {
    const names = listFolderDocuments(folder).map((f) => path.relative(folder, f.path).replace(/\\/g, '/'));
    expect(names).toEqual(['a.txt', 'sub/b.md', 'sub/short.txt']);
  });

  it('skips unchanged finished files and replaces changed ones', async () => {
    const files = listFolderDocuments(folder);
    const a = files.find((f) => f.path.endsWith('a.txt'))!;
    const b = files.find((f) => f.path.endsWith('b.md'))!;
    const lib = fakeLib({
      [a.path]: { id: 'old_a', size: a.size, mtimeMs: a.mtimeMs, done: true },
      [b.path]: { id: 'old_b', size: b.size + 1, mtimeMs: b.mtimeMs, done: true },
    });
    const { todo, current } = await planFolderIngest(files, lib);
    expect(current).toBe(1);
    expect(todo.map((t) => path.basename(t.path)).sort()).toEqual(['b.md', 'short.txt']);
    expect(todo.find((t) => t.path === b.path)?.replaceId).toBe('old_b');
  });

  it('extracts, creates with pre-extracted text, embeds to completion, skips near-empty files', async () => {
    const lib = fakeLib({});
    const files = listFolderDocuments(folder);
    const res = await ingestFolderFiles(files, lib);
    expect(res.map((r) => r.status)).toEqual(['added', 'added', 'skipped']);
    expect(res[0].chunks).toBe(70);
    expect(lib.created[0].source_ref).toMatchObject({ localPath: files[0].path, origin: 'folder' });
    expect((lib.created[0].meta.ingest as { extracted_text: string }).extracted_text).toContain('باب الطهارة');
    expect(lib.ingestLibraryItem).toHaveBeenCalledTimes(4); // two batches per added file
  });

  it('stops on cancel', async () => {
    const lib = fakeLib({});
    let n = 0;
    const res = await ingestFolderFiles(listFolderDocuments(folder), lib, { isCancelled: () => n++ > 0 });
    expect(res.length).toBeLessThan(3);
  });

  it('resolveLibraryFolder rejects a relative path or a file', () => {
    expect(() => resolveLibraryFolder('books')).toThrow(/full path/);
    expect(() => resolveLibraryFolder(path.join(folder, 'a.txt'))).toThrow(/not a folder/);
  });
});
