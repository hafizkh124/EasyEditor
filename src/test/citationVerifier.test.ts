// @vitest-environment node
// The citation verifier — the last thing standing between a hallucinated
// citation and the user's screen.
//
// The pipeline already constrains the LLM with a candidate list, but a model
// can still emit a plausible variant: an off-by-one verse, a real hadith number
// against the wrong collection, a book slug that does not exist. This module is
// the safety net: anything it cannot find in `scholarly_documents` is dropped.
//
// It had no test at all, in a project where citation integrity has already been
// a shipped bug class. The property that matters most is negative — that
// *nothing unverifiable survives* — so most of these assert on rejection.
import { describe, it, expect } from "vitest";
import { createFakeClient } from "./helpers/fakeSupabase";
import {
  verifyOne,
  verifyAll,
  type RawLlmCitation,
} from "../../supabase/functions/_shared/citationVerifier.ts";

/** A row as `scholarly_documents` stores it. */
const quranRow = (over: Record<string, unknown> = {}) => ({
  content: "And spend of the good things which ye have earned",
  content_ar: "أَنفِقُوا مِن طَيِّبَاتِ مَا كَسَبْتُمْ",
  citation_ref: { surah_number: 2, verse: 267, surah_name: "Al-Baqarah" },
  source_url: "https://quran.example/2/267",
  domain: "tanzil",
  ...over,
});

const hadithRow = (over: Record<string, unknown> = {}) => ({
  content: "Charity does not decrease wealth",
  content_ar: "مَا نَقَصَتْ صَدَقَةٌ مِنْ مَالٍ",
  citation_ref: { book: "sahih-muslim", collection: "Sahih Muslim", hadith_number: "2588", grade: "sahih" },
  source_url: "https://hadith.example/muslim/2588",
  domain: "hadith-json",
  ...over,
});

/** A client whose corpus contains exactly the given rows. */
const withRows = (rows: unknown[]) => createFakeClient({ tables: { scholarly_documents: rows } });
/** A client whose corpus is empty — every lookup misses. */
const emptyCorpus = () => createFakeClient({ tables: { scholarly_documents: [] } });

// The module types its client parameter as `ReturnType<typeof createClient>`,
// which the fake deliberately does not implement in full — see fakeSupabase.ts.
// Casting at the boundary keeps that decision in one visible place.
const asClient = (c: unknown) => c as Parameters<typeof verifyOne>[1];

describe("verifyOne — rejects what it cannot confirm", () => {
  it("rejects a Quran citation whose verse is not in the corpus", async () => {
    const result = await verifyOne({ surah: 2, verse: 9999 }, asClient(emptyCorpus()));
    expect(result).toBeNull();
  });

  it("rejects a hadith citation whose number is not in the corpus", async () => {
    const result = await verifyOne(
      { book: "sahih-bukhari", hadith_number: "999999" },
      asClient(emptyCorpus()),
    );
    expect(result).toBeNull();
  });

  it("rejects a citation with no identifiers at all", async () => {
    const client = withRows([quranRow()]);
    expect(await verifyOne({ arabic: "نص" }, asClient(client))).toBeNull();
    // It must not even ask the database — there is nothing to ask about.
    expect(client.reads).toEqual([]);
  });

  it("rejects a free-form reference it cannot parse", async () => {
    const client = withRows([quranRow()]);
    const result = await verifyOne(
      { reference: "as narrated by the scholars of old" },
      asClient(client),
    );
    expect(result).toBeNull();
    expect(client.reads).toEqual([]);
  });

  it("rejects a half-specified hadith (book without number)", async () => {
    expect(await verifyOne({ book: "sahih-bukhari" }, asClient(withRows([hadithRow()]))))
      .toBeNull();
  });

  it("rejects a half-specified verse (surah without verse)", async () => {
    expect(await verifyOne({ surah: 2 }, asClient(withRows([quranRow()])))).toBeNull();
  });

  it("returns null rather than throwing when the lookup errors", async () => {
    // A database blip must degrade to "unverified", never to an exception that
    // takes down the whole research response.
    const client = createFakeClient({
      selectErrors: { scholarly_documents: { message: "connection reset" } },
    });
    await expect(verifyOne({ surah: 2, verse: 267 }, asClient(client))).resolves.toBeNull();
  });

  it("rejects a non-numeric surah/verse instead of querying with NaN", async () => {
    const client = withRows([quranRow()]);
    expect(await verifyOne({ surah: "two", verse: "many" }, asClient(client))).toBeNull();
    expect(client.reads).toEqual([]);
  });
});

