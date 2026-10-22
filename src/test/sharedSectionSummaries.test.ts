import { describe, it, expect } from "vitest";
import {
  htmlToText, splitHtmlSections, summaryBlockHtml, summaryLabel, withSectionSummaries,
} from "~shared/agent/sectionSummaries";

describe("shared section summaries", () => {
  it("splits a chapter at h1–h3, keeping a preamble", () => {
    const parts = splitHtmlSections('<p>a</p><h1 class="x">One</h1><p>b</p><h4>sub</h4><h2>Two</h2><p>c &amp; d</p>');
    expect(parts.map((p) => p.html)).toEqual(['<p>a</p>', '<h1 class="x">One</h1><p>b</p><h4>sub</h4>', "<h2>Two</h2><p>c &amp; d</p>"]);
    expect(parts[2].text).toBe("Two\nc & d");
  });

  it("labels by script and drops the model's own heading", () => {
    expect(summaryLabel("یہ ہے")).toBe("خلاصہ");
    expect(summaryLabel("هذا ملخص")).toBe("خلاصة");
    expect(summaryLabel("This")).toBe("Summary");
    expect(summaryBlockHtml("**Summary:**\n- one\n- two <b>")).toBe(
      "<blockquote><p><strong>Summary</strong></p><ul><li>one</li><li>two &lt;b&gt;</li></ul></blockquote>",
    );
    expect(summaryBlockHtml("پہلا پیرا\n\nدوسرا")).toContain("<p>پہلا پیرا</p><p>دوسرا</p>");
  });

  it("inserts each summary after its own section only", () => {
    const sections = splitHtmlSections("<h1>A</h1><p>x</p><h1>B</h1><p>y</p>");
    expect(withSectionSummaries(sections, [null, "short"])).toBe(
      "<h1>A</h1><p>x</p><h1>B</h1><p>y</p><blockquote><p><strong>Summary</strong></p><p>short</p></blockquote>",
    );
    expect(htmlToText("<p>a<br>b</p>")).toBe("a\nb");
  });
});
