import type { TtsEngine, SttEngine, TranscriptSegment } from './types';
import { isDesktop } from '@/utils/environment';

export class LocalTtsEngine implements TtsEngine {
  id: string;
  name: string;
  isOnline = false;
  langs = ['ur-PK', 'ur', 'ar', 'en'];

  constructor(id: string = 'piper', name: string = 'Piper Local TTS') {
    this.id = id;
    this.name = name;
  }

  async synthesize(text: string, lang: string, voiceId?: string): Promise<ArrayBuffer> {
    if (!isDesktop()) {
      throw new Error('Local TTS engine is only available in the desktop app.');
    }
    if (!window.electronAPI?.voice?.synthesize) {
      throw new Error('Voice IPC interface is not available.');
    }
    return window.electronAPI.voice.synthesize({
      text,
      lang,
      engineId: this.id,
      voiceId,
    });
  }
}

export class LocalSttEngine implements SttEngine {
  id: string;
  name: string;
  isOnline = false;
  langs = ['ur-PK', 'ur', 'ar', 'en'];
  supportsTimestamps = true;

  constructor(id: string = 'whisper', name: string = 'Whisper Local STT') {
    this.id = id;
    this.name = name;
  }

  async transcribe(audioPath: string, lang: string): Promise<TranscriptSegment[]> {
    if (!isDesktop()) {
      throw new Error('Local STT engine is only available in the desktop app.');
    }
    if (!window.electronAPI?.voice?.transcribe) {
      throw new Error('Voice IPC interface is not available.');
    }
    return window.electronAPI.voice.transcribe({
      audioPath,
      lang,
      engineId: this.id,
    });
  }
}
