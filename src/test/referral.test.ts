// referral.ts touches window.location.origin and localStorage, so this file
// stays on the default jsdom environment rather than opting into node like
// the rest of this round — the one function that needs a real Supabase call
// (applyPendingReferral) takes its client as a parameter, so the fake plugs
// in the same way it does everywhere else regardless of environment.
//
// The property that matters most here: applyPendingReferral is explicitly
// documented as idempotent — "won't overwrite an existing referred_by" — and
// self-referral must be rejected. Both are the kind of one-line guard that
// silently stops mattering if a future edit drops the `.is("referred_by",
// null)` filter or the self-referral check.
import { describe, it, expect, beforeEach } from "vitest";
import {
  REFERRAL_CREDIT_AMOUNT,
  REFERRAL_PARAM,
  buildReferralLink,
  stashPendingReferralCode,
  consumePendingReferralCode,
  applyPendingReferral,
} from "../lib/referral";
import { createFakeClient } from "./helpers/fakeSupabase";

// applyPendingReferral itself types its supabase parameter as `any`, so the
// cast here just matches that boundary rather than introducing a new one.
const asClient = (c: unknown) => c as Parameters<typeof applyPendingReferral>[2];

describe("constants", () => {
  it("REFERRAL_CREDIT_AMOUNT is a positive, whole number of credits", () => {
    expect(Number.isInteger(REFERRAL_CREDIT_AMOUNT)).toBe(true);
    expect(REFERRAL_CREDIT_AMOUNT).toBeGreaterThan(0);
  });

  it("REFERRAL_PARAM matches what buildReferralLink actually emits", () => {
    // Not tautological with the test below — this guards the two staying in
    // sync if either is edited independently.
    const link = buildReferralLink("abc123");
    expect(new URL(link).searchParams.has(REFERRAL_PARAM)).toBe(true);
  });
});

describe("buildReferralLink", () => {
  it("builds a signup URL carrying the code under the referral param", () => {
    const link = buildReferralLink("ABC123");
    const url = new URL(link);
    expect(url.pathname).toBe("/signup");
    expect(url.searchParams.get("ref")).toBe("ABC123");
  });

  it("URL-encodes a code containing special characters", () => {
    const link = buildReferralLink("a b/c&d");
    expect(new URL(link).searchParams.get("ref")).toBe("a b/c&d"); // URL decodes it back
    expect(link).not.toContain("a b/c&d"); // but the raw link string is encoded
  });

  it("uses the current page's origin", () => {
    const link = buildReferralLink("code");
    expect(link.startsWith(window.location.origin)).toBe(true);
  });
});

describe("stashPendingReferralCode / consumePendingReferralCode", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a stashed code through consume", () => {
    stashPendingReferralCode("MYCODE");
    expect(consumePendingReferralCode()).toBe("MYCODE");
  });

  it("consume is destructive — a second call finds nothing", () => {
    stashPendingReferralCode("MYCODE");
    consumePendingReferralCode();
    expect(consumePendingReferralCode()).toBeNull();
  });

  it("returns null when nothing was ever stashed", () => {
    expect(consumePendingReferralCode()).toBeNull();
  });

  it("a later stash overwrites an earlier, unconsumed one", () => {
    stashPendingReferralCode("FIRST");
    stashPendingReferralCode("SECOND");
    expect(consumePendingReferralCode()).toBe("SECOND");
  });

  it("does not throw when localStorage.setItem fails (privacy mode)", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("blocked");
    };
    try {
      expect(() => stashPendingReferralCode("X")).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it("does not throw and returns null when localStorage.getItem fails", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new DOMException("blocked");
    };
    try {
      expect(consumePendingReferralCode()).toBeNull();
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});

describe("applyPendingReferral", () => {
  it("does nothing when the code is empty", async () => {
    const client = createFakeClient({ tables: { profiles: [{ user_id: "referrer-1", referral_code: "X" }] } });
    await applyPendingReferral("new-user", "", asClient(client));
    expect(client.reads).toEqual([]);
    expect(client.writes).toEqual([]);
  });

  it("does nothing when newUserId is empty", async () => {
    const client = createFakeClient({ tables: { profiles: [] } });
    await applyPendingReferral("", "CODE", asClient(client));
    expect(client.reads).toEqual([]);
  });

  it("links the new user to the referrer when the code resolves", async () => {
    const client = createFakeClient({
      tables: { profiles: [{ user_id: "referrer-1", referral_code: "CODE123" }] },
    });
    await applyPendingReferral("new-user", "CODE123", asClient(client));

    const [write] = client.writesTo("profiles");
    expect(write.payload).toEqual({ referred_by: "referrer-1" });
    expect(write.filters).toContainEqual({ column: "user_id", value: "new-user" });
  });

  it("only writes to rows where referred_by is currently NULL — idempotent, never overwrites", async () => {
    const client = createFakeClient({
      tables: { profiles: [{ user_id: "referrer-1", referral_code: "CODE123" }] },
    });
    await applyPendingReferral("new-user", "CODE123", asClient(client));

    const [write] = client.writesTo("profiles");
    expect(write.filters).toContainEqual({ column: "referred_by", value: null });
  });

  it("does nothing when the code does not resolve to any referrer", async () => {
    const client = createFakeClient({ tables: { profiles: [] } });
    await applyPendingReferral("new-user", "no-such-code", asClient(client));
    expect(client.writes).toEqual([]);
  });

  it("refuses a self-referral — a user cannot credit themselves", async () => {
    const client = createFakeClient({
      tables: { profiles: [{ user_id: "same-user", referral_code: "OWNCODE" }] },
    });
    await applyPendingReferral("same-user", "OWNCODE", asClient(client));
    expect(client.writes).toEqual([]);
  });
});
