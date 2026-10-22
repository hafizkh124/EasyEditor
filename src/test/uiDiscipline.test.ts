// @vitest-environment node
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanChromeDirs } from "../../scripts/check-ui-discipline.mjs";

/**
 * UX-v1 P4 — `scripts/check-ui-discipline.mjs` (SPEC-UIUX §4) only ran under
 * `npm run lint`. The i18n guards next to this file prove the pattern that
 * matters: a discipline rule that lives only in a script developers can skip
 * is a rule that drifts. This runs the exact same scan — `scanChromeDirs` is
 * shared, not reimplemented — inside `npm test` so it ratchets the same way.
 */
describe("UI discipline (SPEC-UIUX §4)", () => {
  it("has no hard violations in the real tree", () => {
    const { hard } = scanChromeDirs();
    const unexpected = hard.map((v) => `${v.file}:${v.line}: ${v.label} — ${v.text}`);
    expect(unexpected).toEqual([]);
  });
});

/**
 * SPEC M10 Phase 0 — the app-wide rules (physical-direction, viewport,
 * fixed-width). Fixture-based: `hard` being empty above proves today's tree
 * is clean, but proves nothing about whether these regexes still DETECT a
 * violation — a silently-broken pattern would also report "empty". These
 * write a synthetic `.tsx` file into a throwaway directory and scan that
 * directory directly, so a real positive case is exercised every run.
 */
describe("UI discipline — app-wide rules (SPEC M10 Phase 0)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ui-discipline-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, contents: string) {
    writeFileSync(join(dir, name), contents, "utf8");
  }

  it("flags a raw status palette colour", () => {
    write("Raw.tsx", `export const Raw = () => <span className="bg-emerald-500/10 text-amber-700" />;`);
    const { hard } = scanChromeDirs([], [], [dir]);
    expect(hard.some((v) => v.label.includes("raw status colour"))).toBe(true);
  });

  it("does not flag the semantic status families", () => {
    write("Semantic.tsx", `export const Ok = () => <span className="bg-success-soft text-warning border-destructive-border bg-violet-500" />;`);
    const { hard } = scanChromeDirs([], [], [dir]);
    expect(hard).toEqual([]);
  });

  it("flags a physical-direction utility", () => {
    write("Bad.tsx", `export const Bad = () => <div className="mr-2 text-left" />;`);
    const { hard } = scanChromeDirs([], [dir]);
    expect(hard.some((v) => v.label.includes("physical-direction"))).toBe(true);
  });

  it("does not flag ms-/me-/start-/end- logical utilities", () => {
    write("Good.tsx", `export const Good = () => <div className="ms-2 text-start" />;`);
    const { hard } = scanChromeDirs([], [dir]);
    expect(hard).toEqual([]);
  });

  it("honours a same-line `/* physical: ... */` exemption", () => {
    write("Exempt.tsx", `export const Exempt = () => <div className="pr-[140px]" />; /* physical: Electron caption bar */`);
    const { hard } = scanChromeDirs([], [dir]);
    expect(hard).toEqual([]);
  });

  it("flags h-screen/w-screen but not min-h-screen/max-h-screen", () => {
    write("Screen.tsx", [
      `export const A = () => <div className="h-screen w-screen" />;`,
      `export const B = () => <div className="min-h-screen max-h-screen" />;`,
    ].join("\n"));
    const { hard } = scanChromeDirs([], [dir]);
    const viewportHits = hard.filter((v) => v.label.includes("h-screen/w-screen"));
    // One entry per offending LINE (same convention as every other rule here),
    // not one per occurrence — line 1 has both h-screen and w-screen but
    // still reports once; line 2's min-/max- variants report zero times.
    expect(viewportHits).toHaveLength(1);
    expect(viewportHits[0].line).toBe(1);
  });

  it("flags a literal 100vh", () => {
    write("Vh.tsx", `export const V = () => <div style={{ height: "100vh" }} />;`);
    const { hard } = scanChromeDirs([], [dir]);
    expect(hard.some((v) => v.label.includes("100vh") || v.label.includes("h-screen/w-screen"))).toBe(true);
  });

  it("soft-warns on a fixed width with no breakpoint, but not with one", () => {
    write("Width.tsx", [
      `export const A = () => <div className="w-64" />;`,
      `export const B = () => <div className="md:w-64" />;`,
    ].join("\n"));
    const { soft } = scanChromeDirs([], [dir]);
    const widthHits = soft.filter((v) => v.label.includes("fixed width"));
    expect(widthHits).toHaveLength(1);
    expect(widthHits[0].line).toBe(1);
  });

  it("keeps font-serif/border-2/spacing scoped to chrome dirs, not app-wide ones", () => {
    // A marketing/legal-page emphasis border must NOT be treated as an
    // elevation violation just because the scan now reaches src/pages —
    // that is the exact PricingInfo.tsx/OCR.tsx/PendingApproval.tsx case
    // this scope split exists to avoid re-litigating.
    write("Marketing.tsx", `export const M = () => <div className="border-2 font-serif p-5" />;`);
    const { hard, soft } = scanChromeDirs([], [dir]); // dir is NOT in chromeDirs
    expect(hard).toEqual([]);
    expect(soft).toEqual([]);
  });
});
