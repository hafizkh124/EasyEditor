// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  normalizeEntityName,
  findDuplicateSuggestions,
  buildMergedAliases,
} from "@/lib/graph/entityResolve";
import type { Entity } from "@/lib/graph/graphService";

/**
 * SPEC-M4 FR-3.3. Duplicate entities are *suggested*, never merged
 * automatically — attributing one scholar's position to another is the exact
 * failure the Trust pillar exists to prevent.
 */

const entity = (id: string, name: string, kind: Entity["kind"] = "person", aliases: string[] = []): Entity => ({
  id,
  user_id: "u1",
  canonical_name: name,
  kind,
  aliases,
  created_at: new Date().toISOString(),
});

describe("normalizeEntityName", () => {
  it("folds the Urdu/Arabic spellings of one name together", () => {
    expect(normalizeEntityName("ابن تیمیہ")).toBe(normalizeEntityName("ابن تیمیۃ"));
    expect(normalizeEntityName("ابن حجر")).toBe(normalizeEntityName("إبن حجر"));
  });

  it("keeps genuinely different names apart", () => {
    expect(normalizeEntityName("ابن حجر العسقلانی")).not.toBe(
      normalizeEntityName("ابن حجر الہیتمی"),
    );
  });

  it("ignores harakat and punctuation", () => {
    expect(normalizeEntityName("اَلْبُخَارِی")).toBe(normalizeEntityName("البخاری"));
  });
});

describe("findDuplicateSuggestions (FR-3.3)", () => {
  it("pairs two spellings of the same name", () => {
    const suggestions = findDuplicateSuggestions([
      entity("1", "ابن تیمیہ"),
      entity("2", "ابن تیمیۃ"),
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].reason).toBe("same-normalized-name");
  });

  it("does not pair two different scholars with similar names", () => {
    const suggestions = findDuplicateSuggestions([
      entity("1", "ابن حجر العسقلانی"),
      entity("2", "ابن حجر الہیتمی"),
    ]);

    expect(suggestions).toHaveLength(0);
  });

  it("does not pair across kinds", () => {
    const suggestions = findDuplicateSuggestions([
      entity("1", "الرسالہ", "book"),
      entity("2", "الرسالہ", "concept"),
    ]);

    expect(suggestions).toHaveLength(0);
  });

  it("pairs when one record lists the other's name as an alias", () => {
    const suggestions = findDuplicateSuggestions([
      entity("1", "احمد بن عبد الحلیم", "person", ["ابن تیمیہ"]),
      entity("2", "ابن تیمیہ"),
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].reason).toBe("alias-match");
  });

  it("returns nothing for a clean graph", () => {
    expect(findDuplicateSuggestions([entity("1", "البخاری"), entity("2", "مسلم")])).toHaveLength(0);
  });
});

describe("buildMergedAliases (reversibility)", () => {
  it("keeps the absorbed name so the merge can be undone", () => {
    const keep = entity("1", "ابن تیمیہ", "person", ["شیخ الاسلام"]);
    const absorb = entity("2", "ابن تیمیۃ", "person", ["الحرانی"]);

    const aliases = buildMergedAliases(keep, absorb);

    expect(aliases).toContain("ابن تیمیۃ");
    expect(aliases).toContain("شیخ الاسلام");
    expect(aliases).toContain("الحرانی");
    // The surviving name is the canonical one, not also an alias of itself.
    expect(aliases).not.toContain("ابن تیمیہ");
  });
});
