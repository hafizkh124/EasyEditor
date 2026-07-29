import { spawn } from 'node:child_process';

export class EdgeTts {
  private consentGiven: boolean;

  constructor(consentGiven: boolean = true) {
    this.consentGiven = consentGiven;
  }

  async synthesize(text: string, lang: string): Promise<Buffer> {
    if (!this.consentGiven) {
      throw new Error('User consent is required before using cloud Edge TTS services.');
    }

    const voice = this.resolveVoice(lang);
    return new Promise((resolve, reject) => {
      const proc = spawn('edge-tts', [
        '--text', text,
        '--voice', voice,
        '--write-media', '-',
      ], { windowsHide: true });

      const chunks: Buffer[] = [];
      const errorChunks: Buffer[] = [];

      proc.stdout.on('data', (d: Buffer) => chunks.push(d));
      proc.stderr.on('data', (d: Buffer) => errorChunks.push(d));

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks));
        } else {
          const stderr = Buffer.concat(errorChunks).toString();
          reject(new Error(`Edge TTS exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', reject);
    });
  }

  private resolveVoice(lang: string): string {
    const voiceMap: Record<string, string> = {
      'ur': 'ur-PK-AsadNeural',
      'ur-PK': 'ur-PK-AsadNeural',
      'ar': 'ar-SA-HamedNeural',
      'en': 'en-US-AriaNeural',
      'en-US': 'en-US-AriaNeural',
      'en-GB': 'en-GB-SoniaNeural',
    };
    return voiceMap[lang] ?? voiceMap[lang.split('-')[0]] ?? 'en-US-AriaNeural';
  }
}

export async function synthesizeWithEdgeTts(
  text: string,
  lang: string,
  consentGiven: boolean = true,
): Promise<Buffer> {
  const edgeTts = new EdgeTts(consentGiven);
  return edgeTts.synthesize(text, lang);
}
