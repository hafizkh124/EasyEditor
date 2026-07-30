import fs from 'node:fs';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import type { TranscriptSegment } from '../../src/core/voice/types.js';

// @kutalia/whisper-node-addon (MIT, prebuilt for Electron — SPEC-M5 FR-6.2).
// require() rather than import: the package's own CLI entry point
// (dist/js/index.js) checks `require.main === module` at load time, which a
// static ESM import can trip in some bundling configurations. require()
// keeps loading conditional on this module actually being used.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const whisperAddon = require('@kutalia/whisper-node-addon') as {
  transcribe(options: {
    fname_inp: string;
    model: string;
    language?: string;
    use_gpu?: boolean;
    translate?: boolean;
    no_timestamps?: boolean;
    comma_in_time?: boolean;
  }): Promise<{ transcription: string[][] }>;
};

/**
 * Parses whisper.cpp's "HH:MM:SS.mmm" (or ",mmm") timestamp string into seconds.
 */
function parseTimestamp(ts: string): number {
  const match = ts.match(/(\d+):(\d+):(\d+)[.,](\d+)/);
  if (!match) return 0;
  const [, h, m, s, ms] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

export class WhisperStt {
  async transcribe(audioPath: string, lang: string, modelPath: string = ''): Promise<TranscriptSegment[]> {
    if (!modelPath) {
      throw new Error('کوئی Whisper ماڈل منتخب نہیں ہے — Settings کے ماڈل مینیجر سے ڈاؤن لوڈ کریں۔');
    }
    if (!fs.existsSync(modelPath)) {
      throw new Error(`Whisper ماڈل نہیں ملا: ${modelPath} — ماڈل مینیجر سے دوبارہ ڈاؤن لوڈ کریں۔`);
    }
    if (!fs.existsSync(audioPath)) {
      throw new Error(`آڈیو فائل نہیں ملی: ${audioPath}`);
    }

    // SPEC-M5 FR-6.10: 'auto' is whisper.cpp's own language-detection value —
    // passed straight through rather than mapped to anything else.
    const result = await whisperAddon.transcribe({
      fname_inp: audioPath,
      model: modelPath,
      language: lang,
      use_gpu: false, // conservative default: not every desktop has a Vulkan/Metal-capable GPU
      // The addon's own default is `translate: true` (translate-to-English),
      // which would silently discard the Urdu/Arabic transcript FR-6.10 asks
      // for. Must be explicit here.
      translate: false,
      no_timestamps: false,
      comma_in_time: false,
    });

    const segments: TranscriptSegment[] = [];
    for (const row of result.transcription || []) {
      const [startStr, endStr, text] = row;
      if (typeof text !== 'string' || !text.trim()) continue;
      segments.push({
        start: parseTimestamp(startStr),
        end: parseTimestamp(endStr),
        text: text.trim(),
      });
    }
    return segments;
  }
}

export async function transcribeWithWhisper(
  audioPath: string,
  lang: string,
  modelPath: string = '',
): Promise<TranscriptSegment[]> {
  const whisper = new WhisperStt();
  return whisper.transcribe(audioPath, lang, modelPath);
}
