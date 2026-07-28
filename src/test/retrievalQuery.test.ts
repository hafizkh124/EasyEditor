import { describe, it, expect } from "vitest";
import { buildRetrievalQuery, perSourceBudget } from "../../supabase/functions/_shared/retrievalQuery";

/**
 * SPEC-M3 FR-4.2 — the two truncations that used to blind the citation engine.
 *
 * The functions are imported straight from `_shared/`, the same module the edge
 * function ships — a client-side copy would let the two drift and the test would
 * stop saying anything about production.
 */

const ARABIC_QUOTE = "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى فمن كانت هجرته";
const URDU_PROSE = "یہ ایک طویل اردو عبارت ہے جو سیاق فراہم کرتی ہے۔ ";

describe("buildRetrievalQuery (FR-4.2)", () => {
  it("includes an Arabic quotation that sits far past the old 4,000-char window", () => {
    const filler = URDU_PROSE.repeat(200);
    const text = `${filler}${ARABIC_QUOTE}۔ ${filler}`;

    // The quotation lands around character 9,000 — `text.slice(0, 4000)` could
    // never have seen it, which is exactly why long passages came back uncited.
    expect(text.indexOf(ARABIC_QUOTE)).toBeGreaterThan(4000);

    const query = buildRetrievalQuery(text);
    expect(query).toContain("إنما الأعمال بالنيات");
  });

  it("never exceeds the retrieval budget", () => {
    const text = `${ARABIC_QUOTE}۔ `.repeat(500);
    expect(buildRetrievalQuery(text, 4000).length).toBeLessThanOrEqual(4000);
  });

  it("puts the quotation before prose when the budget is tight", () => {
    const text = `${URDU_PROSE.repeat(60)}${ARABIC_QUOTE}۔`;
    const query = buildRetrievalQuery(text, 1500);

    // With room for only one of the two, the citable passage must win.
    expect(query).toContain("إنما الأعمال بالنيات");
  });

  it("does not mistake Urdu prose for a quotation", () => {
    // Urdu is written in Arabic script, so a script-only test would treat the
    // scholar's own commentary as citable and crowd out the real quotation.
    const query = buildRetrievalQuery(URDU_PROSE.repeat(100), 1500);
    expect(query).toContain("یہ ایک طویل اردو عبارت");
  });

  it("picks up a bracketed Quranic quotation", () => {
    const text = `${URDU_PROSE.repeat(80)}﴿وَأَقِيمُوا الصَّلَاةَ وَآتُوا الزَّكَاةَ﴾`;
    expect(buildRetrievalQuery(text, 2000)).toContain("وَأَقِيمُوا الصَّلَاةَ");
  });

  it("falls back to a plain prefix when there is nothing quotable", () => {
    const text = "plain english text with no arabic script at all";
    expect(buildRetrievalQuery(text)).toContain("plain english text");
  });
});

describe("perSourceBudget (FR-4.2)", () => {
  it("gives far more than the old fixed 600 chars when few sources return", () => {
    expect(perSourceBudget(2)).toBeGreaterThan(600);
  });

  it("stays bounded so the prompt cannot blow up", () => {
    expect(perSourceBudget(1)).toBeLessThanOrEqual(1500);
    expect(perSourceBudget(50)).toBeGreaterThanOrEqual(400);
  });

  it("spreads a fixed total across the sources actually returned", () => {
    expect(perSourceBudget(8) * 8).toBeLessThanOrEqual(9000);
  });
});
