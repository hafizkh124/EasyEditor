/**
 * Builds a small synthetic جوامع الكلم `HadithDB` on disk for JKHSSN tests —
 * enough tables to exercise the reader, the index build and all 6 axes.
 */
import fs from 'node:fs';
import path from 'node:path';

const CP1256_ENC: Record<string, number> = {
  'ء': 0xc1, 'آ': 0xc2, 'أ': 0xc3, 'ؤ': 0xc4, 'إ': 0xc5, 'ئ': 0xc6,
  'ا': 0xc7, 'ب': 0xc8, 'ت': 0xca, 'ث': 0xcb, 'ج': 0xcc, 'ح': 0xcd, 'خ': 0xce, 'د': 0xcf,
  'ذ': 0xd0, 'ر': 0xd1, 'ز': 0xd2, 'س': 0xd3, 'ش': 0xd4, 'ص': 0xd5, 'ض': 0xd6, 'ط': 0xd8,
  'ظ': 0xd9, 'ع': 0xda, 'غ': 0xdb, 'ف': 0xdd, 'ق': 0xde, 'ك': 0xdf, 'ل': 0xe1, 'م': 0xe3,
  'ن': 0xe4, 'ه': 0xe5, 'و': 0xe6, 'ي': 0xed, 'ة': 0xc9, 'ى': 0xec, 'ـ': 0xdc, '،': 0xa1,
};
export const enc = (s: string): Buffer =>
  Buffer.from([...s].map((c) => (c.charCodeAt(0) < 0x80 ? c.charCodeAt(0) : (CP1256_ENC[c] ?? 0x3f))));

function int32(dir: string, col: string, values: number[]): void {
  fs.mkdirSync(path.join(dir, col), { recursive: true });
  const buf = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => buf.writeInt32LE(v, i * 4));
  fs.writeFileSync(path.join(dir, col, 'records.bin'), buf);
}
function bool(dir: string, col: string, values: number[]): void {
  fs.mkdirSync(path.join(dir, col), { recursive: true });
  fs.writeFileSync(path.join(dir, col, 'records.bin'), Buffer.from(values));
}
function text(dir: string, col: string, rows: string[]): void {
  fs.mkdirSync(path.join(dir, col), { recursive: true });
  const chunks = rows.map(enc);
  const body = Buffer.concat(chunks);
  const trailer = Buffer.alloc((rows.length + 1) * 8);
  let acc = 0;
  chunks.forEach((c, i) => { trailer.writeUInt32LE(acc, i * 8); acc += c.length; });
  trailer.writeUInt32LE(acc, rows.length * 8);
  fs.writeFileSync(path.join(dir, col, 'records.bin'), Buffer.concat([body, trailer]));
}
function catalog(dir: string, fields: string, query: string): void {
  fs.writeFileSync(path.join(dir, 'Catalog.xml'), `<Table><Fields>${fields}</Fields><Query>${query}</Query></Table>`);
}
const I = (n: string) => `<Field Name="${n}" Type="3" CustomType="0"/>`;
const B = (n: string) => `<Field Name="${n}" Type="11" CustomType="0"/>`;
const T = (n: string) => `<Field Name="${n}" Type="203" CustomType="0"/>`;
const C = (n: string) => `<Field Name="${n}" Type="202" CustomType="1"/>`;

