// @vitest-environment node
// electron/agent/adapters/ocr.ts (M9 Phase 7, ADR-0023). The OCR itself runs
// renderer-side (pdf.js rasterisation + the signed-in process-ocr call); this
// half turns the per-page text that comes back into one page-delimited file
// inside the project folder, and the CONSENT gate is upstream in dispatch.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatOcrText, ocrTextPathFor, saveOcrText } from '../../electron/agent/adapters/ocr';

describe('formatOcrText', () => {
  it('delimits each page and drops empty ones', () => {
    const out = formatOcrText([
      { page: 1, text: '  بسم اللہ  ' },
      { page: 2, text: '   ' },
      { page: 3, text: 'الحمد للہ رب العالمین' },
    ]);
    expect(out).toBe('──── صفحہ 1 ────\nبسم اللہ\n\n──── صفحہ 3 ────\nالحمد للہ رب العالمین');
  });
});

describe('ocrTextPathFor', () => {
  it('puts the OCR text in sources/ next to the scan name', () => {
    expect(ocrTextPathFor('sources/kitab-scan.pdf')).toBe('sources/kitab-scan.ocr.txt');
    expect(ocrTextPathFor('sources/page.01.jpg')).toBe('sources/page.01.ocr.txt');
  });
});

describe('saveOcrText', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'm9-ocr-'));
    fs.mkdirSync(path.join(root, 'sources'), { recursive: true });
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('writes the OCR text into the project and reports the page count', () => {
    const out = saveOcrText(root, 'sources/kitab-scan.pdf', [
      { page: 1, text: 'صفحہ اول کا متن' },
      { page: 2, text: '' },
      { page: 3, text: 'صفحہ سوم کا متن' },
    ]);
    expect(out.ocrPath).toBe('sources/kitab-scan.ocr.txt');
    expect(out.pageCount).toBe(2);
    const onDisk = fs.readFileSync(path.join(root, 'sources', 'kitab-scan.ocr.txt'), 'utf8');
    expect(onDisk).toContain('──── صفحہ 3 ────');
    expect(onDisk).not.toContain('صفحہ 2');
  });

  it('keeps a traversal-y scan name inside sources/ (basename-derived)', () => {
    saveOcrText(root, '../../etc/passwd.pdf', [{ page: 1, text: 'x'.repeat(20) }]);
    expect(fs.existsSync(path.join(root, 'sources', 'passwd.ocr.txt'))).toBe(true);
  });
});