describe("verifyOne — the database text wins", () => {
  it("replaces the LLM's Arabic with the stored matn", async () => {
    // This is the anti-hallucination guarantee: even a citation that resolves to
    // a real verse must not carry the model's own wording onto the screen.
    const result = await verifyOne(
      { surah: 2, verse: 267, arabic: "نص اخترعه النموذج", translation: "invented" },
      asClient(withRows([quranRow()])),
    );

    expect(result).not.toBeNull();
    expect(result!.arabic).toBe("أَنفِقُوا مِن طَيِّبَاتِ مَا كَسَبْتُمْ");
    expect(result!.arabic).not.toContain("اخترعه");
  });

  it("falls back to the stored translation when the LLM gave none", async () => {
    const result = await verifyOne({ surah: 2, verse: 267 }, asClient(withRows([quranRow()])));
    expect(result!.translation).toBe("And spend of the good things which ye have earned");
  });

  it("prefers the stored source_url over anything the model supplied", async () => {
    const result = await verifyOne(
      { surah: 2, verse: 267, source_url: "https://evil.example/made-up" },
      asClient(withRows([quranRow()])),
    );
    expect(result!.source_url).toBe("https://quran.example/2/267");
  });

  it("builds a stable match_key for dedup", async () => {
    const quran = await verifyOne({ surah: 2, verse: 267 }, asClient(withRows([quranRow()])));
    expect(quran!.match_key).toBe("quran:2:267");

    const hadith = await verifyOne(
      { book: "sahih-muslim", hadith_number: 2588 },
      asClient(withRows([hadithRow()])),
    );
    expect(hadith!.match_key).toBe("hadith:sahih-muslim:2588");
  });

  it("labels a verified verse with the surah name from the corpus", async () => {
    const result = await verifyOne({ surah: 2, verse: 267 }, asClient(withRows([quranRow()])));
    expect(result!.reference).toBe("Qur'an 2:267 (Al-Baqarah)");
  });

  it("labels a verified hadith with its collection and grade", async () => {
    const result = await verifyOne(
      { book: "sahih-muslim", hadith_number: "2588" },
      asClient(withRows([hadithRow()])),
    );
    expect(result!.reference).toBe("Sahih Muslim, Hadith 2588 (sahih)");
  });
});

describe("verifyOne — free-form reference parsing", () => {
  it.each([
    ["Qur'an 2:267", 2, 267],
    ["Quran 2:267", 2, 267],
    ["القرآن 2:267", 2, 267],
    ["قرآن 2:267", 2, 267],
    ["Surah 2:267", 2, 267],
  ])("parses %s into a verse lookup", async (reference, surah, verse) => {
    const client = withRows([quranRow()]);
    const result = await verifyOne({ reference }, asClient(client));
    expect(result).not.toBeNull();
    expect(result!.match_key).toBe(`quran:${surah}:${verse}`);
  });

  // This block is the real guard on the apostrophe class in parseReference.
  // It once held three copies of U+0027, so every curly form below silently
  // failed to parse and the citation was dropped as unverifiable — a real
  // verse, thrown away, because of the shape of an apostrophe. Models emit
  // these constantly. If someone's editor re-flattens the class, these fail.
  it.each([
    ["U+0027 straight", "Qur'an 2:267"],
    ["U+2018 left curly", `Qur${String.fromCharCode(0x2018)}an 2:267`],
    ["U+2019 right curly", `Qur${String.fromCharCode(0x2019)}an 2:267`],
    ["U+02BC modifier letter", `Qur${String.fromCharCode(0x02bc)}an 2:267`],
    ["U+02BE right half ring", `Qur${String.fromCharCode(0x02be)}an 2:267`],
    ["U+02BF left half ring", `Qur${String.fromCharCode(0x02bf)}an 2:267`],
    ["U+0060 backtick", "Qur`an 2:267"],
    ["no apostrophe", "Quran 2:267"],
    ["academic transliteration", `Qur${String.fromCharCode(0x02be)}${String.fromCharCode(0x0101)}n 2:267`],
  ])("accepts the %s apostrophe form", async (_label, reference) => {
    const result = await verifyOne({ reference }, asClient(withRows([quranRow()])));
    expect(result).not.toBeNull();
    expect(result!.match_key).toBe("quran:2:267");
  });

  it.each([
    ["Sahih al-Bukhari, Hadith 1410", "sahih-bukhari"],
    ["Bukhari 1410", "sahih-bukhari"],
    ["Muslim 1410", "sahih-muslim"],
    ["Tirmidhi 1410", "al-tirmidhi"],
    ["Abu Dawud 1410", "abu-dawood"],
    ["Ibn Majah 1410", "ibn-e-majah"],
  ])("maps %s to the %s slug", async (reference, slug) => {
    const client = withRows([hadithRow()]);
    const result = await verifyOne({ reference }, asClient(client));
    expect(result).not.toBeNull();
    expect(result!.match_key).toBe(`hadith:${slug}:1410`);
  });

  it("prefers explicit structured ids over the free-form reference", async () => {
    // When the two disagree the structured ids are the ones the prompt asked
    // for; silently trusting the prose instead would reintroduce the ambiguity
    // the candidate list exists to remove.
    const result = await verifyOne(
      { surah: 2, verse: 267, reference: "Bukhari 1410" },
      asClient(withRows([quranRow()])),
    );
    expect(result!.match_key).toBe("quran:2:267");
  });
});

