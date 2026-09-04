// @vitest-environment node
// electron/agent/adapters/transcribe.ts (M9 Phase 5). The DECODE is not here —
// whisper.cpp only reads 16 kHz mono WAV and that pipeline (ADR-0001) is Web
// Audio, so it runs renderer-side. This half turns the segments that come back
// into a timestamped transcript inside the project folder.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stamp, formatTranscript, transcriptPathFor, saveTranscript } from '../../electron/agent/adapters/transcribe';

describe('stamp', () => {
  it('formats seconds as H:MM:SS', () => {
    expect(stamp(0)).toBe('0:00:00');
    expect(stamp(75)).toBe('0:01:15');
    expect(stamp(3725)).toBe('1:02:05');
    expect(stamp(-4)).toBe('0:00:00');
  });
});

describe('formatTranscript', () => {
  it('writes one timestamped line per segment and drops empty ones', () => {
    const out = formatTranscript([
      { start: 0, end: 4, text: '  بسم اللہ الرحمن الرحیم  ' },
      { start: 4, end: 5, text: '   ' },
      { start: 5, end: 9, text: 'آج کا موضوع علم کی فضیلت ہے' },
    ]);
    expect(out.split('\n')).toEqual([
      '[0:00:00] بسم اللہ الرحمن الرحیم',
      '[0:00:05] آج کا موضوع علم کی فضیلت ہے',
    ]);
  });
});

describe('transcriptPathFor', () => {
  it('puts the transcript in sources/ next to the recording name', () => {
    expect(transcriptPathFor('media/dars-01.mp3')).toBe('sources/dars-01.transcript.txt');
    expect(transcriptPathFor('media/lecture.final.m4a')).toBe('sources/lecture.final.transcript.txt');
  });
});

describe('saveTranscript', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'm9-transcript-'));
    fs.mkdirSync(path.join(root, 'sources'), { recursive: true });
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('writes the transcript into the project and reports where it landed', () => {
    const out = saveTranscript(root, 'media/dars-01.mp3', [
      { start: 0, end: 5, text: 'پہلا حصہ یہاں سے شروع ہوتا ہے' },
      { start: 300, end: 310, text: 'دوسرا حصہ پانچ منٹ بعد' },
    ]);
    expect(out.transcriptPath).toBe('sources/dars-01.transcript.txt');
    expect(out.segments).toBe(2);
    expect(out.durationSeconds).toBe(310);
    const onDisk = fs.readFileSync(path.join(root, 'sources', 'dars-01.transcript.txt'), 'utf8');
    expect(onDisk).toContain('[0:05:00] دوسرا حصہ');
  });

  it('refuses to write outside the project folder', () => {
    expect(() => saveTranscript(root, '../../evil.mp3', [{ start: 0, end: 1, text: 'x'.repeat(20) }]))
      .not.toThrow(); // basename-derived, so it stays in sources/
    expect(fs.existsSync(path.join(root, 'sources', 'evil.transcript.txt'))).toBe(true);
  });
});
