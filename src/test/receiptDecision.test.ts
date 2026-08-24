// @vitest-environment node
// The auto-approval decision for payment receipts — previously untested, and
// the only branch in the codebase that grants a paid tier with no human in the
// loop. Every case below is written from the perspective of "what would it cost
// us if this went the wrong way".
//
// Two directions of failure, and they are not symmetric:
//   - a false MANUAL_REVIEW costs the user a wait and us an admin click;
//   - a false AUTO_APPROVE gives away a paid tier and a token allocation.
// So the bias throughout is: when the receipt is not clearly readable and
// clearly correct, it must land in manual review.
import { describe, it, expect } from "vitest";
import {
  decideActivation,
  amountMatches,
  receiverMatches,
  TIER_PRICES_PKR,
  CONFIDENCE_THRESHOLD,
  MIN_RECEIVER_SUBSTRING_LENGTH,
  VALID_RECEIVERS,
  type AIResult,
  type PaidTier,
} from "../../supabase/functions/_shared/receiptDecision";

/** A receipt that should sail through, so each test can spoil exactly one thing. */
const goodReceipt = (over: Partial<AIResult> = {}): AIResult => ({
  confidence: 97,
  amount: TIER_PRICES_PKR.pro,
  receiver: "Hafiz Khizar Hayat",
  txnId: "TXN123456",
  date: "2026-08-24",
  tampered: false,
  reasons: [],
  ...over,
});

describe("decideActivation — the happy path", () => {
  it.each(["basic", "pro", "ultra"] as PaidTier[])(
    "auto-approves a clean receipt for the %s tier at its exact price",
    (tier) => {
      const d = decideActivation(goodReceipt({ amount: TIER_PRICES_PKR[tier] }), tier);
      expect(d.action).toBe("auto_approve");
      expect(d.failed).toEqual([]);
      expect(d.expectedPkr).toBe(TIER_PRICES_PKR[tier]);
    },
  );

  it("reports every check as passed so the audit trail is complete", () => {
    // aiDetails.checks is written to subscriptions.ai_verification_details and is
    // what an admin reads when a decision is questioned later.
    expect(decideActivation(goodReceipt(), "pro").checks).toEqual({
      amount_matches: true,
      receiver_matches: true,
      confidence_meets_threshold: true,
      tampered: false,
    });
  });
});

describe("decideActivation — confidence threshold", () => {
  it("is inclusive at exactly the threshold", () => {
    expect(decideActivation(goodReceipt({ confidence: CONFIDENCE_THRESHOLD }), "pro").action)
      .toBe("auto_approve");
  });

  it("rejects immediately below the threshold", () => {
    const d = decideActivation(goodReceipt({ confidence: CONFIDENCE_THRESHOLD - 0.1 }), "pro");
    expect(d.action).toBe("manual_review");
    expect(d.failed).toContain("low_confidence");
  });

  it.each([NaN, Infinity, -Infinity, null, undefined, "99" as unknown])(
    "routes a non-numeric confidence (%o) to manual review rather than trusting it",
    (confidence) => {
      const d = decideActivation(goodReceipt({ confidence: confidence as number }), "pro");
      expect(d.action).toBe("manual_review");
      expect(d.failed).toContain("low_confidence");
    },
  );
});

describe("decideActivation — amount", () => {
  it("allows the 50 PKR floor on the cheapest tier", () => {
    // 2% of 1,400 is 28, so the floor is what actually applies here.
    expect(amountMatches(TIER_PRICES_PKR.basic - 50, TIER_PRICES_PKR.basic)).toBe(true);
    expect(amountMatches(TIER_PRICES_PKR.basic - 51, TIER_PRICES_PKR.basic)).toBe(false);
  });

  it("allows the 2% band on the most expensive tier", () => {
    // 2% of 8,400 is 168, which is larger than the floor.
    expect(amountMatches(TIER_PRICES_PKR.ultra - 168, TIER_PRICES_PKR.ultra)).toBe(true);
    expect(amountMatches(TIER_PRICES_PKR.ultra - 169, TIER_PRICES_PKR.ultra)).toBe(false);
  });

  it("never approves a receipt for a cheaper tier than the one being bought", () => {
    // Paying the basic price and asking for ultra is the obvious attack.
    const d = decideActivation(goodReceipt({ amount: TIER_PRICES_PKR.basic }), "ultra");
    expect(d.action).toBe("manual_review");
    expect(d.failed).toContain("amount_mismatch");
  });

  it.each([null, undefined, NaN, Infinity])(
    "treats an unreadable amount (%o) as a mismatch, not as a pass",
    (amount) => {
      const d = decideActivation(goodReceipt({ amount: amount as number }), "pro");
      expect(d.action).toBe("manual_review");
      expect(d.failed).toContain("amount_mismatch");
    },
  );

  it("does not accept a negative amount that happens to be within tolerance of nothing", () => {
    expect(amountMatches(-TIER_PRICES_PKR.pro, TIER_PRICES_PKR.pro)).toBe(false);
  });
});

