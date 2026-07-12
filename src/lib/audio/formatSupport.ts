// Centralised media-format knowledge for the Transcribe feature.
//
// Defines which audio and video formats are accepted, provides helpers for
// detecting video files, and builds the HTML `accept` attribute string that
// ensures mobile file-pickers surface the widest possible selection.

/** Accepted extensions + MIME catch-alls for the file-input `accept` attribute. */
export const ACCEPTED_MEDIA =
  "audio/*,video/*,.mp3,.wav,.m4a,.ogg,.oga,.webm,.flac,.aac,.opus,.amr,.aiff,.aif,.wma,.mka,.mp4,.mov,.m4v,.3gp,.3gpp,.mkv,.avi,.flv,.wmv,.ts,.mts,.m2ts,.ogv";

/** 1 GB — hard file-size ceiling to prevent browser tab crashes (especially on mobile). */
export const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024;

/** 500 MB — files above this size trigger a warning toast but are still processed. */
export const WARN_FILE_SIZE_BYTES = 500 * 1024 * 1024;

const VIDEO_MIME_PREFIXES = ["video/"];
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".3gp", ".3gpp", ".mkv", ".avi", ".flv", ".wmv", ".ts", ".mts", ".m2ts", ".ogv"]);

/** Returns `true` when the file is a video container (audio will be extracted). */
export function isVideoFile(file: File): boolean {
  if (file.type && VIDEO_MIME_PREFIXES.some((p) => file.type.startsWith(p))) return true;
  const ext = getExtension(file.name);
  return VIDEO_EXTENSIONS.has(ext);
}

/** Human-readable format label for error messages (e.g. "MP4 video", "MP3 audio"). */
export function getFormatLabel(file: File): string {
  const ext = getExtension(file.name).replace(".", "").toUpperCase() || "unknown";
  return isVideoFile(file) ? `${ext} video` : `${ext} audio`;
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}
