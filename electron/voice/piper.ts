import { spawn } from 'node:child_process';

export class PiperTts {
  async synthesize(text: string, voiceModelPath: string): Promise<Buffer> {
    if (!voiceModelPath) {
      throw new Error('PiperTts: voiceModelPath is required');
    }

    return new Promise((resolve, reject) => {
      const proc = spawn('piper', [
        '--model', voiceModelPath,
        '--output-raw',
      ], { windowsHide: true });

      const chunks: Buffer[] = [];
      const errorChunks: Buffer[] = [];

      proc.stdout.on('data', (d: Buffer) => chunks.push(d));
      proc.stderr.on('data', (d: Buffer) => errorChunks.push(d));

      proc.on('close', (code) => {
        if (code === 0) {
          const raw = Buffer.concat(chunks);
          // WAV header: 44 bytes. Piper --output-raw produces 16-bit PCM only,
          // so we must prepend a WAV header for the renderer to play it.
          const sampleRate = 22050;
          const bitsPerSample = 16;
          const numChannels = 1;
          const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
          const dataSize = raw.length;
          const header = Buffer.alloc(44);
          header.write('RIFF', 0);
          header.writeUInt32LE(36 + dataSize, 4);
          header.write('WAVE', 8);
          header.write('fmt ', 12);
          header.writeUInt32LE(16, 16);          // chunk size
          header.writeUInt16LE(1, 20);            // PCM
          header.writeUInt16LE(numChannels, 22);
          header.writeUInt32LE(sampleRate, 24);
          header.writeUInt32LE(byteRate, 28);
          header.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
          header.writeUInt16LE(bitsPerSample, 34);
          header.write('data', 36);
          header.writeUInt32LE(dataSize, 40);

          resolve(Buffer.concat([header, raw]));
        } else {
          const stderr = Buffer.concat(errorChunks).toString();
          reject(new Error(`Piper exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', reject);

      proc.stdin.end(text);
    });
  }
}

export async function synthesizeWithPiper(text: string, voiceModelPath: string = ''): Promise<Buffer> {
  const piper = new PiperTts();
  return piper.synthesize(text, voiceModelPath);
}
