import type { TtsEngine, SttEngine, TranscriptSegment, VoiceSynthesizeResult } from './types';
import { isDesktop } from '@/utils/environment';
import { hasOnlineConsent } from './registry';

export class LocalTtsEngine implements TtsEngine {
  id: string;
  name: string;
  isOnline: boolean;
  langs = ['ur-PK', 'ur', 'ar', 'en'];

  constructor(id: string = 'piper', name: string = 'Piper Local TTS') {
    this.id = id;
    this.name = name;
    this.isOnline = id === 'edge-tts';
  }

  /**
   * Full result including which engine actually ran — `edge-tts` can fall back to
   * Piper in the main process (SPEC-M5 FR-6.6), and callers need to know, both to
   * label the audio honestly and to pick the right MIME type.
   */
  async synthesizeDetailed(
    text: string,
    lang: string,
    voiceId?: string,
  ): Promise<VoiceSynthesizeResult> {
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
      onlineConsent: this.isOnline ? hasOnlineConsent() : undefined,
    });
  }

  async synthesize(text: string, lang: string, voiceId?: string): Promise<ArrayBuffer> {
    const result = await this.synthesizeDetailed(text, lang, voiceId);
    return result.audio;
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

  private assertAvailable(): void {
    if (!isDesktop()) {
      throw new Error('Local STT engine is only available in the desktop app.');
    }
    if (!window.electronAPI?.voice?.transcribe) {
      throw new Error('Voice IPC interface is not available.');
    }
  }

  async transcribe(audioPath: string, lang: string): Promise<TranscriptSegment[]> {
    this.assertAvailable();
    return window.electronAPI!.voice!.transcribe({
      audioPath,
      lang,
      engineId: this.id,
    });
  }

  /**
   * Transcribes audio the renderer holds in memory — the long-form orchestrator
   * decodes and slices in the renderer, so its chunks never touch disk here.
   * Segment times are relative to the start of this audio.
   */
  async transcribeBuffer(audio: ArrayBuffer, lang: string): Promise<TranscriptSegment[]> {
    this.assertAvailable();
    return window.electronAPI!.voice!.transcribe({
      audio,
      lang,
      engineId: this.id,
    });
  }
}