/** @returns the `HadithDB` path. */
export function writeSyntheticHadithDb(root: string): string {
  const db = path.join(root, 'HadithDB');
  fs.mkdirSync(db, { recursive: true });
  fs.writeFileSync(path.join(db, 'Catalog.xml'), '<Catalog/>');
  const T2 = (name: string) => { const d = path.join(db, name); fs.mkdirSync(d, { recursive: true }); return d; };

  // narrators 11 (شعبة), 22 (مالك), 33 (teacher/student)
  const nouns = T2('Nouns');
  int32(nouns, 'ID', [11, 22, 33]);
  int32(nouns, 'DeathYearNum', [160, 179, 198]);
  int32(nouns, 'HadithsCount', [900, 700, 300]);
  text(nouns, 'MartabaIbnHajar', ['ثقة حافظ متقن', 'إمام دار الهجرة', 'ثقة']);
  text(nouns, 'DeathYear', ['160 هـ', '179 هـ', '198 هـ']);
  text(nouns, 'BirthCity', ['واسط', 'المدينة', 'البصرة']);
  bool(nouns, 'IsRawy', [1, 1, 1]);
  catalog(nouns, [I('ID'), I('DeathYearNum'), I('HadithsCount'), T('MartabaIbnHajar'), T('DeathYear'), T('BirthCity'), B('IsRawy'), C('Name')].join(''), 'SELECT * FROM Nouns');

  const forms = T2('NounsForms');
  int32(forms, 'RawyID', [11, 11, 22, 33]);
  text(forms, 'RawyTextShape', ['شعبة', 'شعبة بن الحجاج', 'مالك بن أنس', 'سفيان']);
  int32(forms, 'Frequency', [80, 12, 40, 25]);
  catalog(forms, [I('RawyID'), T('RawyTextShape'), I('Frequency'), C('RawyText')].join(''), 'SELECT * FROM NounsForms');

  const garh = T2('NounsGarh');
  int32(garh, 'ID', [1, 2, 3]);
  text(garh, 'Text', ['ثقة', 'صدوق', 'كذاب']);
  bool(garh, 'IsTaqreeb', [1, 1, 0]);
  catalog(garh, [I('ID'), T('Text'), B('IsTaqreeb')].join(''), 'SELECT * FROM NounsGarh');

  const links = T2('NounsGarhLinks');
  int32(links, 'RawyID', [11, 11, 22]);
  int32(links, 'GarhID', [1, 1, 2]);
  int32(links, 'SayID', [101, 0, 102]);
  catalog(links, [I('RawyID'), I('GarhID'), I('SayID')].join(''), 'SELECT * FROM NounsGarhLinks');

  const csay = T2('NounsScientistsSays');
  int32(csay, 'ID', [101, 102]);
  int32(csay, 'RawyID', [11, 22]);
  int32(csay, 'NScientistID', [5, 6]);
  text(csay, 'Say', ['قال أحمد شعبة ثقة', 'قال يحيى مالك إمام']);
  catalog(csay, [I('ID'), I('RawyID'), I('NScientistID'), T('Say')].join(''), 'SELECT * FROM NounsScientistsSays');

  const ts = T2('NounsShyoukhTalamize');
  int32(ts, 'RawyID', [11, 22]); // student
  int32(ts, 'ShyoukhID', [33, 11]); // teacher
  int32(ts, 'HadithsCount', [40, 90]);
  catalog(ts, [I('RawyID'), I('ShyoukhID'), I('HadithsCount')].join(''), 'SELECT * FROM NounsShyoukhTalamize');

  // isnad forest: root 1 -> 2 -> 3(leaf). nested set: 1[1,6] 2[2,5] 3[3,4]
  const tree = T2('AsanedTree');
  int32(tree, 'ID', [1, 2, 3]);
  int32(tree, 'ParentID', [0, 1, 2]);
  int32(tree, 'LeftValue', [1, 2, 3]);
  int32(tree, 'RightValue', [6, 5, 4]);
  int32(tree, 'RawyID', [33, 11, 22]);
  bool(tree, 'IsLeaf', [0, 0, 1]);
  bool(tree, 'isMarfoa', [1, 1, 1]);
  bool(tree, 'isMawkof', [0, 0, 0]);
  bool(tree, 'isMaktoa', [0, 0, 0]);
  bool(tree, 'isMarfoaHokm', [0, 0, 0]);
  catalog(tree, [I('ID'), C('Name'), I('ParentID'), I('LeftValue'), I('RightValue'), I('RawyID'), B('IsLeaf'), B('isMarfoa'), B('isMawkof'), B('isMaktoa'), B('isMarfoaHokm')].join(''), 'SELECT * FROM AsanedTree');

  const asaned = T2('Asaned');
  int32(asaned, 'ID', [3]);
  int32(asaned, 'SandTypes', [1]);
  int32(asaned, 'HadithsCount', [2]);
  catalog(asaned, [I('ID'), C('SandRwah'), I('SandTypes'), I('HadithsCount')].join(''), 'SELECT * FROM Asaned');

  const ah = T2('AsanedHadiths');
  int32(ah, 'HadithMainID', [10]);
  int32(ah, 'BookID', [1]);
  int32(ah, 'SanadID', [3]); // -> isnad_node.id 3
  int32(ah, 'SanadType', [1]);
  int32(ah, 'SanadTahdethID', [0]);
  catalog(ah, [I('HadithMainID'), I('BookID'), I('SanadID'), I('SanadType'), I('SanadTahdethID')].join(''), 'SELECT * FROM AsanedHadiths');

  const takh = T2('HTakhreeg');
  int32(takh, 'HadithMainID', [10, 20]);
  int32(takh, 'GroupID', [7, 7]);
  int32(takh, 'CompoundMatnID', [500, 500]);
  int32(takh, 'PivotID', [11, 0]);
  int32(takh, 'MatnLength', [42, 40]);
  bool(takh, 'IsStory', [0, 0]);
  int32(takh, 'BookID', [1, 2]);
  catalog(takh, [I('HadithMainID'), I('GroupID'), I('CompoundMatnID'), C('PivotRawy'), I('PivotID'), I('MatnLength'), B('IsStory'), I('BookID')].join(''), 'SELECT * FROM HTakhreeg');

  const ggm = T2('HGamhAlMatn');
  int32(ggm, 'HadithMainID', [10, 20]);
  int32(ggm, 'GroupID', [7, 7]);
  int32(ggm, 'BookID', [1, 2]);
  catalog(ggm, [I('HadithMainID'), I('GroupID'), I('BookID')].join(''), 'SELECT * FROM HGamhAlMatn');

  const js = T2('HadithJudgmentSays');
  int32(js, 'ID', [900]);
  int32(js, 'ScientistID', [5]);
  text(js, 'Say', ['هذا حديث صحيح على شرط الشيخين']);
  catalog(js, [I('ID'), I('ScientistID'), T('Say'), I('LinkID')].join(''), 'SELECT * FROM HadithJudgmentSays');

  const jh = T2('HadithJudgmentHits');
  int32(jh, 'SayID', [900]);
  int32(jh, 'HadithMainID', [10]);
  catalog(jh, [I('SayID'), I('HadithMainID')].join(''), 'SELECT * FROM HadithJudgmentHits');

  const gh = T2('HadithGhareeb');
  int32(gh, 'HadithMainID', [10]);
  catalog(gh, [I('HadithMainID')].join(''), 'SELECT * FROM HadithGhareeb');

  const ss = T2('HadithServicesState');
  int32(ss, 'HadithMainID', [10, 20]);
  int32(ss, 'Degree', [1, 0]);
  bool(ss, 'Takhreg', [1, 1]);
  bool(ss, 'Ghareeb', [1, 0]);
  bool(ss, 'Feqh', [1, 1]);
  catalog(ss, [I('HadithMainID'), I('Degree'), B('Takhreg'), B('Ghareeb'), B('Feqh')].join(''), 'SELECT * FROM HadithServicesState');

  const subj = T2('Subject');
  int32(subj, 'ID', [1, 2, 3]);
  int32(subj, 'ParentID', [0, 1, 1]);
  int32(subj, 'LeftValue', [1, 2, 4]);
  int32(subj, 'RightValue', [6, 3, 5]);
  bool(subj, 'IsLeaf', [0, 1, 1]);
  catalog(subj, [I('ID'), C('SubjectTitle'), I('ParentID'), B('IsLeaf'), I('LeftValue'), I('RightValue')].join(''), 'SELECT * FROM Subject');

  const sh = T2('SubjectHit');
  int32(sh, 'ID', [1, 2, 3]);
  int32(sh, 'SubjectID', [2, 2, 3]);
  int32(sh, 'ParagraphMainID', [10, 20, 10]);
  catalog(sh, [I('ID'), I('SubjectID'), I('ParagraphMainID')].join(''), 'SELECT * FROM SubjectHit');

  const authors = T2('Authors');
  int32(authors, 'ID', [1, 2]);
  text(authors, 'Name', ['محمد بن اسماعيل البخاري', 'مسلم بن الحجاج النيسابوري']);
  catalog(authors, [I('ID'), T('Name')].join(''), 'SELECT * FROM Authors');

  // BookTOC_Hadith — no Catalog.xml (matches the real table)
  const toc = T2('BookTOC_Hadith');
  int32(toc, 'ParagraphID', [10, 20, 99]);
  int32(toc, 'MainID', [10, 20, 0]);
  int32(toc, 'ParentID', [99, 99, 0]);
  int32(toc, 'LeftValue', [2, 4, 1]);
  int32(toc, 'RightValue', [3, 5, 6]);
  bool(toc, 'IsLeaf', [1, 1, 0]);
  bool(toc, 'IsParagraph', [1, 1, 0]);
  int32(toc, 'MosanefID', [1, 2, 1]);
  int32(toc, 'PartNum', [1, 1, 1]);
  int32(toc, 'PageNum', [5, 12, 1]);
  text(toc, 'SectionText', ['', '', 'كتاب بدء الوحي']);
  text(toc, 'TarqeemMatboa1', ['1', '52', '']);
  fs.rmSync(path.join(toc, 'Catalog.xml'), { force: true });

  return db;
}
