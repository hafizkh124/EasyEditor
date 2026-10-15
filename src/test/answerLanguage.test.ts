// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { detectQuestionLanguage, languageInstruction } from "~shared/research/answerLanguage";
import { buildSystemPrompt, buildWebSystemPrompt } from "~shared/agent/systemPrompt";

describe("detectQuestionLanguage", () => {
  it.each([
    ["إنما الأعمال بالنيات", "arabic"],
    ["كلمتان خفيفتان على اللسان", "arabic"],
    ["من كذب علي متعمدا", "arabic"],
    ["پڑوسی کے حقوق", "urdu"],
    ["والدین کے ساتھ حسنِ سلوک کی احادیث", "urdu"],
    ["ابو ہریرہؓ کی روایات کی تعداد", "urdu"],
    ["What does the hadith about intentions mean?", "english"],
  ])("%s -> %s", (q, lang) => {
    expect(detectQuestionLanguage(q)).toBe(lang);
  });

  it("an Urdu sentence quoting an Arabic phrase is Urdu", () => {
    expect(detectQuestionLanguage("إنما الأعمال بالنيات کا مطلب کیا ہے؟")).toBe("urdu");
  });

  it("says null rather than guessing", () => {
    expect(detectQuestionLanguage("")).toBeNull();
    expect(detectQuestionLanguage("12345")).toBeNull();
    expect(detectQuestionLanguage(undefined)).toBeNull();
    // Arabic-script words with no letter that separates Urdu from Arabic
    expect(detectQuestionLanguage("نماز")).toBeNull();
  });
});

describe("languageInstruction", () => {
  it("names the detected language and lets an explicit request win", () => {
    const text = languageInstruction("إنما الأعمال بالنيات");
    expect(text).toContain("Arabic");
    expect(text).toContain("explicitly asks");
    expect(text).toContain("اردو میں بتائیں");
    expect(text).toContain("original language");
  });
  it("falls back to the general rule when it cannot tell", () => {
    const text = languageInstruction(null);
    expect(text).toContain("language of the scholar's question");
    expect(text).toContain("explicitly asks");
  });
});

describe("where the rule is applied", () => {
  it("both agent system prompts carry it (the Ask-mode prompt had no language rule)", () => {
    const desktop = buildSystemPrompt({ mode: "ask", capabilities: { word: false }, chapters: [] } as never);
    const web = buildWebSystemPrompt({ mode: "ask" } as never);
    for (const p of [desktop, web]) {
      expect(p).toContain("LANGUAGE:");
      expect(p).toContain("explicitly asks");
    }
  });

  it("islamic-search tells the model the detected language instead of the old one-liner", () => {
    const src = readFileSync("supabase/functions/islamic-search/index.ts", "utf8");
    expect(src).toContain("${languageInstruction(question)}");
    expect(src).not.toContain("Respond in the same language as the user's question (Arabic / English / Urdu)");
    expect(src).toContain("effectiveStrictMode, countBlock.length > 0, query)");
  });
});
