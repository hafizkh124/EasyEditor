import { describe, it, expect } from "vitest";
import { formatDateFor } from "@/lib/formatDate";

describe("formatDateFor", () => {
  const d = "2026-10-22T10:00:00Z";

  it("follows the app language, not the browser's", () => {
    expect(formatDateFor("en", d)).toBe("Oct 22");
    expect(formatDateFor("ur", d)).not.toBe("Oct 22");
    expect(formatDateFor("ur", d)).toMatch(/22/);
    expect(formatDateFor("ar", d)).not.toBe("Oct 22");
  });

  it("keeps Latin digits and the Gregorian year", () => {
    expect(formatDateFor("ar", d, "date")).toMatch(/2026/);
    expect(formatDateFor("ur", d, "date")).toMatch(/2026/);
  });

  it("returns an empty string for an invalid date instead of 'Invalid Date'", () => {
    expect(formatDateFor("ur", "not a date")).toBe("");
  });
});
