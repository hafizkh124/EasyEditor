import { readFileSync } from "node:fs";
import {
  RESEARCH_SOURCES,
  SOURCE_GROUPS,
  ALL_SOURCE_IDS,
  toSelectedDomains,
  sanitizeSelection,
} from "../lib/research/sources";

/**
 * The picker's ids ARE the wire contract with islamic-search: the function
 * filters the incoming list against its own ALL_DOMAINS and silently drops
 * anything else, so a typo here costs the user a whole source with no error
 * anywhere. islamic-search/index.ts cannot be imported (it calls serve() at
 * module load), so the tier lists are read out of the source instead.
 */
function backendDomains(): string[] {
  const src = readFileSync("supabase/functions/islamic-search/index.ts", "utf8");
  const ids: string[] = [];
  for (const tier of ["TIER_A_DOMAINS", "TIER_B_DOMAINS", "TIER_C_DOMAINS", "TIER_K_DOMAINS"]) {
    const match = new RegExp(`const ${tier} = \\[([^\\]]*)\\]`, "s").exec(src);
    expect(match, `${tier} not found in islamic-search/index.ts`).not.toBeNull();
    ids.push(...[...match![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  }
  return ids;
}

describe("research source catalogue", () => {
  it("only offers domains the backend actually fans out to", () => {
    const known = new Set(backendDomains());
    for (const source of RESEARCH_SOURCES) {
      expect(known.has(source.id), `"${source.id}" is not in islamic-search's ALL_DOMAINS`).toBe(true);
    }
  });

  it("omits shamela-index, which maps to no ingested corpus", () => {
    // vector-search's PSEUDO_DOMAIN_EXPANSION deliberately leaves it matching
    // nothing until Shamela is really ingested — a checkbox that can only ever
    // return zero results would misrepresent the corpus.
    expect(backendDomains()).toContain("shamela-index");
    expect(ALL_SOURCE_IDS).not.toContain("shamela-index");
  });

  it("has unique ids and puts every source in a declared group", () => {
    expect(new Set(ALL_SOURCE_IDS).size).toBe(ALL_SOURCE_IDS.length);
    const groups = new Set(SOURCE_GROUPS.map((g) => g.id));
    for (const source of RESEARCH_SOURCES) {
      expect(groups.has(source.group), `${source.id} has an unknown group`).toBe(true);
      expect(source.ur.trim().length).toBeGreaterThan(0);
      expect(source.note.trim().length).toBeGreaterThan(0);
    }
    for (const group of SOURCE_GROUPS) {
      expect(RESEARCH_SOURCES.some((s) => s.group === group.id), `${group.id} is empty`).toBe(true);
    }
  });
});

describe("selection → request payload", () => {
  it("sends undefined (= search everything) for an empty selection", () => {
    // The backend reads `selectedDomains ?? ALL_DOMAINS`, so [] would filter the
    // fan-out down to nothing and every tier would return zero results. This is
    // the single most important behaviour in this module.
    expect(toSelectedDomains([])).toBeUndefined();
  });

  it("sends undefined when everything is selected", () => {
    expect(toSelectedDomains([...ALL_SOURCE_IDS])).toBeUndefined();
  });

  it("sends the narrowed list when the user picked a subset", () => {
    expect(toSelectedDomains(["tanzil", "hadith-index"])).toEqual(["tanzil", "hadith-index"]);
  });

  it("drops unknown ids, and falls back to everything if none survive", () => {
    expect(toSelectedDomains(["tanzil", "made-up"])).toEqual(["tanzil"]);
    expect(toSelectedDomains(["made-up"])).toBeUndefined();
  });

  it("sanitises a stale or malformed stored selection", () => {
    expect(sanitizeSelection(["tanzil", "gone-away", 7, null])).toEqual(["tanzil"]);
    expect(sanitizeSelection("not-an-array")).toEqual([]);
    expect(sanitizeSelection(undefined)).toEqual([]);
  });
});