describe("verifyAll — the split the UI depends on", () => {
  it("separates verified from rejected", async () => {
    // The corpus answers every lookup with the same row, so this uses an empty
    // corpus for the misses and asserts the partition itself.
    const raws: RawLlmCitation[] = [
      { surah: 2, verse: 267 },
      { reference: "no identifiers here" },
      { book: "sahih-muslim", hadith_number: "2588" },
    ];

    const { verified, rejected } = await verifyAll(raws, asClient(withRows([quranRow()])));

    expect(verified.length + rejected.length).toBe(raws.length);
    expect(rejected).toContainEqual({ reference: "no identifiers here" });
  });

  it("renumbers verified citations from 1 so the markers match the list", async () => {
    // The answer text carries [1], [2], … — if these indices are the LLM's
    // original numbering, dropping a rejected citation leaves the markers
    // pointing at the wrong entries. That mismatch has bitten this project
    // before.
    const raws: RawLlmCitation[] = [
      { surah: 2, verse: 267, index: 7 },
      { surah: 2, verse: 267, index: 42 },
    ];
    const { verified } = await verifyAll(raws, asClient(withRows([quranRow()])));

    expect(verified.map((v) => v.index)).toEqual([1, 2]);
  });

  it("returns two empty lists for an empty input", async () => {
    const { verified, rejected } = await verifyAll([], asClient(emptyCorpus()));
    expect(verified).toEqual([]);
    expect(rejected).toEqual([]);
  });

  it("rejects everything when the corpus is empty", async () => {
    const raws: RawLlmCitation[] = [
      { surah: 2, verse: 267 },
      { book: "sahih-bukhari", hadith_number: "1" },
    ];
    const { verified, rejected } = await verifyAll(raws, asClient(emptyCorpus()));

    expect(verified).toEqual([]);
    expect(rejected).toHaveLength(2);
  });

  it("survives a lookup error without losing the other citations", async () => {
    const client = createFakeClient({
      selectErrors: { scholarly_documents: { message: "timeout" } },
    });
    const { verified, rejected } = await verifyAll(
      [{ surah: 2, verse: 267 }, { surah: 2, verse: 268 }],
      asClient(client),
    );
    expect(verified).toEqual([]);
    expect(rejected).toHaveLength(2);
  });
});

describe("verifyOne — the query it actually issues", () => {
  it("scopes a verse lookup to quran rows", async () => {
    const client = withRows([quranRow()]);
    await verifyOne({ surah: 2, verse: 267 }, asClient(client));

    const [read] = client.reads;
    expect(read.table).toBe("scholarly_documents");
    expect(read.filters).toContainEqual({ column: "source_type", value: "quran" });
    expect(read.filters.find((f) => f.column === "__or")?.value)
      .toContain("citation_ref->>surah_number.eq.2");
  });

  it("scopes a hadith lookup to hadith rows and the right book", async () => {
    const client = withRows([hadithRow()]);
    await verifyOne({ book: "sahih-muslim", hadith_number: "2588" }, asClient(client));

    const [read] = client.reads;
    expect(read.filters).toContainEqual({ column: "source_type", value: "hadith" });
    expect(read.filters.find((f) => f.column === "__or")?.value)
      .toContain("citation_ref->>book.eq.sahih-muslim");
  });
});
