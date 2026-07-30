import { describe, it, expect, vi } from 'vitest';
import {
  wavConcat,
  segmentedSynthesize,
  type TtsSynthesizeFn,
} from '../../electron/voice/segmentedSynthesis';
import type { ScriptKind } from '../../shared/text/scriptRuns';

const HEADER_SIZE = 44;

/** Builds a minimal but valid 16-bit mono PCM WAV, as piper.ts emits. */
function makeWav(payload: string, sampleRate = 22050): Buffer {
  const raw = Buffer.from(payload);
  const header = Buffer.alloc(HEADER_SIZE);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + raw.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(raw.length, 40);
  return Buffer.concat([header, raw]);
}

describe('wavConcat', () => {
  it('joins WAVs into one WAV with corrected size fields', () => {
    const joined = wavConcat([makeWav('AAAA'), makeWav('BBBBBB')]);

    expect(joined.toString('ascii', 0, 4)).toBe('RIFF');
    expect(joined.toString('ascii', 8, 12)).toBe('WAVE');
    // Exactly one header, then both payloads.
    expect(joined.length).toBe(HEADER_SIZE + 10);
    expect(joined.subarray(HEADER_SIZE).toString()).toBe('AAAABBBBBB');
    // The two size fields must describe the joined file, not the first input.
    expect(joined.readUInt32LE(4)).toBe(36 + 10);
    expect(joined.readUInt32LE(40)).toBe(10);
  });

  it('preserves the format fields of the inputs', () => {
    const joined = wavConcat([makeWav('AA'), makeWav('BB')]);
    expect(joined.readUInt16LE(20)).toBe(1); // PCM
    expect(joined.readUInt16LE(22)).toBe(1); // mono
    expect(joined.readUInt32LE(24)).toBe(22050);
    expect(joined.readUInt16LE(34)).toBe(16); // bits per sample
  });

  it('returns a single input unchanged', () => {
    const only = makeWav('AAAA');
    expect(wavConcat([only])).toBe(only);
  });

  it('ignores zero-length buffers', () => {
    const joined = wavConcat([Buffer.alloc(0), makeWav('AAAA'), Buffer.alloc(0)]);
    expect(joined.subarray(HEADER_SIZE).toString()).toBe('AAAA');
  });

  it('returns an empty buffer for no input', () => {
    expect(wavConcat([]).length).toBe(0);
    expect(wavConcat([Buffer.alloc(0)]).length).toBe(0);
  });

  it('refuses to join WAVs whose formats disagree', () => {
    // A 16 kHz "low" Piper voice joined onto a 22.05 kHz one would otherwise
    // play at the wrong speed under the first buffer's header.
    expect(() => wavConcat([makeWav('AAAA', 22050), makeWav('BBBB', 16000)])).toThrow(
      'فارمیٹ مختلف ہیں',
    );
  });

  it('falls back to a plain concat when the inputs are not WAV', () => {
    const joined = wavConcat([Buffer.from('one'), Buffer.from('two')]);
    expect(joined.toString()).toBe('onetwo');
  });
});

describe('segmentedSynthesize', () => {
  const engineFor = (label: string): TtsSynthesizeFn =>
    vi.fn(async (text: string) => makeWav(`${label}:${text}`));

  it('routes each script run to its own engine', async () => {
    const urdu = engineFor('UR');
    const arabic = engineFor('AR');
    const engines = new Map<ScriptKind, TtsSynthesizeFn>([
      ['urdu', urdu],
      ['arabic', arabic],
      ['neutral', urdu],
      ['latin', urdu],
    ]);

    const out = await segmentedSynthesize('یہ ہے «إنما الأعمال» بس۔', engines);
    const payload = out.subarray(HEADER_SIZE).toString();

    expect(payload).toContain('AR:');
    expect(payload).toContain('UR:');
    expect(arabic).toHaveBeenCalledTimes(1);
    expect((arabic as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('إنما الأعمال');
  });

  it('passes the language matching each run to its engine', async () => {
    const seen: Array<[string, string]> = [];
    const record: TtsSynthesizeFn = async (text, lang) => {
      seen.push([text.trim(), lang]);
      return makeWav(text);
    };
    const engines = new Map<ScriptKind, TtsSynthesizeFn>([
      ['urdu', record],
      ['arabic', record],
      ['neutral', record],
      ['latin', record],
    ]);

    await segmentedSynthesize('اردو «العربية» text', engines);
    expect(seen.find(([, lang]) => lang === 'ar')).toBeDefined();
    expect(seen.find(([, lang]) => lang === 'ur-PK')).toBeDefined();
    expect(seen.find(([, lang]) => lang === 'en')).toBeDefined();
  });

  it('falls back to the neutral engine for kinds with no entry', async () => {
    const neutral = engineFor('N');
    const engines = new Map<ScriptKind, TtsSynthesizeFn>([['neutral', neutral]]);
    const out = await segmentedSynthesize('اردو text', engines);
    expect(out.length).toBeGreaterThan(HEADER_SIZE);
    expect(neutral).toHaveBeenCalled();
  });

  it('throws rather than silently dropping a run it cannot speak', async () => {
    const engines = new Map<ScriptKind, TtsSynthesizeFn>([['latin', engineFor('L')]]);
    await expect(segmentedSynthesize('یہ اردو ہے', engines)).rejects.toThrow(
      'کوئی انجن نہیں دیا گیا',
    );
  });

  it('returns an empty buffer for empty input', async () => {
    const engines = new Map<ScriptKind, TtsSynthesizeFn>([['neutral', engineFor('N')]]);
    expect((await segmentedSynthesize('', engines)).length).toBe(0);
    expect((await segmentedSynthesize('   ', engines)).length).toBe(0);
  });
});
