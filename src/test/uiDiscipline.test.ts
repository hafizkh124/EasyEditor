// @vitest-environment node
import { scanChromeDirs } from "../../scripts/check-ui-discipline.mjs";

/**
 * UX-v1 P4 — `scripts/check-ui-discipline.mjs` (SPEC-UIUX §4) only ran under
 * `npm run lint`. The i18n guards next to this file prove the pattern that
 * matters: a discipline rule that lives only in a script developers can skip
 * is a rule that drifts. This runs the exact same scan — `scanChromeDirs` is
 * shared, not reimplemented — inside `npm test` so it ratchets the same way.
 */
describe("UI discipline (SPEC-UIUX §4)", () => {
  it("has no hard violations in chrome components", () => {
    const { hard } = scanChromeDirs();
    const unexpected = hard.map((v) => `${v.file}:${v.line}: ${v.label} — ${v.text}`);
    expect(unexpected).toEqual([]);
  });
});
