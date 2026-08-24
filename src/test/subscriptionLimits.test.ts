// @vitest-environment node
import { describe, it, expect } from "vitest";

/**
 * Unit tests for subscription limit logic.
 * These mirror the checks done in edge functions (transcribe, google-tts, process-ocr).
 */

interface Subscription {
  tier: "free" | "pro";
  transcription_seconds_used: number;
  transcription_limit: number;
  tts_characters_used: number;
  tts_character_limit: number;
}

function canTranscribe(sub: Subscription, durationSeconds: number): boolean {
  if (sub.tier === "pro") return true;
  return sub.transcription_seconds_used + durationSeconds <= sub.transcription_limit;
}

function canUseTts(sub: Subscription, charCount: number): boolean {
  if (sub.tier === "pro") return true;
  return sub.tts_characters_used + charCount <= sub.tts_character_limit;
}

const OCR_COST_SECONDS = 10;

function canUseOcr(sub: Subscription): boolean {
  if (sub.tier === "pro") return true;
  return sub.transcription_seconds_used + OCR_COST_SECONDS <= sub.transcription_limit;
}

describe("Transcription limits", () => {
  const baseFreeSub: Subscription = {
    tier: "free",
    transcription_seconds_used: 0,
    transcription_limit: 300,
    tts_characters_used: 0,
    tts_character_limit: 2000,
  };

  it("allows transcription within free limit", () => {
    expect(canTranscribe(baseFreeSub, 60)).toBe(true);
  });

  it("allows transcription exactly at free limit", () => {
    const sub = { ...baseFreeSub, transcription_seconds_used: 250 };
    expect(canTranscribe(sub, 50)).toBe(true);
  });

  it("blocks transcription that would exceed free limit", () => {
    const sub = { ...baseFreeSub, transcription_seconds_used: 280 };
    expect(canTranscribe(sub, 30)).toBe(false);
  });

  it("always allows transcription on pro tier regardless of usage", () => {
    const proSub: Subscription = { ...baseFreeSub, tier: "pro", transcription_seconds_used: 99999 };
    expect(canTranscribe(proSub, 3600)).toBe(true);
  });
});

describe("TTS character limits", () => {
  const baseFreeSub: Subscription = {
    tier: "free",
    transcription_seconds_used: 0,
    transcription_limit: 300,
    tts_characters_used: 0,
    tts_character_limit: 2000,
  };

  it("allows TTS within free limit", () => {
    expect(canUseTts(baseFreeSub, 500)).toBe(true);
  });

  it("blocks TTS that would exceed free limit", () => {
    const sub = { ...baseFreeSub, tts_characters_used: 1900 };
    expect(canUseTts(sub, 200)).toBe(false);
  });

  it("always allows TTS on pro tier", () => {
    const proSub: Subscription = { ...baseFreeSub, tier: "pro", tts_characters_used: 999999 };
    expect(canUseTts(proSub, 10000)).toBe(true);
  });
});

describe("OCR limits (shared transcription budget)", () => {
  const baseFreeSub: Subscription = {
    tier: "free",
    transcription_seconds_used: 0,
    transcription_limit: 300,
    tts_characters_used: 0,
    tts_character_limit: 2000,
  };

  it("allows OCR when budget is available", () => {
    expect(canUseOcr(baseFreeSub)).toBe(true);
  });

  it("blocks OCR when budget is too low for OCR cost (10 seconds)", () => {
    const sub = { ...baseFreeSub, transcription_seconds_used: 295 };
    expect(canUseOcr(sub)).toBe(false);
  });

  it("always allows OCR on pro tier", () => {
    const proSub: Subscription = { ...baseFreeSub, tier: "pro", transcription_seconds_used: 9999 };
    expect(canUseOcr(proSub)).toBe(true);
  });
});
