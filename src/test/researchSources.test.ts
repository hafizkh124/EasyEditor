// @vitest-environment node
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
 * anywhere. The tier lists used to be read out of islamic-search's source text
 * by regex, because `handle` wasn't exported yet and importing the module ran
 * `serve()` at load time; now that P1's G2 work exported `handle` (and the
 * vitest deno-specifiers plugin stubs `serve` itself), the tier constants can
 * be exported and imported for real — see TESTING-STRATEGY.md §6.
 *
 * Loaded with a dynamic `import()` inside `beforeAll`, not a static top-level
 * import: islamic-search/index.ts is Deno source outside tsconfig.app.json's
 * `include` roots (`src`, `shared`), and a static import here would pull its
 * whole dependency graph into `npm run typecheck:app`, which never type-checks
 * `supabase/functions/**` and fails on it. Every other test file that reaches
 * into `supabase/functions/` (e.g. edgeFunctionContract.test.ts, which already
 * dynamically imports all 29) uses the same dynamic-import pattern for this
 * reason.
 */
let islamicSearchTiers: {
  TIER_A_DOMAINS: string[];
  TIER_B_DOMAINS: string[];
  TIER_C_DOMAINS: string[];
  TIER_K_DOMAINS: string[];
  TIER_D_DOMAINS: string[];
  TIER_D_DISCIPLINE: Record<string, string>;
};

beforeAll(async () => {
  islamicSearchTiers = await import("../../supabase/functions/islamic-search/index.ts");
});

function backendDomains(): string[] {
  const { TIER_A_DOMAINS, TIER_B_DOMAINS, TIER_C_DOMAINS, TIER_K_DOMAINS, TIER_D_DOMAINS } = islamicSearchTiers;
  return [...TIER_A_DOMAINS, ...TIER_B_DOMAINS, ...TIER_C_DOMAINS, ...TIER_K_DOMAINS, ...TIER_D_DOMAINS];
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
    return islamicSearchTiers.TIER_D_DISCIPLINE;
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
    // shamela has never been ingested; openiti-index, audited live on
    // 2026-09-04, is a work-level catalogue index (no citation_ref.discipline,
    // no page text) and was removed from DISCIPLINE_DOMAINS. Offering either
    // discipline would repeat the shamela-index mistake this file documents.
    const offered = new Set(Object.values(backendDisciplineMap()));
    expect(offered.has("fiqh")).toBe(false);
    expect(offered.has("nahw")).toBe(false);
  });

  it("does not map any discipline to openiti-index — it is a catalogue, not prose", async () => {
    // Live audit 2026-09-04 (ADR-0014 follow-up / ADR-0028): row-level facts
    // from scholarly_documents — 4,780 `openiti-index` rows, 0 with
    // `citation_ref.discipline`, 0 with a `tags` key. Each row is one
    // transliterated metadata line per OpenITI work, no volume/page, embedded
    // only off that stub. classicalSemanticChannel post-filters on the
    // discipline field, so every openiti row was dropped anyway while the domain
    // stole match slots from the real discipline domains. It must stay out of
    // the map until a real full-text ingest (classical_to_csv.py, domain
    // `openiti`) lands.
    const { DISCIPLINE_DOMAINS } = await import("../../supabase/functions/_shared/disciplines");
    for (const [discipline, domains] of Object.entries(DISCIPLINE_DOMAINS)) {
      expect(domains, `${discipline} still maps to the catalogue-only "openiti-index"`).not.toContain("openiti-index");
    }
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

/**
 * M9 ADR-0022 — the scraping whitelist lives in three places and its own
 * header comment says "keep in sync". It had already drifted:
 * `darulifta-deoband.com` was registered in domain-scrape's DOMAINS but absent
 * from both whitelists, so anything that function returned for it could never
 * be fetched or cited upstream. These two tests make that unfixable-by-accident.
 */
describe("scraping whitelist mirrors", () => {
  const read = async (rel: string) => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    return fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
  };

  /** The `SCRAPING_WHITELIST = [ … ];` literal, verbatim. */
  const arrayLiteral = (src: string) => {
    const start = src.indexOf("SCRAPING_WHITELIST = [");
    expect(start, "SCRAPING_WHITELIST not found").toBeGreaterThan(-1);
    const end = src.indexOf("];", start);
    return src.slice(src.indexOf("[", start), end + 2);
  };

  it("the client copy and the research-query copy are byte-identical", async () => {
    const client = arrayLiteral(await read("src/lib/research/scrapingWhitelist.ts"));
    const edge = arrayLiteral(await read("supabase/functions/research-query/index.ts"));
    expect(edge).toBe(client);
  });

  it("every host domain-scrape can return is whitelisted (DOMAINS ⊆ whitelist)", async () => {
    const { SCRAPING_WHITELIST, isWhitelistedUrl } = await import("../lib/research/scrapingWhitelist");
    const scrapeSrc = await read("supabase/functions/domain-scrape/index.ts");
    // NOT anchored to line start: the compact entries put `host:` mid-line
    // (`alulama: { host: "alulama.org", … }`), and an anchored regex silently
    // matched only half the registry.
    const hosts = [...scrapeSrc.matchAll(/\bhost:\s*"([^"]+)"/g)].map((m) => m[1]);
    const registered = scrapeSrc.slice(scrapeSrc.indexOf("const DOMAINS")).match(/^\s{2}[\w"-]+:\s*\{/gm)?.length ?? 0;
    expect(hosts.length, "parsed fewer hosts than DOMAINS entries — the regex is missing some").toBe(registered);
    const orphans = hosts.filter((h) => !isWhitelistedUrl(`https://${h}/`));
    expect(orphans, `hosts in domain-scrape but not in SCRAPING_WHITELIST (${SCRAPING_WHITELIST.length} entries)`).toEqual([]);
  });
});
