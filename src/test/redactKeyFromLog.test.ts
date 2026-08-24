// @vitest-environment node
// redactKeyFromLog — the last line of defense against a Gemini BYOK API key
// leaking into logs or an error message shown to the user. aiHandlers.ts's
// AI_INVOKE catch block calls this on every error before it reaches the
// renderer or the console; if it misses a key shape, that key is now
// wherever the error text ends up. No electron import here, so no mock needed
// — this is a pure string function.
import { describe, it, expect } from "vitest";
import { redactKeyFromLog } from "../../electron/ai/geminiClient.ts";

// The pattern is `AIzaSy` + exactly 33 further characters — verified below
// rather than trusted by eye, since a fixture one character short of that
// silently never matches at all (which is exactly what happened here on the
// first pass of writing this file: a 31-character suffix made every "real
// key" assertion pass or fail for the wrong reason).
const REAL_LOOKING_KEY = "AIzaSy" + "AbCdEfGhIjKlMnOpQrStUvWxYz0123456";
if (REAL_LOOKING_KEY.length !== 39) {
  throw new Error(`test fixture bug: REAL_LOOKING_KEY must be 39 chars, is ${REAL_LOOKING_KEY.length}`);
}

describe("redactKeyFromLog — the generic pattern match", () => {
  it("redacts a well-formed Gemini key embedded in a longer message", () => {
    const msg = `Request failed with key ${REAL_LOOKING_KEY} — invalid`;
    const redacted = redactKeyFromLog(msg);
    expect(redacted).not.toContain(REAL_LOOKING_KEY);
    expect(redacted).toContain("AIzaSy***REDACTED***");
  });

  it("redacts every occurrence, not just the first", () => {
    const msg = `${REAL_LOOKING_KEY} retried with ${REAL_LOOKING_KEY} again`;
    const redacted = redactKeyFromLog(msg);
    expect(redacted).not.toContain(REAL_LOOKING_KEY);
    expect(redacted.split("AIzaSy***REDACTED***")).toHaveLength(3);
  });

  it("leaves a message with no key untouched", () => {
    const msg = "generic network error, no secrets here";
    expect(redactKeyFromLog(msg)).toBe(msg);
  });

  it("does not touch a string that merely starts with AIzaSy but is the wrong length", () => {
    // The pattern requires exactly 33 trailing chars — this documents that a
    // near-miss (e.g. a truncated key in a log) is NOT matched, so it is not
    // a silent guarantee against every AIzaSy-prefixed string.
    const tooShort = "AIzaSyShort";
    expect(redactKeyFromLog(tooShort)).toBe(tooShort);
  });
});

describe("redactKeyFromLog — the explicit key parameter", () => {
  it("redacts the exact known key even if its shape doesn't match the generic pattern", () => {
    // A BYOK key does not have to look like Google's own format — a user
    // could paste anything into the key field. The explicit `key` param
    // covers that case by literal substitution rather than a shape match.
    const weirdKey = "not-a-real-google-shaped-secret-123";
    const msg = `auth failed for ${weirdKey}`;
    expect(redactKeyFromLog(msg, weirdKey)).not.toContain(weirdKey);
  });

  it("applies both the explicit key and the generic pattern in the same call", () => {
    const weirdKey = "custom-secret-value";
    const msg = `${weirdKey} then later ${REAL_LOOKING_KEY}`;
    const redacted = redactKeyFromLog(msg, weirdKey);
    expect(redacted).not.toContain(weirdKey);
    expect(redacted).not.toContain(REAL_LOOKING_KEY);
  });

  it("does nothing extra when no explicit key is given", () => {
    const msg = "plain message";
    expect(redactKeyFromLog(msg, null)).toBe(msg);
    expect(redactKeyFromLog(msg, undefined)).toBe(msg);
    expect(redactKeyFromLog(msg, "")).toBe(msg);
  });
});
