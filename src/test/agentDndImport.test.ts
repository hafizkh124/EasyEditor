// @vitest-environment node
// electron/fs/projectFolder.ts — M9 Phase 3 asset import. A dropped file lands
// INSIDE the project folder only (media/ for audio-video, sources/ for scans /
// fonts / templates), its name is sanitised to a single @mention token, and an
// unsupported type is refused. listAssets / resolveAsset keep the same jail as
// chapters.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importDroppedFile, listAssets, resolveAsset } from '../../electron/fs/projectFolder';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'm9-assets-'));
  fs.mkdirSync(path.join(root, 'sources'), { recursive: true });
  fs.mkdirSync(path.join(root, 'media'), { recursive: true });
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const bytes = (s: string) => new Uint8Array(Buffer.from(s));

describe('importDroppedFile', () => {
  it('puts a recording under media/ and returns kind media', () => {
    const a = importDroppedFile(root, 'lecture 01.MP3', bytes('audio'));
    expect(a.name).toBe('media/lecture_01.MP3');
    expect(a.kind).toBe('media');
    expect(fs.readFileSync(path.join(root, a.name), 'utf8')).toBe('audio');
  });

  it('puts a scan / PDF / font / template under sources/', () => {
    expect(importDroppedFile(root, 'page-3.jpg', bytes('x')).name).toBe('sources/page-3.jpg');
    expect(importDroppedFile(root, 'manuscript.pdf', bytes('x')).name).toBe('sources/manuscript.pdf');
    expect(importDroppedFile(root, 'Nastaliq.ttf', bytes('x')).kind).toBe('asset');
    expect(importDroppedFile(root, 'thesis.dotx', bytes('x')).name).toBe('sources/thesis.dotx');
  });

  it('strips any path from the dropped name — nothing escapes the folder', () => {
    const a = importDroppedFile(root, '../../etc/evil.mp3', bytes('x'));
    expect(a.name).toBe('media/evil.mp3'); // path.basename drops the traversal
    expect(fs.existsSync(path.join(root, 'media', 'evil.mp3'))).toBe(true);
    // a name that is nothing but separators/spaces is refused
    expect(() => importDroppedFile(root, '   /  ', bytes('x'))).toThrow();
  });

  it('refuses an unsupported type', () => {
    expect(() => importDroppedFile(root, 'macro.exe', bytes('x'))).toThrow(/unsupported file type/);
    expect(() => importDroppedFile(root, 'notes', bytes('x'))).toThrow(/unsupported file type/);
  });
});

describe('listAssets', () => {
  it('lists everything under media/ and sources/, bucketed by kind', () => {
    importDroppedFile(root, 'a.mp3', bytes('x'));
    importDroppedFile(root, 'b.png', bytes('x'));
    fs.writeFileSync(path.join(root, 'sources', 'ignore.txt'), 'x'); // not an asset type
    const list = listAssets(root);
    expect(list.map((a) => a.kind).sort()).toEqual(['media', 'scan']);
    expect(list.every((a) => a.modifiedAt && a.size > 0)).toBe(true);
  });
});

describe('resolveAsset', () => {
  it('accepts an in-project asset path and rejects traversal / absolute / wrong-ext', () => {
    expect(resolveAsset(root, 'media/x.mp3')).toBe(path.join(root, 'media', 'x.mp3'));
    expect(() => resolveAsset(root, '../x.mp3')).toThrow(/escapes/);
    expect(() => resolveAsset(root, 'C:/x.mp3')).toThrow(/relative/);
    expect(() => resolveAsset(root, 'sources/x.docx')).toThrow(/unsupported asset type/);
  });
});
