/**
 * M9 Phase 5 — `transcribe_media`'s main-process half (ADR-0021).
 *
 * The decode is NOT done here. whisper.cpp only reads 16 kHz mono WAV, and the
 * decode → silence-seam chunk → WAV pipeline already exists in the renderer
 * (`src/lib/audio/chunker.ts`, ADR-0001) and is what the Transcribe page and
 * the mic dictation both use. So this asks the renderer to run that pipeline
 * (the same bridge pattern as `search_general`) and turns the segments it gets
 * back into a timestamped transcript file inside the project folder.
 *
 * That is why M9 needs neither a bundled ffmpeg nor the Python sidecar.
 */
import path from 'node:path';
import { logger } from '../../lib/logger.js';
import { writeAssetText } from '../../fs/projectFolder.js';

const log = logger.child('agent/transcribe');

export interface TranscriptSegmentLike { start: number; end: number; text: string }

/** `H:MM:SS` — readable, and the scholar can scrub to it in the recording. */
export function stamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Segments → a timestamped plain-text transcript. */
export function formatTranscript(segments: TranscriptSegmentLike[]): string {
  return segments
    .map((s) => `[${stamp(s.start)}] ${s.text.trim()}`)
    .filter((l) => l.length > 12)
    .join('\n');
}

/** The in-project path a recording's transcript is written to. */
export function transcriptPathFor(mediaPath: string): string {
  const base = path.basename(mediaPath).replace(/\.[^.]+$/, '');
  return `sources/${base}.transcript.txt`;
}

export interface TranscribeOutcome {
  transcriptPath: string;
  segments: number;
  durationSeconds: number;
  text: string;
}

/** Write the transcript into the project folder and report where it landed. */
export function saveTranscript(
  root: string,
  mediaPath: string,
  segments: TranscriptSegmentLike[],
): TranscribeOutcome {
  const text = formatTranscript(segments);
  const rel = transcriptPathFor(mediaPath);
  writeAssetText(root, rel, text);
  const durationSeconds = segments.length ? Math.round(segments[segments.length - 1].end) : 0;
  log.info('transcript saved', { rel, segments: segments.length, durationSeconds });
  return { transcriptPath: rel, segments: segments.length, durationSeconds, text };
}
