// @vitest-environment node
// src/lib/tierUpgrade.ts — the upgrade ladder (free → basic → pro → ultra)
// that drives the dashboard's "Upgrade to X" button. Small, but the ladder
// itself is a single source of truth used nowhere else — a typo here quietly
// points every upgrade button at the wrong plan.
import { describe, it, expect } from "vitest";
import { getNextTier, getUpgradeLabelKey } from "../lib/tierUpgrade";

describe("getNextTier — the ladder", () => {
  it.each([
    ["free", "basic"],
    ["basic", "pro"],
    ["pro", "ultra"],
  ])("from %s, the next tier is %s", (current, next) => {
    expect(getNextTier(current)).toBe(next);
  });

  it("returns null at the top of the ladder", () => {
    expect(getNextTier("ultra")).toBeNull();
  });

  it.each([null, undefined, "", "enterprise", "FREE", "Pro"])(
    "returns null for an unrecognized or malformed tier: %o",
    (tier) => {
      expect(getNextTier(tier)).toBeNull();
    },
  );
});

describe("getUpgradeLabelKey", () => {
  it.each([
    ["free", "dashboard.upgrade_to_basic"],
    ["basic", "dashboard.upgrade_to_pro"],
    ["pro", "dashboard.upgrade_to_ultra"],
  ])("from %s, the label key targets %s", (current, key) => {
    expect(getUpgradeLabelKey(current)).toBe(key);
  });

  it("returns null rather than a key naming a nonexistent tier, at the top of the ladder", () => {
    expect(getUpgradeLabelKey("ultra")).toBeNull();
  });

  it("returns null for an unrecognized tier rather than a malformed key", () => {
    // Without the explicit null short-circuit this would produce
    // "dashboard.upgrade_to_null" and the UI would render a raw i18n key.
    expect(getUpgradeLabelKey("not-a-real-tier")).toBeNull();
  });

  it("returns null for a null or undefined tier", () => {
    expect(getUpgradeLabelKey(null)).toBeNull();
    expect(getUpgradeLabelKey(undefined)).toBeNull();
  });
});
