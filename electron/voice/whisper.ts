import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { TranscriptSegment } from '@/core/voice/types';

// TODO(Gate 4): replaced by @kutalia/whisper-node-addon — SPEC-M5 FR-6.2
const WHISPER_BIN = 'whisper-cli';

export class WhisperStt {
  async transcribe(audioPath: string, lang: string, modelPath: string = ''): Promise<TranscriptSegment[]> {
    if (!modelPath) {
      throw new Error('WhisperStt: modelPath is required');
    }
    if (!fs.existsSync(audioPath)) {
      throw new Error(`WhisperStt: audio file not found at ${audioPath}`);
    }
    if (!fs.existsSync(modelPath)) {
      throw new Error(`WhisperStt: model file not found at ${modelPath}`);
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-'));
    const outPrefix = path.join(tmpDir, 'out');

    try {
      await this.runWhisper(audioPath, lang, modelPath, outPrefix);
      return this.parseOutput(outPrefix);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  private runWhisper(audioPath: string, lang: string, modelPath: string, outPrefix: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-m', modelPath,
        '-f', audioPath,
        '-l', lang,
        '-oj',
        '-of', outPrefix,
      ];
      const proc = spawn(WHISPER_BIN, args, { windowsHide: true, stdio: 'pipe' });

      let stderr = '';
      proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`whisper exited with code ${code}: ${stderr}`));
      });
      proc.on('error', reject);
    });
  }

  private parseOutput(outPrefix: string): TranscriptSegment[] {
    const jsonPath = outPrefix + '.json';
    if (!fs.existsSync(jsonPath)) {
      throw new Error(`WhisperStt: expected output at ${jsonPath}`);
    }
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const segments: TranscriptSegment[] = [];

    if (Array.isArray(raw.segments)) {
      for (const seg of raw.segments) {
        segments.push({
          start: typeof seg.start === 'number' ? seg.start : seg.start_time ?? 0,
          end: typeof seg.end === 'number' ? seg.end : seg.end_time ?? 0,
          text: seg.text.trim(),
        });
      }
    } else if (Array.isArray(raw.transcription?.segments)) {
      for (const seg of raw.transcription.segments) {
        segments.push({
          start: seg.start ?? 0,
          end: seg.end ?? 0,
          text: seg.text.trim(),
        });
      }
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
