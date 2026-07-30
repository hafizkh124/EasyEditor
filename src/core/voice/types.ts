export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface VoiceModelInfo {
  id: string;
  name: string;
  engine: string;
  langs: string[];
  sizeBytes: number;
  downloaded: boolean;
  path?: string;
}

export interface TtsEngine {
  id: string;
  name: string;
  isOnline: boolean;
  langs: string[];
  synthesize(text: string, lang: string, voiceId?: string): Promise<ArrayBuffer>;
}

export interface SttEngine {
  id: string;
  name: string;
  isOnline: boolean;
  langs: string[];
  supportsTimestamps: boolean;
  transcribe(audioPath: string, lang: string): Promise<TranscriptSegment[]>;
}

export interface VoiceSynthesizeRequest {
  text: string;
  lang: string;
  engineId: string;
  voiceId?: string;
  /**
   * SPEC-M5 FR-6.6: the online engine may only be used after the user has
   * explicitly accepted that their text leaves the machine. Absent or false,
   * the main process refuses `edge-tts` outright rather than falling back —
   * silence here must never be read as permission.
   */
  onlineConsent?: boolean;
}

/**
 * SPEC-M5 FR-6.6/R22: which engine actually produced the audio, so the caller
 * can label it honestly ("online" badge) and tell the user when the online
 * engine failed and Piper stepped in. The MIME type travels with it because
 * the two engines return different formats (MP3 vs WAV).
 */
export interface VoiceSynthesizeResult {
  audio: ArrayBuffer;
  engineUsed: string;
  mimeType: string;
  fallbackFrom?: string;
  fallbackReason?: string;
}

export interface VoiceTranscribeRequest {
  audioPath: string;
  lang: string;
  engineId?: string;
}

export interface ModelDownloadProgress {
  modelId: string;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
}
