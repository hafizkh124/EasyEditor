import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { estimateSegments, toParagraphs, paragraphAt, formatClock } from "@/lib/extract/timedParagraphs";

/**
 * SYSTEM-2026 §5 — the audio result reads along with its recording: tap a
 * paragraph to play from there; the spoken paragraph is highlighted.
 */

vi.mock("@/contexts/LanguageContext", () => ({ useLanguage: () => ({ t: (k: string, fb?: string) => fb ?? k }) }));
import { AudioReadAlong } from "@/components/extract/AudioReadAlong";

describe("read-along timing", () => {
  it("shares a chunk's time among its sentences by length (cloud engine)", () => {
    const segs = estimateSegments([{ start: 300, end: 330, text: "یہ دس حرف ہیں۔ اور یہ بیس حروف والا جملہ ہے۔" }]);
    expect(segs).toHaveLength(2);
    expect(segs[0].start).toBe(300);
    expect(segs[1].end).toBeCloseTo(330);
    expect(segs[1].start).toBeGreaterThan(segs[0].start);
  });

  it("starts a new paragraph after a pause or once one is long enough", () => {
    const paras = toParagraphs(
      [
        { start: 0, end: 2, text: "پہلا جملہ۔" },
        { start: 2.2, end: 4, text: "دوسرا جملہ۔" },
        { start: 9, end: 11, text: "وقفے کے بعد۔" },
      ],
      { maxChars: 1000 },
    );
    expect(paras.map((p) => p.text)).toEqual(["پہلا جملہ۔ دوسرا جملہ۔", "وقفے کے بعد۔"]);
    expect(paras[1].start).toBe(9);
  });

  it("finds the paragraph being spoken", () => {
    const paras = [{ start: 0, end: 5, text: "a" }, { start: 5, end: 9, text: "b" }];
    expect(paragraphAt(paras, 6)).toBe(1);
    expect(paragraphAt(paras, 0)).toBe(0);
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(65)).toBe("1:05");
  });
});

describe("AudioReadAlong", () => {
  beforeAll(() => {
    // jsdom has no media playback.
    window.HTMLMediaElement.prototype.play = vi.fn(async function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event("play"));
    });
    window.HTMLMediaElement.prototype.pause = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
  });

  const paragraphs = [
    { start: 0, end: 60, text: "بسم اللہ الرحمن الرحیم" },
    { start: 60, end: 120, text: "آج کا موضوع زکوٰۃ ہے" },
  ];

  it("plays from a paragraph when it is tapped, and highlights the one being spoken", () => {
    const { container } = render(<AudioReadAlong src="blob:x" paragraphs={paragraphs} exact dir="rtl" />);
    const audio = container.querySelector("audio")!;
    fireEvent.click(screen.getByRole("button", { name: /آج کا موضوع/ }));
    expect(audio.currentTime).toBe(60);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
    fireEvent.timeUpdate(audio);
    const list = screen.getByRole("list", { name: "آڈیو کے ساتھ متن" });
    expect(within(list).getByRole("button", { name: /آج کا موضوع/ })).toHaveAttribute("aria-current", "true");
    expect(within(list).getByRole("button", { name: /بسم اللہ/ })).not.toHaveAttribute("aria-current");
  });

  it("changes speed, and says when times are only estimated", () => {
    const { container } = render(<AudioReadAlong src="blob:x" paragraphs={paragraphs} exact={false} dir="rtl" />);
    fireEvent.click(screen.getByRole("button", { name: "1.5×" }));
    expect(container.querySelector("audio")!.playbackRate).toBe(1.5);
    expect(screen.getByText(/وقت اندازاً ہیں/)).toBeInTheDocument();
    expect(screen.getAllByText(/~/).length).toBeGreaterThan(0);
  });
});
