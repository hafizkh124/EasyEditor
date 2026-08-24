// @vitest-environment node
// Tests for Reciprocal Rank Fusion used by the citation engine.
// Ported from supabase/functions/_shared/__tests__/ (which no pipeline ran).
//
// The property that matters most operationally: a channel returning nothing
// (semantic search when the embedding backfill is incomplete) must degrade the
// result, never corrupt or empty it.

import { it } from "vitest";
import { assertEquals, assert } from "./helpers/denoAsserts";
import { reciprocalRankFusion, buildMatchKey, RRF_K } from "../../supabase/functions/_shared/rankFusion.ts";

// Explicit return type: without it TS drops the index signature when spreading
// `extra`, so reading a dynamic field off a fused doc fails to typecheck.
// (These files were never in tsconfig's include before they moved into src/.)
const doc = (
  key: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> & { match_key: string } => ({ match_key: key, ...extra });

it("empty input yields an empty result", () => {
  assertEquals(reciprocalRankFusion([]), []);
  assertEquals(reciprocalRankFusion([{ name: "lexical", docs: [] }]), []);
});

it("a single channel preserves its own ordering", () => {
  const fused = reciprocalRankFusion([
    { name: "lexical", docs: [doc("quran:2:1"), doc("quran:2:2"), doc("quran:2:3")] },
  ]);
  assertEquals(fused.map((f) => f.doc.match_key), ["quran:2:1", "quran:2:2", "quran:2:3"]);
});

it("an empty channel does not disturb the other channel's ordering", () => {
  // This is the semantic-channel-unavailable case: search must still work.
  const docs = [doc("quran:2:1"), doc("quran:2:2")];
  const withEmpty = reciprocalRankFusion([
    { name: "lexical", docs },
    { name: "semantic", docs: [] },
  ]);
  const alone = reciprocalRankFusion([{ name: "lexical", docs }]);
  assertEquals(withEmpty.map((f) => f.doc.match_key), alone.map((f) => f.doc.match_key));
});

it("appearing in both channels outranks a #1 in only one", () => {
  // The core RRF behaviour: agreement across channels beats a single strong hit.
  const fused = reciprocalRankFusion([
    { name: "lexical", docs: [doc("only-lexical"), doc("in-both")] },
    { name: "semantic", docs: [doc("only-semantic"), doc("in-both")] },
  ]);
  assertEquals(fused[0].doc.match_key, "in-both");
  assertEquals(fused[0].channels.sort(), ["lexical", "semantic"]);
});

it("scores follow the 1/(K+rank) formula", () => {
  const fused = reciprocalRankFusion([
    { name: "a", docs: [doc("x"), doc("y")] },
  ]);
  assertEquals(fused[0].score, 1 / (RRF_K + 1));
  assertEquals(fused[1].score, 1 / (RRF_K + 2));
});

it("a document repeated inside one channel only scores once", () => {
  // A channel returning a duplicate must not let it collect the bonus twice.
  const fused = reciprocalRankFusion([
    { name: "lexical", docs: [doc("dup"), doc("dup"), doc("other")] },
  ]);
  assertEquals(fused.length, 2);
  assertEquals(fused[0].doc.match_key, "dup");
  assertEquals(fused[0].channels, ["lexical"]);
  // "other" was at index 2 but is rank 2 after the duplicate was skipped.
  assertEquals(fused[1].score, 1 / (RRF_K + 2));
});

it("the first channel's object wins on duplicate keys", () => {
  // The engine passes lexical first because only it carries content_ar.
  const fused = reciprocalRankFusion([
    { name: "lexical", docs: [doc("k", { content_ar: "عربي" })] },
    { name: "semantic", docs: [doc("k", { content_ar: undefined })] },
  ]);
  assertEquals(fused.length, 1);
  assertEquals(fused[0].doc.content_ar, "عربي");
});

it("documents without a match_key are dropped", () => {
  const fused = reciprocalRankFusion([
    // deno-lint-ignore no-explicit-any
    { name: "lexical", docs: [{ match_key: "" } as any, doc("good")] },
  ]);
  assertEquals(fused.map((f) => f.doc.match_key), ["good"]);
});

it("ties break deterministically by match_key", () => {
  const a = reciprocalRankFusion([
    { name: "x", docs: [doc("b")] },
    { name: "y", docs: [doc("a")] },
  ]);
  const b = reciprocalRankFusion([
    { name: "x", docs: [doc("b")] },
    { name: "y", docs: [doc("a")] },
  ]);
  assertEquals(a.map((f) => f.doc.match_key), b.map((f) => f.doc.match_key));
  assertEquals(a[0].doc.match_key, "a");
});

// ── buildMatchKey ───────────────────────────────────────────────────────────

it("buildMatchKey builds Quran keys from surah + verse", () => {
  assertEquals(
    buildMatchKey({ source_type: "quran", citation_ref: { surah_number: 2, verse: 255 } }),
    "quran:2:255",
  );
});

it("buildMatchKey builds Hadith keys, preferring collection over book", () => {
  assertEquals(
    buildMatchKey({
      source_type: "hadith",
      citation_ref: { collection: "bukhari", book: "صحيح البخاري", hadith_number: "1" },
    }),
    "hadith:bukhari:1",
  );
  // Falls back to `book` when the slug is absent.
  assertEquals(
    buildMatchKey({ source_type: "hadith", citation_ref: { book: "muslim", hadith_number: 7 } }),
    "hadith:muslim:7",
  );
});

it("buildMatchKey returns null for rows it cannot identify", () => {
  assert(buildMatchKey({ source_type: "quran", citation_ref: { surah_number: 2 } }) === null);
  assert(buildMatchKey({ source_type: "hadith", citation_ref: { collection: "bukhari" } }) === null);
  assert(buildMatchKey({ source_type: "classical", citation_ref: { title: "x" } }) === null);
  assert(buildMatchKey({}) === null);
});
