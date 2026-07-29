import { splitScriptRuns, type ScriptKind } from '../../shared/text/scriptRuns.js';

export type TtsSynthesizeFn = (text: string, lang: string) => Promise<Buffer>;

/**
 * Concatenates multiple WAV buffers into a single valid WAV buffer.
 * If buffers are standard WAVs with 44-byte headers, updates total file size
 * and data subchunk size fields in the header.
 */
export function wavConcat(buffers: Buffer[]): Buffer {
  const nonZero = buffers.filter((b) => b.length > 0);
  if (nonZero.length === 0) return Buffer.alloc(0);
  if (nonZero.length === 1) return nonZero[0];

  const HEADER_SIZE = 44;
  const isWav = (b: Buffer) =>
    b.length >= HEADER_SIZE &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WAVE';

  if (!nonZero.every(isWav)) {
    return Buffer.concat(nonZero);
  }

  const pcmBuffers = nonZero.map((b) => b.subarray(HEADER_SIZE));
  const totalPcmLength = pcmBuffers.reduce((sum, b) => sum + b.length, 0);

  const header = Buffer.alloc(HEADER_SIZE);
  nonZero[0].copy(header, 0, 0, HEADER_SIZE);

  header.writeUInt32LE(36 + totalPcmLength, 4);
  header.writeUInt32LE(totalPcmLength, 40);

  return Buffer.concat([header, ...pcmBuffers]);
}

/**
 * Splits input text into script runs (Urdu/Arabic/Latin) and synthesizes each run
 * using the assigned engine in the `engines` map, returning concatenated audio.
 */
export async function segmentedSynthesize(
  text: string,
  engines: Map<ScriptKind, TtsSynthesizeFn>,
  defaultLang: 'urdu' | 'arabic' = 'urdu',
): Promise<Buffer> {
  const runs = splitScriptRuns(text, defaultLang);
  const audioBuffers: Buffer[] = [];

  for (const run of runs) {
    if (!run.text.trim()) continue;

    const synthFn = engines.get(run.kind) ?? engines.get('neutral');
    if (synthFn) {
      const lang = run.kind === 'arabic' ? 'ar' : run.kind === 'urdu' ? 'ur-PK' : 'en';
      const buffer = await synthFn(run.text, lang);
      audioBuffers.push(buffer);
    }
  }

  return wavConcat(audioBuffers);
}
