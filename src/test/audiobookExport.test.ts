import { describe, it, expect, vi, beforeEach } from 'vitest';

const synthesizeLocalTts = vi.fn<(text: string, lang: string, voiceId?: string) => Promise<Buffer>>();
vi.mock('../../electron/voice/localTts', () => ({
  synthesizeLocalTts: (...args: [string, string, string?]) => synthesizeLocalTts(...args),
}));

import { exportAudiobook, AudiobookCancelledError } from '../../electron/voice/audiobook';

/** A WAV of exactly `seconds` seconds at 22050 Hz mono, as piper.ts emits. */
function makeWavSeconds(seconds: number): Buffer {
  const samples = Math.round(22050 * seconds);
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(1000, i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(22050, 24);
  header.writeUInt32LE(44100, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

beforeEach(() => {
  vi.clearAllMocks();
  synthesizeLocalTts.mockResolvedValue(makeWavSeconds(1));
});

describe('exportAudiobook (SPEC-M5 FR-6.9)', () => {
  it('places chapter marks at the real audio boundaries', async () => {
    // Three chapters of different lengths — marks must follow the audio, not the
    // text length.
    synthesizeLocalTts
      .mockResolvedValueOnce(makeWavSeconds(2))
      .mockResolvedValueOnce(makeWavSeconds(3))
      .mockResolvedValueOnce(makeWavSeconds(1));

    const result = await exportAudiobook({
      chapters: [
        { title: 'ایک', text: 'پہلا' },
        { title: 'دو', text: 'دوسرا' },
        { title: 'تین', text: 'تیسرا' },
      ],
      lang: 'ur-PK',
    });

    expect(result.chapters).toEqual([
      { title: 'ایک', startMs: 0, endMs: 2000 },
      { title: 'دو', startMs: 2000, endMs: 5000 },
      { title: 'تین', startMs: 5000, endMs: 6000 },
    ]);
    expect(result.durationMs).toBe(6000);
  });

  it('leaves no gap or overlap between consecutive chapters', async () => {
    synthesizeLocalTts
      .mockResolvedValueOnce(makeWavSeconds(1.5))
      .mockResolvedValueOnce(makeWavSeconds(2.5));

    const { chapters } = await exportAudiobook({
      chapters: [
        { title: 'ایک', text: 'a' },
        { title: 'دو', text: 'b' },
      ],
      lang: 'ur-PK',
    });

    for (let i = 1; i < chapters.length; i++) {
      expect(chapters[i].startMs).toBe(chapters[i - 1].endMs);
    }
  });

  it('returns an MP3 carrying an ID3 tag with the chapters', async () => {
    const result = await exportAudiobook({
      chapters: [{ title: 'باب', text: 'متن' }],
      lang: 'ur-PK',
      title: 'میری کتاب',
    });

    expect(result.mp3.toString('latin1', 0, 3)).toBe('ID3');
    expect(result.mp3.toString('latin1')).toContain('CHAP');
    expect(result.mp3.length).toBeGreaterThan(100);
  });

  it('skips chapters with no speakable text', async () => {
    await exportAudiobook({
      chapters: [
        { title: 'ایک', text: 'متن' },
        { title: 'خالی', text: '   ' },
        { title: 'دو', text: 'مزید' },
      ],
      lang: 'ur-PK',
    });

    expect(synthesizeLocalTts).toHaveBeenCalledTimes(2);
    expect(synthesizeLocalTts.mock.calls.map((c) => c[0])).toEqual(['متن', 'مزید']);
  });

  it('refuses an empty document rather than writing a silent file', async () => {
    await expect(
      exportAudiobook({ chapters: [{ title: 'خالی', text: '  ' }], lang: 'ur-PK' }),
    ).rejects.toThrow('دستاویز خالی ہے');
    expect(synthesizeLocalTts).not.toHaveBeenCalled();
  });

  it('stops between chapters when cancelled', async () => {
    let cancelled = false;
    synthesizeLocalTts.mockImplementation(async () => {
      cancelled = true; // cancel arrives during the first chapter
      return makeWavSeconds(1);
    });

    await expect(
      exportAudiobook({
        chapters: [
          { title: 'ایک', text: 'a' },
          { title: 'دو', text: 'b' },
          { title: 'تین', text: 'c' },
        ],
        lang: 'ur-PK',
        isCancelled: () => cancelled,
      }),
    ).rejects.toThrow(AudiobookCancelledError);

    // Cancellation must take effect immediately, not after every chapter is spoken.
    expect(synthesizeLocalTts).toHaveBeenCalledTimes(1);
  });

  it('reports synthesis progress per chapter and then encoding', async () => {
    const phases: string[] = [];
    await exportAudiobook({
      chapters: [
        { title: 'ایک', text: 'a' },
        { title: 'دو', text: 'b' },
      ],
      lang: 'ur-PK',
      onProgress: (p) => phases.push(p.phase),
    });

    expect(phases.filter((p) => p === 'synthesizing')).toHaveLength(2);
    expect(phases).toContain('encoding');
    expect(phases.indexOf('encoding')).toBeGreaterThan(phases.lastIndexOf('synthesizing'));
  });

  it('passes the language and voice through to synthesis', async () => {
    await exportAudiobook({
      chapters: [{ title: 'باب', text: 'متن' }],
      lang: 'ar',
      voiceId: 'piper-ar_JO-kareem',
    });
    expect(synthesizeLocalTts).toHaveBeenCalledWith('متن', 'ar', 'piper-ar_JO-kareem');
  });
});
