import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CitationPanel from "@/components/research/CitationPanel";
import { withoutUiOnly } from "~shared/agent/loop";
import { citationsFromToolCalls } from "~shared/agent/citationsFromToolCalls";
import { buildBibliographyMarkdown } from "@/lib/research/bibliography";
import { passageForClient } from "../../supabase/functions/islamic-search/index";

vi.mock("@/contexts/LanguageContext", () => ({ useLanguage: () => ({ language: "ur", t: (_k: string, f?: string) => f ?? _k }) }));
const t = ((_k: string, fallback?: string) => fallback ?? _k) as never;

const item = (n: number, extra = false) => ({
  domain: "hadith-json",
  citation_ref: { collection: "bukhari", hadith_number: String(n) },
  content_ar: `نص الحديث رقم ${n}`,
  ...(extra ? { extra: true } : {}),
});

describe("more results (search-quality phase 2.10)", () => {
  it("the panel counts and numbers only the real sources and folds the extras behind a button", () => {
    const cites = [item(1), item(2), item(11, true), item(12, true)];
    render(<CitationPanel citations={cites} t={t} />);
    expect(screen.getByText("نص الحديث رقم 1")).toBeTruthy();
    expect(screen.queryByText("نص الحديث رقم 11")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /مزید 2 نتائج دکھائیں/ }));
    expect(screen.getByText("نص الحديث رقم 11")).toBeTruthy();
    // numbering carries on after the real ones
    expect(screen.getByText("[3]")).toBeTruthy();
    expect(screen.getByText("[4]")).toBeTruthy();
  });

  it("no button when there are no extras", () => {
    render(<CitationPanel citations={[item(1)]} t={t} />);
    expect(screen.queryByRole("button", { name: /مزید/ })).toBeNull();
  });

  it("the model never sees ui_more", () => {
    const result = { count: 1, results: [{ id: "a" }], ui_more: [{ reference: "x" }] };
    expect(withoutUiOnly(result)).toEqual({ count: 1, results: [{ id: "a" }] });
    expect(withoutUiOnly({ count: 1 })).toEqual({ count: 1 });
    expect(withoutUiOnly("plain")).toBe("plain");
    expect(withoutUiOnly(null)).toBeNull();
  });

  it("the panel reads ui_more as browse-only extras", () => {
    const out = citationsFromToolCalls([
      { name: "search_hadith", result: { results: [{ id: "a", reference: "بخاری 1", excerpt: "ن" }], ui_more: [{ reference: "مسلم 1907", excerpt_ar: "نص" }] } },
    ]);
    expect(out.map((c) => !!c.extra)).toEqual([false, true]);
    expect(out[1].content_ar).toBe("نص");
  });

  it("extras are left out of a bibliography", () => {
    const md = buildBibliographyMarkdown([item(1), item(11, true)]);
    expect(md).toContain("1");
    expect(md).not.toContain("11");
  });

  it("islamic-search ranks for the display list but gives the model only the first ten", () => {
    const src = readFileSync("supabase/functions/islamic-search/index.ts", "utf8");
    expect(src).toContain("maxResults: DISPLAY_SOURCES");
    expect(src).toContain("allResults = allResults.slice(0, MODEL_SOURCES)");
    expect(src).toContain("more_citations: moreResults.map");
    const model = src.indexOf("const contextBlock = buildContextBlock(allResults)");
    const slice = src.indexOf("allResults = allResults.slice(0, MODEL_SOURCES)");
    expect(slice).toBeGreaterThan(0);
    expect(model).toBeGreaterThan(slice); // the context block is built from the trimmed list
  });

  it("extra passages are cut shorter than the main ones", () => {
    const long = "ا".repeat(2000);
    expect(passageForClient(long, 600)!.length).toBeLessThanOrEqual(601);
    expect(passageForClient(long)!.length).toBeGreaterThan(600);
  });
});

describe("sources before the answer (search-quality phase 2.11)", () => {
  it("both agent cards render the sources panel above the answer text", () => {
    const src = readFileSync("src/components/research/ChatDisplay.tsx", "utf8");
    const turnPanel = src.indexOf("<CitationPanel citations={citationsFromToolCalls(turn.result.toolCalls)}");
    const turnAnswer = src.indexOf("{answerText}");
    expect(turnPanel).toBeGreaterThan(0);
    expect(turnPanel).toBeLessThan(turnAnswer);

    const runPanel = src.indexOf("<CitationPanel citations={citationsFromToolCalls(agent.result.toolCalls)}");
    const runAnswer = src.indexOf("{agent.result.answer || t(\"agent.no_answer\"");
    expect(runPanel).toBeGreaterThan(0);
    expect(runPanel).toBeLessThan(runAnswer);
    // and exactly one panel per card (no leftover duplicate below the answer)
    expect(src.match(/<CitationPanel citations=\{citationsFromToolCalls/g)).toHaveLength(2);
  });
});
