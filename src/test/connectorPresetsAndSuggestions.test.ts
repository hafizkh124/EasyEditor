import { describe, it, expect } from "vitest";
import { CONNECTORS, connectorById, mergeConnectorState } from "~shared/agent/connectors";
import { CONNECTOR_PRESETS, activePresets, presetChanges } from "~shared/agent/connectorPresets";
import { suggestConnectors } from "~shared/agent/connectorSuggestions";

const allOff = Object.fromEntries(CONNECTORS.map((c) => [c.id, false]));

describe("connector presets", () => {
  it("only name connectors that exist", () => {
    for (const p of CONNECTOR_PRESETS) {
      for (const id of p.connectors) expect(connectorById(id), `${p.id} → ${id}`).toBeDefined();
    }
  });

  it("keep the Advanced Shamela transports out of every preset", () => {
    for (const p of CONNECTOR_PRESETS) {
      expect(p.connectors).not.toContain("shamela");
      expect(p.connectors).not.toContain("shamela-cloud");
    }
  });

  it("are additive: they list only what to switch on", () => {
    const research = CONNECTOR_PRESETS.find((p) => p.id === "research")!;
    expect(presetChanges(research, allOff).sort()).toEqual([...research.connectors].sort());
    // A member that is already on is not part of the change.
    expect(presetChanges(research, { ...allOff, hadith: true })).not.toContain("hadith");
  });

  it("reports a preset as active only when every member is on", () => {
    const calc = { ...allOff, zakat: true };
    expect(activePresets(calc)).not.toContain("calculators");
    expect(activePresets({ ...calc, faraid: true })).toContain("calculators");
  });

  it("'everything' covers all non-advanced connectors and nothing else", () => {
    const everything = CONNECTOR_PRESETS.find((p) => p.id === "everything")!;
    const expected = CONNECTORS.filter((c) => !c.advanced).map((c) => c.id).sort();
    expect([...everything.connectors].sort()).toEqual(expected);
  });

  it("the registry defaults still hold: Turath on, Shamela transports flagged advanced", () => {
    const merged = mergeConnectorState(undefined, undefined);
    expect(merged.turath).toBe(true);
    expect(connectorById("shamela")?.advanced).toBe(true);
    expect(connectorById("shamela-cloud")?.advanced).toBe(true);
  });
});

describe("suggestConnectors", () => {
  const off = () => false;

  it("suggests nothing for text too short to mean anything", () => {
    expect(suggestConnectors("hi", off)).toEqual([]);
  });

  it("suggests an off connector the question is about", () => {
    const ids = suggestConnectors("zakat on 5 tola gold and 2 lakh savings?", off);
    expect(ids).toContain("zakat");
  });

  it("does not suggest what is already on", () => {
    const on = (id: string) => id === "zakat";
    expect(suggestConnectors("zakat on 5 tola gold and 2 lakh savings?", on)).not.toContain("zakat");
  });

  it("does not re-offer a dismissed connector", () => {
    expect(suggestConnectors("zakat on 5 tola gold?", off, new Set(["zakat"]))).not.toContain("zakat");
  });

  it("never suggests an Advanced connector and caps the list at two", () => {
    const ids = suggestConnectors("شامله میں زکوٰۃ اور وراثت اور حدیث اور تفسیر اور لغت اور عروض", off);
    expect(ids.length).toBeLessThanOrEqual(2);
    expect(ids).not.toContain("shamela");
    expect(ids).not.toContain("shamela-cloud");
  });
});
