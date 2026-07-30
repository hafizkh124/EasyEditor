import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

export class EdgeTts {
  private consentGiven: boolean;

  constructor(consentGiven: boolean = true) {
    this.consentGiven = consentGiven;
  }

  async synthesize(text: string, lang: string): Promise<Buffer> {
    if (!this.consentGiven) {
      throw new Error('User consent is required before using cloud Edge TTS services.');
    }

    if (!text.trim()) {
      throw new Error('Edge TTS کو خالی متن نہیں دیا جا سکتا۔');
    }

    const tts = new MsEdgeTTS();
    try {
      await tts.setMetadata(
        this.resolveVoice(lang),
        // MP3 rather than the Opus/WebM option: the previous `edge-tts
        // --write-media -` path also emitted MP3, so renderer playback and
        // audiobook export keep working unchanged.
        OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
      );

      const { audioStream } = tts.toStream(text);
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
        audioStream.on('end', resolve);
        audioStream.on('error', reject);
      });

      const audio = Buffer.concat(chunks);
      // SPEC-M5 FR-6.6: a failed online synthesis must surface as an error the
      // caller can fall back to Piper on — never as silently empty audio.
      if (audio.length === 0) {
        throw new Error('Edge TTS سے کوئی آڈیو نہیں ملا — مقامی Piper انجن آزمائیں۔');
      }
      return audio;
    } finally {
      tts.close();
    }
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
