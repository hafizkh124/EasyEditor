// @vitest-environment node
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
  for (const tier of ["TIER_A_DOMAINS", "TIER_B_DOMAINS", "TIER_C_DOMAINS", "TIER_K_DOMAINS", "TIER_D_DOMAINS"]) {
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

describe("classical discipline pseudo-domains", () => {
  function backendDisciplineMap(): Record<string, string> {
    const src = readFileSync("supabase/functions/islamic-search/index.ts", "utf8");
    const match = /const TIER_D_DISCIPLINE: Record<string, string> = \{([^}]*)\}/s.exec(src);
    expect(match, "TIER_D_DISCIPLINE not found in islamic-search/index.ts").not.toBeNull();
    const map: Record<string, string> = {};
    for (const m of match![1].matchAll(/"([^"]+)":\s*"([^"]+)"/g)) map[m[1]] = m[2];
    return map;
  }

  it("maps every classical- id the picker offers to a real discipline slug", async () => {
    const { DISCIPLINE_SLUGS } = await import("../../supabase/functions/_shared/disciplines");
    const map = backendDisciplineMap();
    const classicalIds = RESEARCH_SOURCES.filter((s) => s.group === "classical").map((s) => s.id);
    expect(classicalIds.length).toBeGreaterThan(0);
    for (const id of classicalIds) {
      expect(map[id], `"${id}" has no entry in TIER_D_DISCIPLINE`).toBeDefined();
      expect(DISCIPLINE_SLUGS as readonly string[]).toContain(map[id]);
    }
  });

  it("does not offer fiqh or nahw — no domain of theirs has ingested rows", () => {
    // shamela has never been ingested; openiti-index is ingested but as
    // untagged general prose. Offering them would repeat the exact
    // shamela-index mistake this file already documents avoiding.
    const offered = new Set(Object.values(backendDisciplineMap()));
    expect(offered.has("fiqh")).toBe(false);
    expect(offered.has("nahw")).toBe(false);
  });

  it("does offer fatwa — urdufatwa is a real, populated, embedded corpus", async () => {
    // Regression guard for the Atlas finding #5 bug: fatwa was excluded on
    // 2026-08-23 because DISCIPLINE_DOMAINS listed only shamela/openiti/
    // islamqa-cache for it, hiding the 22,775-row urdufatwa corpus that
    // ingest_fatwa.py writes with citation_ref.discipline = "fatwa".
    const { DISCIPLINE_DOMAINS } = await import("../../supabase/functions/_shared/disciplines");
    expect(new Set(Object.values(backendDisciplineMap())).has("fatwa")).toBe(true);
    expect(DISCIPLINE_DOMAINS.fatwa).toContain("urdufatwa");
  });

  it("maps every discipline only to domains a loader really writes", async () => {
    // `openiti` was listed for all six disciplines but is not a domain — the
    // corpus stores `openiti-index`. A name no loader writes is invisible:
    // it matches no rows, so the discipline looks empty rather than broken.
    const { DISCIPLINE_DOMAINS } = await import("../../supabase/functions/_shared/disciplines");
    for (const [discipline, domains] of Object.entries(DISCIPLINE_DOMAINS)) {
      expect(domains, `${discipline} still maps to the non-existent "openiti"`).not.toContain("openiti");
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
