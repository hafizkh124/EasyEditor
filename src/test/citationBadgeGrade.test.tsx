import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * UX-v1 P5 / STRATEGY-v1 P2 — CitationBadge used to fold `citation_ref.grade`
 * into one plain-text label, so صحيح/ضعيف/موضوع all looked identical to a
 * scholar skimming a citation list. This pins the fix: grading gets its own
 * quiet chip, coloured only when the classifier is confident, and always
 * carrying the source's attribution — never presented as our own verdict
 * (STRATEGY-v1 risk #1).
 */

vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

import CitationBadge from "@/components/research/CitationBadge";

describe("CitationBadge grading chip", () => {
  it("renders no grade chip when the citation carries no grade", () => {
    render(<CitationBadge domain="dorar" citationRef={{ book: "Sahih Bukhari" }} />);
    expect(screen.queryByText("مصحح")).not.toBeInTheDocument();
    expect(screen.queryByText("مکذوب")).not.toBeInTheDocument();
  });

  it("shows an authentic hadith as the مصحح chip", () => {
    render(<CitationBadge domain="dorar" citationRef={{ book: "Sahih Bukhari", grade: "إسناده صحيح" }} />);
    const chip = screen.getByText("مصحح");
    expect(chip).toBeInTheDocument();
    expect(chip.className).toContain("emerald");
  });

  it("shows a forged hadith as the مکذوب chip, not a neutral one", () => {
    render(<CitationBadge domain="dorar" citationRef={{ book: "X", grade: "حديث موضوع" }} />);
    const chip = screen.getByText("مکذوب");
    expect(chip.className).toContain("red");
  });

  it("falls back to the raw source text, uncoloured, when the grading can't be confidently classified", () => {
    render(<CitationBadge domain="dorar" citationRef={{ book: "X", grade: "رواه الطبراني" }} />);
    const chip = screen.getByText("رواه الطبراني");
    expect(chip.className).not.toContain("emerald");
    expect(chip.className).not.toContain("red");
    expect(chip.className).not.toContain("amber");
    expect(chip.className).not.toContain("orange");
  });

  it("always discloses the grading source in the chip's tooltip", () => {
    render(<CitationBadge domain="dorar" citationRef={{ book: "X", grade: "صحيح" }} />);
    const chip = screen.getByText("مصحح");
    expect(chip.title).toContain("Dorar.net");
    expect(chip.title).toContain("صحيح");
  });
});
