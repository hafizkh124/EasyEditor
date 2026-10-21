import type { TranscriptSegment } from "@/core/voice/types";

/**
 * Read-along timing for an audio transcript (SYSTEM-2026 §5): every
 * paragraph knows where it starts in the recording, so a tap plays from
 * there and the paragraph being spoken is highlighted.
 */

export interface TimedParagraph {
  start: number;
  end: number;
  text: string;
}

/** Sentence ends — Urdu (۔ ؟), Arabic (؟) and Latin. */
const SENTENCE_END = /(?<=[۔؟!?.])\s+/;

/**
 * Times for a transcript whose engine gave none inside a chunk (the cloud):
 * each chunk's stretch of audio is shared among its sentences by length, on
 * the assumption that speech runs at a roughly even pace. Good enough to find
 * your place; never used for subtitles.
 */
export function estimateSegments(chunkSpans: readonly TranscriptSegment[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const span of chunkSpans) {
    const sentences = span.text.split(SENTENCE_END).map((s) => s.trim()).filter(Boolean);
    const totalChars = sentences.reduce((n, s) => n + s.length, 0) || 1;
    const duration = Math.max(0, span.end - span.start);
    let at = span.start;
    for (const sentence of sentences) {
      const length = (duration * sentence.length) / totalChars;
      out.push({ start: at, end: at + length, text: sentence });
      at += length;
    }
  }
  return out;
}

/**
 * Join segments into readable paragraphs: a new one starts after a pause, or
 * once the current one is long enough, and always on a sentence end where
 * possible.
 */
export function toParagraphs(
  segments: readonly TranscriptSegment[],
  { maxChars = 450, pauseSeconds = 2 } = {},
): TimedParagraph[] {
  const out: TimedParagraph[] = [];
  let current: TimedParagraph | null = null;
  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;
    const pause = current ? seg.start - current.end : 0;
    const endsSentence = current ? /[۔؟!?.]$/.test(current.text) : false;
    if (current && (pause >= pauseSeconds || (current.text.length >= maxChars && endsSentence) || current.text.length >= maxChars * 2)) {
      out.push(current);
      current = null;
    }
    if (!current) current = { start: seg.start, end: seg.end, text };
    else {
      current.text = `${current.text} ${text}`;
      current.end = seg.end;
    }
  }
  if (current) out.push(current);
  return out;
}

/** The paragraph being spoken at `time`, or -1 before the first one. */
export function paragraphAt(paragraphs: readonly TimedParagraph[], time: number): number {
  let found = -1;
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].start <= time + 0.05) found = i;
    else break;
  }
  return found;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
