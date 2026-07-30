import { describe, it, expect } from "vitest";
import { computePlacement, type Anchor } from "@/components/editor/useBubblePlacement";

/**
 * The selection toolbar must stay inside the editor area wherever the user
 * clicks. The previous implementation clamped the selection's centre and then
 * shifted the bar by translateX(-50%), so half a wide bar still hung off the
 * edge, and it reserved a fixed 44px above the selection regardless of how
 * tall the bar actually was.
 */

const EDGE = 8;
const base: Anchor = {
  selCenter: 400, selTop: 300, selBottom: 320,
  containerW: 800, containerH: 600, text: "sel",
};
const at = (o: Partial<Anchor>): Anchor => ({ ...base, ...o });

/** The invariant every case has to satisfy. */
function assertInside(p: { top: number; left: number }, a: Anchor, w: number, h: number) {
  expect(p.left).toBeGreaterThanOrEqual(0);
  expect(p.top).toBeGreaterThanOrEqual(0);
  expect(p.left + w).toBeLessThanOrEqual(a.containerW);
  expect(p.top + h).toBeLessThanOrEqual(a.containerH);
}

describe("bubble toolbar placement", () => {
  it("centres the bar on the selection when there is room", () => {
    const p = computePlacement(base, 300, 70);
    expect(p.left).toBe(400 - 150);
    assertInside(p, base, 300, 70);
  });

  it("keeps a wide bar inside the right edge", () => {
    // Selection near the right edge: centring would put the bar at 740..1040.
    const a = at({ selCenter: 790 });
    const p = computePlacement(a, 300, 70);
    expect(p.left).toBe(800 - 300 - EDGE);
    assertInside(p, a, 300, 70);
  });

  it("keeps a wide bar inside the left edge", () => {
    const a = at({ selCenter: 10 });
    const p = computePlacement(a, 300, 70);
    expect(p.left).toBe(EDGE);
    assertInside(p, a, 300, 70);
  });

  it("centres a bar wider than the container instead of overflowing one side", () => {
    const a = at({ containerW: 260, selCenter: 250 });
    const p = computePlacement(a, 300, 70);
    // Cannot fit; overflow must be shared, not dumped on one edge.
    expect(p.left).toBeLessThanOrEqual(0);
    expect(p.left).toBe((260 - 300) / 2 < 0 ? 0 : (260 - 300) / 2);
  });

  it("sits above the selection when it fits", () => {
    const p = computePlacement(base, 300, 70);
    expect(p.top).toBe(300 - 70 - 8);
  });

  it("flips below when a two-row bar does not fit above", () => {
    // 70px tall bar, selection only 40px from the top: no room above.
    const a = at({ selTop: 40, selBottom: 60 });
    const p = computePlacement(a, 300, 70);
    expect(p.top).toBe(60 + 8);
    assertInside(p, a, 300, 70);
  });

  it("does not run past the bottom when flipped below near the end", () => {
    const a = at({ selTop: 10, selBottom: 580, containerH: 600 });
    const p = computePlacement(a, 300, 70);
    assertInside(p, a, 300, 70);
  });

  it("stays inside for a taller bar than the old fixed 44px reserve assumed", () => {
    // The old code reserved 44px above; a 90px two-row bar would have been
    // clipped by the panel's overflow-hidden.
    const a = at({ selTop: 60, selBottom: 80 });
    const p = computePlacement(a, 300, 90);
    assertInside(p, a, 300, 90);
    expect(p.top).toBe(80 + 8); // flipped below rather than clipped above
  });

  it("stays inside across a sweep of selection positions and bar sizes", () => {
    for (const containerW of [360, 480, 800, 1200]) {
      for (const barW of [180, 320, 520]) {
        for (const selCenter of [0, 40, containerW / 2, containerW - 40, containerW]) {
          for (const barH of [36, 70, 96]) {
            const a = at({ containerW, selCenter, containerH: 600 });
            const p = computePlacement(a, barW, barH);
            expect(Number.isFinite(p.left)).toBe(true);
            expect(Number.isFinite(p.top)).toBe(true);
            if (barW <= containerW) assertInside(p, a, barW, barH);
          }
        }
      }
    }
  });
});
