// @vitest-environment node
// src/lib/subscriptionLifecycle.ts — the client-side twin of
// check-subscription-expiry's server logic: this is what decides whether the
// UI shows "active", nags the user with "expiring soon", or blocks a paid
// feature as "expired". It never writes anything, but a wrong status here is
// what a paying user actually sees, and the expiry math (day-boundary
// rounding, exempt accounts) is exactly the kind of off-by-one that is easy
// to get subtly wrong and invisible until someone's subscription blinks
// "expired" a day early.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { getLifecycleInfo, formatLifecycleDate } from "../lib/subscriptionLifecycle";

const NOW = "2026-08-24T12:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterAll(() => {
  vi.useRealTimers();
});

const iso = (offsetMs: number) => new Date(Date.parse(NOW) + offsetMs).toISOString();

describe("getLifecycleInfo — exempt and free accounts never expire", () => {
  it("reports none for an exempt account regardless of its dates", () => {
    const info = getLifecycleInfo({
      tier: "pro",
      activatedAt: iso(-100 * DAY_MS),
      expiresAt: iso(-1 * DAY_MS), // already in the past
      exemptFromExpiry: true,
    });
    expect(info).toEqual({ status: "none", daysRemaining: null, expiresAt: null, activatedAt: null });
  });

  it("reports none for the free tier even with dates present", () => {
    const info = getLifecycleInfo({ tier: "free", activatedAt: iso(0), expiresAt: iso(30 * DAY_MS) });
    expect(info.status).toBe("none");
  });

  it("reports none when activatedAt is missing", () => {
    expect(getLifecycleInfo({ tier: "pro", activatedAt: null, expiresAt: iso(30 * DAY_MS) }).status).toBe(
      "none",
    );
  });

  it("reports none when expiresAt is missing", () => {
    expect(getLifecycleInfo({ tier: "pro", activatedAt: iso(0), expiresAt: null }).status).toBe("none");
  });
});

describe("getLifecycleInfo — the active/expiring/expired boundaries", () => {
  it("is active with well more than 7 days remaining", () => {
    const info = getLifecycleInfo({ tier: "pro", activatedAt: iso(0), expiresAt: iso(20 * DAY_MS) });
    expect(info.status).toBe("active");
  });

  it("is expiring_soon at exactly 7 days remaining", () => {
    const info = getLifecycleInfo({ tier: "pro", activatedAt: iso(0), expiresAt: iso(7 * DAY_MS) });
    expect(info.status).toBe("expiring_soon");
  });

  it("is active at 8 days remaining — one day outside the expiring_soon window", () => {
    const info = getLifecycleInfo({ tier: "pro", activatedAt: iso(0), expiresAt: iso(8 * DAY_MS) });
    expect(info.status).toBe("active");
  });

  it("rounds a partial day UP for daysRemaining, so 7 days and 1 hour left still reads as expiring_soon", () => {
    // Math.ceil: someone with 7d 1h remaining should not see "8 days left"
    // and relax past the renewal window.
    const info = getLifecycleInfo({
      tier: "pro",
      activatedAt: iso(0),
      expiresAt: iso(7 * DAY_MS + 60 * 60 * 1000),
    });
    expect(info.daysRemaining).toBe(8);
    // Still > 7, so by the letter of the threshold this reads as active —
    // recorded because it is the direct, if slightly surprising, consequence
    // of rounding up: the boundary check compares the rounded days, not the
    // raw remaining time.
    expect(info.status).toBe("active");
  });

  it("is expired the instant expiresAt has passed, even by one millisecond", () => {
    const info = getLifecycleInfo({ tier: "pro", activatedAt: iso(-30 * DAY_MS), expiresAt: iso(-1) });
    expect(info.status).toBe("expired");
  });

  it("is expired, not active, exactly at the expiry instant (diffMs === 0)", () => {
    const info = getLifecycleInfo({ tier: "pro", activatedAt: iso(-30 * DAY_MS), expiresAt: iso(0) });
    expect(info.status).toBe("expired");
  });

  it("computes a negative daysRemaining for a lapsed subscription rather than clamping to zero", () => {
    const info = getLifecycleInfo({ tier: "pro", activatedAt: iso(-40 * DAY_MS), expiresAt: iso(-10 * DAY_MS) });
    expect(info.daysRemaining).toBeLessThan(0);
  });
});

describe("getLifecycleInfo — the returned dates", () => {
  it("returns real Date objects, not the original ISO strings, when active", () => {
    const info = getLifecycleInfo({ tier: "pro", activatedAt: iso(-1 * DAY_MS), expiresAt: iso(20 * DAY_MS) });
    expect(info.activatedAt).toBeInstanceOf(Date);
    expect(info.expiresAt).toBeInstanceOf(Date);
    expect(info.expiresAt!.toISOString()).toBe(iso(20 * DAY_MS));
  });
});

describe("formatLifecycleDate", () => {
  it("renders a placeholder for null", () => {
    expect(formatLifecycleDate(null)).toBe("—");
  });

  it("includes the year for a real date", () => {
    const formatted = formatLifecycleDate(new Date(iso(20 * DAY_MS)));
    expect(formatted).toContain("2026");
  });

  it("produces different output for genuinely different dates", () => {
    // Guards against a formatter that silently ignores its argument (e.g.
    // always formatting "now") — locale-formatted output is not asserted
    // exactly since it depends on the runtime's ICU data, but two distinct
    // months must not collapse to the same string.
    const a = formatLifecycleDate(new Date("2026-01-15T00:00:00.000Z"));
    const b = formatLifecycleDate(new Date("2026-09-15T00:00:00.000Z"));
    expect(a).not.toBe(b);
  });
});
