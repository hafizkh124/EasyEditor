import { describe, it, expect } from 'vitest';
import { readWavFormat, wavToMp3, wavDurationMs } from '../../electron/voice/mp3Encoder';
import { buildId3Tag } from '../../electron/voice/id3Chapters';
import { splitChaptersFromHtml } from '@/lib/audiobook/splitChapters';

/** Builds a 16-bit PCM WAV of `samples` samples, as piper.ts emits. */
function makeWav(samples: number, sampleRate = 22050, channels = 1): Buffer {
  const pcm = Buffer.alloc(samples * channels * 2);
  for (let i = 0; i < samples * channels; i++) {
    // A quiet tone, so the encoder has something real to chew on.
    pcm.writeInt16LE(Math.round(8000 * Math.sin((i / 40) * Math.PI * 2)), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

describe('readWavFormat', () => {
  it('reads the format of a canonical WAV', () => {
    const format = readWavFormat(makeWav(1000));
    expect(format).toMatchObject({
      sampleRate: 22050,
      channels: 1,
      bitsPerSample: 16,
      dataOffset: 44,
      dataLength: 2000,
    });
  });

  it('finds the data chunk past an inserted LIST chunk', () => {
    // Writers do insert extra chunks; assuming a 44-byte header would feed
    // metadata to the encoder as audio.
    const base = makeWav(100);
    const pcm = base.subarray(44);
    const list = Buffer.alloc(8 + 10);
    list.write('LIST', 0);
    list.writeUInt32LE(10, 4);
    const data = Buffer.alloc(8);
    data.write('data', 0);
    data.writeUInt32LE(pcm.length, 4);
    const wav = Buffer.concat([base.subarray(0, 36), list, data, pcm]);
    // Fix the RIFF size for the enlarged file.
    wav.writeUInt32LE(wav.length - 8, 4);

    const format = readWavFormat(wav);
    expect(format.dataOffset).toBe(36 + list.length + 8);
    expect(format.dataLength).toBe(pcm.length);
  });

  it('trusts the file over a data chunk that claims more than it holds', () => {
    const wav = makeWav(100);
    wav.writeUInt32LE(999999, 40);
    expect(readWavFormat(wav).dataLength).toBe(wav.length - 44);
  });

  it('rejects non-WAV input and unsupported bit depths', () => {
    expect(() => readWavFormat(Buffer.from('not a wav at all'))).toThrow('WAV فائل نہیں');
    const wav24 = makeWav(100);
    wav24.writeUInt16LE(24, 34);
    expect(() => readWavFormat(wav24)).toThrow('16-bit');
  });
});

describe('wavDurationMs', () => {
  it('derives duration from the PCM length', () => {
    // 22050 samples at 22050 Hz mono is exactly one second.
    expect(wavDurationMs(makeWav(22050))).toBe(1000);
    expect(wavDurationMs(makeWav(11025))).toBe(500);
  });
});

describe('wavToMp3', () => {
  it('produces MP3 data starting with a frame sync', () => {
    const mp3 = wavToMp3(makeWav(22050));
    expect(mp3.length).toBeGreaterThan(0);
    // Every MP3 frame begins with eleven set bits.
    expect(mp3[0]).toBe(0xff);
    expect(mp3[1] & 0xe0).toBe(0xe0);
  });

  it('compresses substantially against the source WAV', () => {
    const wav = makeWav(22050 * 2);
    const mp3 = wavToMp3(wav, { bitrateKbps: 64 });
    expect(mp3.length).toBeLessThan(wav.length / 2);
  });

  it('reports progress ending at 1', () => {
    const seen: number[] = [];
    wavToMp3(makeWav(22050), { onProgress: (f) => seen.push(f) });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1]).toBe(1);
    expect(Math.min(...seen)).toBeGreaterThan(0);
  });

  it('aborts when cancelled instead of running to completion', () => {
    let calls = 0;
    expect(() =>
      wavToMp3(makeWav(22050 * 3), {
        isCancelled: () => ++calls > 2,
      }),
    ).toThrow('منسوخ');
  });

  it('refuses a WAV with no audio', () => {
    expect(() => wavToMp3(makeWav(0))).toThrow('کوئی آڈیو ڈیٹا نہیں');
  });

  it('encodes stereo by splitting the interleaved channels', () => {
    const mp3 = wavToMp3(makeWav(4096, 22050, 2));
    expect(mp3[0]).toBe(0xff);
    expect(mp3.length).toBeGreaterThan(0);
  });
});

describe('buildId3Tag (FR-6.9 chapter marks)', () => {
  const chapters = [
    { title: 'پہلا باب', startMs: 0, endMs: 5000 },
    { title: 'دوسرا باب', startMs: 5000, endMs: 12000 },
  ];

  it('writes an ID3v2.3 header whose size covers the frames', () => {
    const tag = buildId3Tag({ title: 'کتاب', chapters });
    expect(tag.toString('latin1', 0, 3)).toBe('ID3');
    expect(tag[3]).toBe(0x03); // v2.3
    expect(tag[4]).toBe(0x00);

    // The header size is a 28-bit synchsafe integer covering everything after it.
    const size = (tag[6] << 21) | (tag[7] << 14) | (tag[8] << 7) | tag[9];
    expect(size).toBe(tag.length - 10);
    // No synchsafe byte may have its high bit set.
    for (const byte of [tag[6], tag[7], tag[8], tag[9]]) {
      expect(byte & 0x80).toBe(0);
    }
  });

  it('emits one CHAP per chapter and a CTOC listing them', () => {
    const tag = buildId3Tag({ title: 'کتاب', chapters });
    const text = tag.toString('latin1');

    expect(text.split('CHAP').length - 1).toBe(2);
    expect(text).toContain('CTOC');
    // CTOC comes before the chapters it points at.
    expect(text.indexOf('CTOC')).toBeLessThan(text.indexOf('CHAP'));
    // Child element ids must match the CHAP element ids.
    expect(text).toContain('ch0');
    expect(text).toContain('ch1');
  });

  it('stores chapter times as big-endian milliseconds', () => {
    const tag = buildId3Tag({ chapters });
    const chapIndex = tag.indexOf(Buffer.from('CHAP', 'latin1'));
    // Frame header is 10 bytes, then the null-terminated element id "ch0".
    const timesAt = chapIndex + 10 + 'ch0'.length + 1;
    expect(tag.readUInt32BE(timesAt)).toBe(0);
    expect(tag.readUInt32BE(timesAt + 4)).toBe(5000);
    // Byte offsets are marked absent.
    expect(tag.readUInt32BE(timesAt + 8)).toBe(0xffffffff);
    expect(tag.readUInt32BE(timesAt + 12)).toBe(0xffffffff);
  });

  it('writes Urdu titles as UTF-16 with a BOM, which ISO-8859-1 could not carry', () => {
    const tag = buildId3Tag({ title: 'کتاب', chapters: [] });
    const tit2 = tag.indexOf(Buffer.from('TIT2', 'latin1'));
    expect(tag[tit2 + 10]).toBe(0x01); // UTF-16 encoding byte
    expect(tag[tit2 + 11]).toBe(0xff); // BOM
    expect(tag[tit2 + 12]).toBe(0xfe);
    const size = tag.readUInt32BE(tit2 + 4);
    const payload = tag.subarray(tit2 + 13, tit2 + 10 + size);
    expect(payload.toString('utf16le')).toBe('کتاب');
  });

  it('uses plain big-endian frame sizes, not synchsafe', () => {
    // A 200-char title needs a size byte above 0x7F; a synchsafe frame size here
    // would be silently misread by players.
    const tag = buildId3Tag({ title: 'ا'.repeat(200), chapters: [] });
    const tit2 = tag.indexOf(Buffer.from('TIT2', 'latin1'));
    expect(tag.readUInt32BE(tit2 + 4)).toBe(1 + 2 + 400);
  });

  it('omits chapter frames entirely when there are no chapters', () => {
    const tag = buildId3Tag({ title: 'کتاب', chapters: [] });
    expect(tag.toString('latin1')).not.toContain('CHAP');
    expect(tag.toString('latin1')).not.toContain('CTOC');
  });
});

describe('splitChaptersFromHtml (FR-6.9)', () => {
  it('opens a chapter at each heading and speaks the heading too', () => {
    const chapters = splitChaptersFromHtml(
      '<h1>پہلا باب</h1><p>پہلا متن</p><h2>دوسرا باب</h2><p>دوسرا متن</p>',
    );
    expect(chapters).toEqual([
      { title: 'پہلا باب', text: 'پہلا باب\nپہلا متن' },
      { title: 'دوسرا باب', text: 'دوسرا باب\nدوسرا متن' },
    ]);
  });

  it('keeps text before the first heading as its own chapter', () => {
    const chapters = splitChaptersFromHtml('<p>تعارف</p><h1>باب</h1><p>متن</p>');
    expect(chapters).toHaveLength(2);
    expect(chapters[0].title).toBe('آغاز');
    expect(chapters[0].text).toBe('تعارف');
  });

  it('returns a single chapter for a document with no headings', () => {
    const chapters = splitChaptersFromHtml('<p>ایک</p><p>دو</p>');
    expect(chapters).toHaveLength(1);
    expect(chapters[0].text).toBe('ایک\nدو');
  });

  it('drops empty documents rather than exporting silence', () => {
    expect(splitChaptersFromHtml('')).toEqual([]);
    expect(splitChaptersFromHtml('<p></p><p>   </p>')).toEqual([]);
  });

  it('skips a heading with no body text', () => {
    // A trailing heading with nothing under it would otherwise become a chapter
    // whose only content is its own title.
    const chapters = splitChaptersFromHtml('<h1>باب</h1>');
    expect(chapters).toEqual([{ title: 'باب', text: 'باب' }]);
  });

  it('collapses whitespace so Piper does not pause mid-sentence', () => {
    const chapters = splitChaptersFromHtml('<p>ایک\n\n   دو</p>');
    expect(chapters[0].text).toBe('ایک دو');
  });

  it('leaves out code blocks and suggestion marks', () => {
    const chapters = splitChaptersFromHtml(
      '<p>بولا جائے</p><pre>const x = 1;</pre><p class="suggestion-insert">نہ بولا جائے</p>',
    );
    expect(chapters[0].text).toBe('بولا جائے');
  });
});