describe("receiverMatches — the accounts we actually own", () => {
  it.each(VALID_RECEIVERS)("accepts the exact known receiver %s", (r) => {
    expect(receiverMatches(r)).toBe(true);
  });

  it("accepts a receipt line that embeds a known account", () => {
    expect(receiverMatches("Transfer to Hafiz Khizar Hayat (00420745)")).toBe(true);
    expect(receiverMatches("IBAN: PK04NBPA1997004243449556")).toBe(true);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(receiverMatches("  hafiz khizar hayat  ")).toBe(true);
    expect(receiverMatches("AL-ULAMA")).toBe(true);
  });

  it("rejects an unrelated payee", () => {
    expect(receiverMatches("Muhammad Ali")).toBe(false);
    expect(receiverMatches("Some Other Company Ltd")).toBe(false);
  });
});

describe("receiverMatches — the short-fragment hole", () => {
  // These are the cases the original bidirectional `includes` accepted. Each one
  // is a receipt we could not actually read being treated as one paid to us.
  it.each([
    ["", "empty string is a substring of every account"],
    ["   ", "whitespace only"],
    ["0", "single digit, contained by 00420745"],
    ["00", "two digits"],
    ["042", "three digits"],
    ["a", "single letter, contained by Al-Ulama"],
    ["ul", "two letters"],
    ["0308", "a real prefix, but far too short to identify an account"],
  ])("rejects %o (%s)", (receiver) => {
    expect(receiverMatches(receiver)).toBe(false);
  });

  it("still accepts a fragment once it is long enough to be distinctive", () => {
    const fragment = "0042074"; // 7 chars, inside "00420745"
    expect(fragment.length).toBeGreaterThanOrEqual(MIN_RECEIVER_SUBSTRING_LENGTH);
    expect(receiverMatches(fragment)).toBe(true);
  });

  it("draws the line exactly at MIN_RECEIVER_SUBSTRING_LENGTH", () => {
    const known = "03084164816";
    const tooShort = known.slice(0, MIN_RECEIVER_SUBSTRING_LENGTH - 1);
    const justLong = known.slice(0, MIN_RECEIVER_SUBSTRING_LENGTH);
    expect(receiverMatches(tooShort)).toBe(false);
    expect(receiverMatches(justLong)).toBe(true);
  });

  it.each([null, undefined, 42 as unknown, {} as unknown])(
    "rejects a non-string receiver (%o) without throwing",
    (receiver) => {
      expect(() => receiverMatches(receiver as string)).not.toThrow();
      expect(receiverMatches(receiver as string)).toBe(false);
    },
  );

  it("does not auto-approve an otherwise-perfect receipt with an unreadable receiver", () => {
    // The full regression: high confidence, exact amount, not tampered — and
    // the receiver field came back as a single character.
    const d = decideActivation(goodReceipt({ receiver: "0" }), "pro");
    expect(d.action).toBe("manual_review");
    expect(d.failed).toContain("receiver_mismatch");
  });
});

describe("decideActivation — tampering", () => {
  it("refuses a receipt flagged as tampered even when everything else is perfect", () => {
    const d = decideActivation(goodReceipt({ tampered: true }), "pro");
    expect(d.action).toBe("manual_review");
    expect(d.failed).toContain("tampered");
  });

  it("only treats an explicit `true` as tampered", () => {
    // A model that omits the field must not be read as "definitely tampered"
    // (that would send every receipt to manual review) nor crash.
    expect(decideActivation(goodReceipt({ tampered: undefined as unknown as boolean }), "pro").action)
      .toBe("auto_approve");
  });
});

describe("decideActivation — failing closed", () => {
  it("routes an unknown tier to manual review instead of throwing", () => {
    const d = decideActivation(goodReceipt(), "enterprise" as PaidTier);
    expect(d.action).toBe("manual_review");
    expect(d.failed).toContain("unknown_tier");
  });

  it("survives a completely empty AI result", () => {
    const d = decideActivation({} as AIResult, "pro");
    expect(d.action).toBe("manual_review");
    expect(d.failed).toEqual(
      expect.arrayContaining(["low_confidence", "amount_mismatch", "receiver_mismatch"]),
    );
  });

  it("survives a null AI result", () => {
    expect(() => decideActivation(null as unknown as AIResult, "pro")).not.toThrow();
    expect(decideActivation(null as unknown as AIResult, "pro").action).toBe("manual_review");
  });

  it("lists every reason it declined, not just the first", () => {
    const d = decideActivation(
      { confidence: 10, amount: 1, receiver: "nobody", tampered: true },
      "pro",
    );
    expect(d.failed).toEqual(
      expect.arrayContaining(["low_confidence", "amount_mismatch", "receiver_mismatch", "tampered"]),
    );
  });
});
