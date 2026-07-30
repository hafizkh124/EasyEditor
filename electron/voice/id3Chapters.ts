// ID3v2.3 tag writer with CHAP/CTOC chapter frames (SPEC-M5 FR-6.9).
//
// "ابواب کے نشان" means real chapter marks, the kind a player can jump between —
// not a sidecar text file. Those are ID3v2 CHAP frames (from the ID3v2 Chapter
// Frame Addendum) plus one CTOC frame listing them in order.
//
// v2.3 rather than v2.4: it is the more widely supported of the two, and text is
// written as UTF-16 with a BOM because v2.3's other option is ISO-8859-1, which
// cannot carry an Urdu or Arabic chapter title at all.

export interface AudiobookChapter {
  title: string;
  startMs: number;
  endMs: number;
}

export interface Id3TagInfo {
  title?: string;
  album?: string;
  artist?: string;
  chapters: AudiobookChapter[];
}

/** ISO-8859-1, null-terminated — used for element IDs, which are ASCII by spec. */
function latin1Terminated(value: string): Buffer {
  return Buffer.concat([Buffer.from(value, 'latin1'), Buffer.from([0x00])]);
}

/**
 * A v2.3 text-frame payload: encoding byte 0x01 (UTF-16 with BOM), then the BOM,
 * then UTF-16LE bytes.
 */
function utf16TextPayload(text: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x01]),
    Buffer.from([0xff, 0xfe]),
    Buffer.from(text, 'utf16le'),
  ]);
}

/**
 * Wraps a payload in a v2.3 frame header.
 *
 * NOTE the size here is a plain big-endian uint32. Only the *tag* header uses
 * synchsafe integers in v2.3 — writing synchsafe frame sizes is a classic way to
 * produce a tag that some players silently ignore.
 */
function frame(id: string, payload: Buffer): Buffer {
  if (id.length !== 4) throw new Error(`ID3 frame id must be 4 chars: ${id}`);
  const header = Buffer.alloc(10);
  header.write(id, 0, 'latin1');
  header.writeUInt32BE(payload.length, 4);
  header.writeUInt16BE(0x0000, 8); // no frame flags
  return Buffer.concat([header, payload]);
}

/** 28-bit synchsafe integer: 7 bits per byte, high bit always clear. */
function synchsafe(size: number): Buffer {
  if (size < 0 || size > 0x0fffffff) {
    throw new Error(`ID3 tag size out of synchsafe range: ${size}`);
  }
  return Buffer.from([
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f,
  ]);
}

function chapterElementId(index: number): string {
  return `ch${index}`;
}

function chapFrame(chapter: AudiobookChapter, index: number): Buffer {
  const times = Buffer.alloc(16);
  times.writeUInt32BE(Math.max(0, Math.round(chapter.startMs)), 0);
  times.writeUInt32BE(Math.max(0, Math.round(chapter.endMs)), 4);
  // Byte offsets are optional; 0xFFFFFFFF is the spec's "not present" value.
  times.writeUInt32BE(0xffffffff, 8);
  times.writeUInt32BE(0xffffffff, 12);

  return frame(
    'CHAP',
    Buffer.concat([
      latin1Terminated(chapterElementId(index)),
      times,
      // The chapter's own title travels as an embedded TIT2 subframe.
      frame('TIT2', utf16TextPayload(chapter.title)),
    ]),
  );
}

function ctocFrame(count: number): Buffer {
  const childIds = Array.from({ length: count }, (_, i) => latin1Terminated(chapterElementId(i)));
  return frame(
    'CTOC',
    Buffer.concat([
      latin1Terminated('toc'),
      // 0x01 top-level, 0x02 ordered.
      Buffer.from([0x03, count]),
      ...childIds,
    ]),
  );
}

/**
 * Builds a complete ID3v2.3 tag to prepend to the MP3 data.
 *
 * Chapters are emitted in the order given; a CTOC referencing them follows the
 * text frames so a player finds the table of contents before the chapters it
 * points at.
 */
export function buildId3Tag(info: Id3TagInfo): Buffer {
  const frames: Buffer[] = [];

  if (info.title) frames.push(frame('TIT2', utf16TextPayload(info.title)));
  if (info.album) frames.push(frame('TALB', utf16TextPayload(info.album)));
  if (info.artist) frames.push(frame('TPE1', utf16TextPayload(info.artist)));

  if (info.chapters.length > 0) {
    frames.push(ctocFrame(info.chapters.length));
    info.chapters.forEach((chapter, index) => frames.push(chapFrame(chapter, index)));
  }

  const body = Buffer.concat(frames);
  const header = Buffer.concat([
    Buffer.from('ID3', 'latin1'),
    Buffer.from([0x03, 0x00]), // v2.3.0
    Buffer.from([0x00]),       // no tag flags
    synchsafe(body.length),
  ]);

  return Buffer.concat([header, body]);
}
