// Audiobook export (SPEC-M5 FR-6.9): whole document → .mp3 with chapter marks,
// spoken through the FR-6.5 segmented synthesis.
//
// Everything runs in the main process. Synthesis already lives here, and a
// book-length WAV is far too large to shuttle over IPC just to encode it in the
// renderer — only progress events and the finished file path cross the boundary.

import { synthesizeLocalTts } from './localTts.js';
import { wavConcat } from './segmentedSynthesis.js';
import { wavToMp3, wavDurationMs, Mp3EncodeCancelledError } from './mp3Encoder.js';
import { buildId3Tag, type AudiobookChapter } from './id3Chapters.js';

export interface AudiobookChapterInput {
  title: string;
  text: string;
}

export interface AudiobookProgress {
  phase: 'synthesizing' | 'encoding' | 'writing';
  /** 1-based chapter index during synthesis. */
  currentChapter?: number;
  totalChapters?: number;
  chapterTitle?: string;
  /** Encoding progress in [0, 1]. */
  encodeFraction?: number;
}

export interface AudiobookExportOptions {
  chapters: AudiobookChapterInput[];
  lang: string;
  voiceId?: string;
  /** Document title, written to the MP3's own tag. */
  title?: string;
  bitrateKbps?: number;
  onProgress?: (progress: AudiobookProgress) => void;
  isCancelled?: () => boolean;
}

export interface AudiobookResult {
  mp3: Buffer;
  chapters: AudiobookChapter[];
  durationMs: number;
}

export class AudiobookCancelledError extends Error {
  constructor() {
    super('آڈیو بک ایکسپورٹ منسوخ کر دی گئی۔');
    this.name = 'AudiobookCancelledError';
  }
}

/**
 * Synthesizes every chapter, joins the audio, encodes it once, and returns the
 * MP3 with an ID3 tag carrying the chapter marks.
 *
 * Chapter boundaries are measured from the synthesized audio rather than
 * estimated from text length — the only way the marks land where the words
 * actually are.
 */
export async function exportAudiobook(options: AudiobookExportOptions): Promise<AudiobookResult> {
  const { chapters, lang, voiceId, title, bitrateKbps, onProgress, isCancelled } = options;

  const speakable = chapters.filter((c) => c.text.trim().length > 0);
  if (speakable.length === 0) {
    throw new Error('آڈیو بک کے لیے کوئی متن نہیں — دستاویز خالی ہے۔');
  }

  const wavParts: Buffer[] = [];
  const marks: AudiobookChapter[] = [];
  let elapsedMs = 0;

  for (let i = 0; i < speakable.length; i++) {
    if (isCancelled?.()) throw new AudiobookCancelledError();

    const chapter = speakable[i];
    onProgress?.({
      phase: 'synthesizing',
      currentChapter: i + 1,
      totalChapters: speakable.length,
      chapterTitle: chapter.title,
    });

    const wav = await synthesizeLocalTts(chapter.text, lang, voiceId);
    const chapterMs = wavDurationMs(wav);

    wavParts.push(wav);
    marks.push({
      title: chapter.title,
      startMs: elapsedMs,
      // End is exclusive of the next chapter's start, so a player seeking to a
      // chapter never lands one sample inside the previous one.
      endMs: elapsedMs + chapterMs,
    });
    elapsedMs += chapterMs;
  }

  if (isCancelled?.()) throw new AudiobookCancelledError();

  const joined = wavConcat(wavParts);

  onProgress?.({ phase: 'encoding', encodeFraction: 0 });
  let mp3Audio: Buffer;
  try {
    mp3Audio = wavToMp3(joined, {
      bitrateKbps,
      isCancelled,
      onProgress: (fraction) => onProgress?.({ phase: 'encoding', encodeFraction: fraction }),
    });
  } catch (err) {
    // The encoder has its own cancellation error; the caller should see one kind.
    if (err instanceof Mp3EncodeCancelledError) throw new AudiobookCancelledError();
    throw err;
  }

  const tag = buildId3Tag({
    title,
    album: title,
    chapters: marks,
  });

  return {
    mp3: Buffer.concat([tag, mp3Audio]),
    chapters: marks,
    durationMs: elapsedMs,
  };
}
