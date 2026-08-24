// @vitest-environment node
// segmentClaims — mostly a re-export of shared/text/chunk.ts's segmentText
// (see that file's header: shared by the Deno "Add citations" pipeline and any
// Electron-side equivalent, per SPEC-M5 FR-1.5/FR-3.4), plus one original
// function, detectScript.
//
// Neither had a test before this. segmentText matters more than its size
// suggests: findCitationCandidates gets called once per segment, so a
// boundary bug here either merges two claims into one lookup (losing a
// citation) or splits one claim into fragments no lookup can match. The
// character-offset invariant — every segment's [start, end) must slice the
// ORIGINAL input back to (a trimmed version of) that segment's own text — is
// what lets a caller re-insert a citation at the exact right place; this file
// checks that invariant directly rather than trusting it by construction.
import { describe, it, expect } from "vitest";
import {
  segmentClaims,
  detectScript,
} from "../../supabase/functions/_shared/segmentClaims.ts";

/** Every segment's offsets must slice the original text back to itself (trimmed). */
function assertOffsetsRoundTrip(input: string, segments: ReturnType<typeof segmentClaims>) {
  for (const seg of segments) {
    expect(input.slice(seg.start, seg.end).trim()).toBe(seg.text);
  }
}

describe("segmentClaims — basic splitting", () => {
  it("returns one segment for a single sentence", () => {
    const segs = segmentClaims("The sky is blue today.");
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe("The sky is blue today.");
  });

  it("splits on English sentence terminators", () => {
    const segs = segmentClaims("First claim here now. Second claim follows too! Third one asks?");
    expect(segs.map((s) => s.text)).toEqual([
      "First claim here now.",
      "Second claim follows too!",
      "Third one asks?",
    ]);
  });

  it("splits on the Urdu full stop ۔", () => {
    const segs = segmentClaims("یہ پہلا مکمل جملہ ہے۔ یہ دوسرا مکمل جملہ ہے۔");
    expect(segs).toHaveLength(2);
  });

  it("splits on the Arabic question mark ؟", () => {
    const segs = segmentClaims("هل تعلم أن هذا سؤال طويل بما يكفي؟ نعم هذا واضح تماما.");
    expect(segs).toHaveLength(2);
  });

  it("indexes segments sequentially from zero", () => {
    const segs = segmentClaims("First sentence here now. Second sentence here too. Third one follows.");
    expect(segs.map((s) => s.index)).toEqual([0, 1, 2]);
  });
});

describe("segmentClaims — the offset contract", () => {
  it("round-trips offsets for a plain multi-sentence input", () => {
    const input = "First claim goes here. Second claim goes here too. Third claim ends it.";
    assertOffsetsRoundTrip(input, segmentClaims(input));
  });

  it("round-trips offsets across mixed-script punctuation", () => {
    const input = "This is English text now. یہ اردو کا جملہ ہے۔ هذا نص عربي طويل كفاية؟";
    assertOffsetsRoundTrip(input, segmentClaims(input));
  });

  it("round-trips offsets when short fragments get merged backward", () => {
    // "Ok." and "No." are both under the 12-character minimum and should be
    // folded into their neighbours — the merged segment's offsets must still
    // cover the fragment's own span, not just the segment it was merged into.
    const input = "Ok. This is a longer claim that follows the short fragment. No. This ends it properly.";
    assertOffsetsRoundTrip(input, segmentClaims(input));
  });

  it("actually merges a short trailing fragment into the segment before it", () => {
    // The offset round-trip above holds whether or not the merge happens —
    // this asserts the merge itself. Merging only ever looks backward into an
    // ALREADY-PUSHED segment (`pushSegment`'s guard is `out.length > 0`), so
    // the short piece has to come second: a short leading fragment has
    // nothing yet to merge into (see the test below for that case) and
    // survives as its own segment regardless of its length.
    const segs = segmentClaims("This is a longer opening sentence right here. Ok.");
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe("This is a longer opening sentence right here. Ok.");
  });

  it("keeps two segments when neither piece is short enough to merge", () => {
    // The contrast case: without this, a change that merges everything
    // regardless of length would still pass the test above.
    const segs = segmentClaims("First long enough claim right here. Second long enough claim right here.");
    expect(segs).toHaveLength(2);
  });

  it("round-trips offsets for text with no terminator at all", () => {
    const input = "no punctuation anywhere in this whole run of text";
    assertOffsetsRoundTrip(input, segmentClaims(input));
  });
});

