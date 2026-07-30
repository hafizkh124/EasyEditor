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
  /**
   * Path to an audio file already on disk. Optional because the renderer
   * usually holds a decoded chunk in memory rather than a file — pass `audio`
   * in that case and the main process handles the temp file itself.
   */
  audioPath?: string;
  /** WAV bytes to transcribe. Takes precedence over `audioPath`. */
  audio?: ArrayBuffer;
  lang: string;
  engineId?: string;
}

/** SPEC-M5 FR-6.9 — one chapter of the document to be spoken. */
export interface AudiobookChapterInput {
  title: string;
  text: string;
}

export interface AudiobookExportRequest {
  chapters: AudiobookChapterInput[];
  lang: string;
  voiceId?: string;
  title?: string;
  bitrateKbps?: number;
}

export interface AudiobookExportProgress {
  phase: 'synthesizing' | 'encoding' | 'writing';
  currentChapter?: number;
  totalChapters?: number;
  chapterTitle?: string;
  encodeFraction?: number;
}

/**
 * The file is written in the main process, so only a path comes back — the
 * renderer never holds the finished audiobook in memory.
 */
export type AudiobookExportResult =
  | { cancelled: true }
  | {
      cancelled: false;
      filePath: string;
      durationMs: number;
      chapterCount: number;
      bytes: number;
    };

export interface ModelDownloadProgress {
  modelId: string;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
}
