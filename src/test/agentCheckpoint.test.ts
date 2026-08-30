// @vitest-environment node
// electron/agent/checkpoint.ts — task-level checkpoints (SPEC-M8 §3,
// ADR-0019 item 5). Distinct from the per-write backup: this groups ALL of
// one agent task's writes so one "Undo this task" walks them back together.
// What must hold: a chapter is snapshotted at most once (its pre-task
// state); undo restores every touched file, and DELETES a chapter that the
// task created.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { beginCheckpoint, recordEdit, undoCheckpoint, listCheckpoints } from '../../electron/agent/checkpoint';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-'));
  fs.mkdirSync(path.join(root, '.easyeditor'), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const write = (name: string, body: string) => fs.writeFileSync(path.join(root, name), body);
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8');

describe('checkpoints', () => {
  it('snapshots a chapter once at its pre-task state, then undo restores it', () => {
    write('01.docx', 'ORIGINAL');
    const cp = beginCheckpoint(root, 'add footnotes to chapter 1');

    recordEdit(root, cp, '01.docx');
    write('01.docx', 'EDITED ONCE');
    recordEdit(root, cp, '01.docx'); // second edit in the same task — must NOT re-snapshot
    write('01.docx', 'EDITED TWICE');

    const res = undoCheckpoint(root, cp);
    expect(res.restored).toEqual(['01.docx']);
    expect(read('01.docx')).toBe('ORIGINAL');
  });

  it('undo deletes a chapter the task created (no pre-task state)', () => {
    const cp = beginCheckpoint(root, 'make a new chapter');
    recordEdit(root, cp, '03-new.docx'); // file does not exist yet
    write('03-new.docx', 'FRESH');

    const res = undoCheckpoint(root, cp);
    expect(res.removed).toEqual(['03-new.docx']);
    expect(fs.existsSync(path.join(root, '03-new.docx'))).toBe(false);
  });

  it('restores several chapters touched by one task in a single undo', () => {
    write('a.docx', 'A0'); write('b.docx', 'B0');
    const cp = beginCheckpoint(root, 'harmonise terms');
    recordEdit(root, cp, 'a.docx'); write('a.docx', 'A1');
    recordEdit(root, cp, 'b.docx'); write('b.docx', 'B1');

    undoCheckpoint(root, cp);
    expect(read('a.docx')).toBe('A0');
    expect(read('b.docx')).toBe('B0');
  });

  it('listCheckpoints returns them newest first with their label and files', () => {
    write('x.docx', 'x');
    const cp1 = beginCheckpoint(root, 'first task');
    recordEdit(root, cp1, 'x.docx');
    const cp2 = beginCheckpoint(root, 'second task');

    const list = listCheckpoints(root);
    expect(list.map((c) => c.id)).toEqual([cp2, cp1]);
    expect(list[1].label).toBe('first task');
    expect(list[1].files).toEqual(['x.docx']);
  });

  it('recordEdit against an unknown checkpoint is a no-op, not a throw', () => {
    expect(() => recordEdit(root, 'cp_nope', 'x.docx')).not.toThrow();
  });

  it('undo marks the checkpoint undone', () => {
    write('x.docx', 'x');
    const cp = beginCheckpoint(root, 't');
    recordEdit(root, cp, 'x.docx');
    undoCheckpoint(root, cp);
    expect(listCheckpoints(root)[0].undoneAt).toBeTruthy();
  });
});
