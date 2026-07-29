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
