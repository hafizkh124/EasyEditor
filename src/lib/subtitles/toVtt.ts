import type { TranscriptSegment } from '@/core/voice/types';

/**
 * Formats time in seconds to WebVTT timecode format: HH:MM:SS.mmm
 */
export function formatVttTime(seconds: number): string {
  const totalMs = Math.max(0, Math.floor(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mins = totalMinutes % 60;
  const hrs = Math.floor(totalMinutes / 60);

  const hh = String(hrs).padStart(2, '0');
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const mmm = String(ms).padStart(3, '0');

  return `${hh}:${mm}:${ss}.${mmm}`;
}

/**
 * Converts transcript segments into WebVTT format.
 */
export function toVtt(segments: TranscriptSegment[]): string {
  const header = 'WEBVTT\n\n';
  if (segments.length === 0) return header;

  const body = segments
    .map((seg) => {
      const startTime = formatVttTime(seg.start);
      const endTime = formatVttTime(seg.end);
      return `${startTime} --> ${endTime}\n${seg.text.trim()}`;
    })
    .join('\n\n');

  return header + body + '\n';
}
