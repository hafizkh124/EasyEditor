/**
 * Windows-1256 (Arabic) → UTF-16 decoder.
 *
 * The جوامع الكلم column-store stores every plain-text column in CP1256 with no
 * BOM and no per-record delimiter (see `columnStore.ts` for the framing). Node
 * has no built-in CP1256 decoder and the project deliberately avoids adding
 * `iconv-lite` (keeps `check-shared-purity.mjs` and the bundle guard simple), so
 * this is a hand-rolled 128-entry table for the high half; the low half is
 * ASCII-identical.
 *
 * Verified 2026-09-10 against `NounsGarh.Text` (5,745 jarh verdicts) and
 * `HadithJudgmentSays.Say` (75,439 imam rulings) — both decode to clean Arabic.
 */

/** Unicode code point for each byte 0x80–0xFF under Windows-1256. */
const HIGH: readonly number[] = [
  0x20ac, 0x067e, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0679, 0x2039, 0x0152, 0x0686, 0x0698, 0x0688,
  0x06af, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x06a9, 0x2122, 0x0691, 0x203a, 0x0153, 0x200c, 0x200d, 0x06ba,
  0x00a0, 0x060c, 0x00a2, 0x00a3, 0x00a4, 0x00a5, 0x00a6, 0x00a7,
  0x00a8, 0x00a9, 0x06be, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x00af,
  0x00b0, 0x00b1, 0x00b2, 0x00b3, 0x00b4, 0x00b5, 0x00b6, 0x00b7,
  0x00b8, 0x00b9, 0x061b, 0x00bb, 0x00bc, 0x00bd, 0x00be, 0x061f,
  0x06c1, 0x0621, 0x0622, 0x0623, 0x0624, 0x0625, 0x0626, 0x0627,
  0x0628, 0x0629, 0x062a, 0x062b, 0x062c, 0x062d, 0x062e, 0x062f,
  0x0630, 0x0631, 0x0632, 0x0633, 0x0634, 0x0635, 0x0636, 0x00d7,
  0x0637, 0x0638, 0x0639, 0x063a, 0x0640, 0x0641, 0x0642, 0x0643,
  0x00e0, 0x0644, 0x00e2, 0x0645, 0x0646, 0x0647, 0x0648, 0x00e7,
  0x00e8, 0x00e9, 0x00ea, 0x00eb, 0x0649, 0x064a, 0x00ee, 0x00ef,
  0x064b, 0x064c, 0x064d, 0x064e, 0x00f4, 0x064f, 0x0650, 0x00f7,
  0x0651, 0x00f9, 0x0652, 0x00fb, 0x00fc, 0x200e, 0x200f, 0x06d2,
];

/** One shared lookup covering all 256 bytes (ASCII passthrough + HIGH table). */
const TABLE: Uint16Array = (() => {
  const t = new Uint16Array(256);
  for (let b = 0; b < 0x80; b++) t[b] = b;
  for (let b = 0x80; b < 0x100; b++) t[b] = HIGH[b - 0x80];
  return t;
})();

/** Decode a Windows-1256 byte range to a JS string. */
export function decodeCp1256(buf: Uint8Array, start = 0, end = buf.length): string {
  // Build in ~8k chunks so a multi-MB column value never blows the arg limit of
  // String.fromCharCode.apply.
  let out = '';
  const CHUNK = 8192;
  const codes = new Array<number>(Math.min(CHUNK, end - start));
  let n = 0;
  for (let i = start; i < end; i++) {
    codes[n++] = TABLE[buf[i]];
    if (n === CHUNK) {
      out += String.fromCharCode.apply(null, codes);
      n = 0;
    }
  }
  if (n > 0) out += String.fromCharCode.apply(null, codes.slice(0, n));
  return out;
}