describe("segmentClaims — edge cases", () => {
  it("returns an empty array for an empty string", () => {
    expect(segmentClaims("")).toEqual([]);
  });

  it("returns an empty array for whitespace only", () => {
    expect(segmentClaims("   \n\t  ")).toEqual([]);
  });

  it("does not lose the final sentence when the input has no trailing terminator", () => {
    const segs = segmentClaims("First complete sentence here. Trailing fragment with no period");
    expect(segs.at(-1)?.text).toBe("Trailing fragment with no period");
  });

  it("merges a short leading fragment into the sentence that follows it, not before it exists", () => {
    // The merge logic only looks backward (`out.length > 0`); a short FIRST
    // fragment has nothing to merge into and must survive as its own segment
    // rather than being silently dropped.
    const segs = segmentClaims("Hi. This is the second, much longer sentence in the input.");
    const combined = segs.map((s) => s.text).join(" ");
    expect(combined).toContain("Hi.");
  });

  it("caps output at 30 segments and folds the remainder into the last one", () => {
    const sentences = Array.from({ length: 40 }, (_, i) => `This is claim number ${i} in a long list.`);
    const input = sentences.join(" ");
    const segs = segmentClaims(input);

    expect(segs.length).toBeLessThanOrEqual(30);
    expect(segs.at(-1)?.end).toBe(input.length);
    // No claim is silently dropped — the last segment's text absorbs everything
    // past the cap, so the final sentence's content still appears somewhere.
    expect(segs.at(-1)?.text).toContain("claim number 39");
  });

  it("re-indexes contiguously from 0 even after the 30-segment cap folds the tail", () => {
    const sentences = Array.from({ length: 40 }, (_, i) => `This is claim number ${i} in a long list.`);
    const segs = segmentClaims(sentences.join(" "));
    expect(segs.map((s) => s.index)).toEqual(Array.from({ length: segs.length }, (_, i) => i));
  });
});

describe("detectScript", () => {
  it("detects Arabic when Arabic characters dominate", () => {
    expect(detectScript("هذا نص عربي طويل بما فيه الكفاية")).toBe("ar");
  });

  it("detects English when Latin characters dominate", () => {
    expect(detectScript("This is a plain English sentence with no other script")).toBe("en");
  });

  it("detects Urdu via Urdu-specific letters plus Arabic-script dominance", () => {
    expect(detectScript("یہ ایک اردو کا جملہ ہے جس میں خاص حروف ہیں")).toBe("ur");
  });

  it("does not call Arabic script Urdu just because it is Arabic script", () => {
    // No Urdu-only letters (ٹ ڈ ڑ ں ھ ہ ۂ ۃ ی ے ۔ چ) present.
    expect(detectScript("قال رسول الله صلى الله عليه وسلم")).toBe("ar");
  });

  it("falls back to mixed for a short or balanced string", () => {
    expect(detectScript("abc")).toBe("mixed");
  });

  it("falls back to mixed for an empty string", () => {
    expect(detectScript("")).toBe("mixed");
  });

  it("falls back to mixed when Arabic and Latin letter counts are exactly tied", () => {
    // 4 Latin letters ("abcd"), 4 Arabic letters ("ابجد") — neither
    // `arabicCount > latinCount` nor the reverse holds, so this only proves
    // the fallback if the counts are truly equal, not just close.
    expect(detectScript("abcd ابجد")).toBe("mixed");
  });
});
