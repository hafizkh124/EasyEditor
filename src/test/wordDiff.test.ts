import { describe, it, expect } from "vitest";
import { wordDiff, tokenize, diffRuns } from "@/lib/text/wordDiff";

describe("wordDiff", () => {
  it("tokenises on whitespace", () => {
    expect(tokenize("  إنما  الأعمال\nبالنيات ")).toEqual(["إنما", "الأعمال", "بالنيات"]);
  });

  it("marks equal / insert / delete runs", () => {
    const d = wordDiff("العلم نور يهدي", "العلم ضياء يهدي");
    expect(d.map((t) => t.op)).toEqual(["equal", "delete", "insert", "equal"]);
    expect(d.find((t) => t.op === "delete")?.text).toBe("نور");
    expect(d.find((t) => t.op === "insert")?.text).toBe("ضياء");
  });

  it("pure insertion at the end", () => {
    const d = wordDiff("قال رسول الله", "قال رسول الله صلى الله عليه وسلم");
    expect(d.filter((t) => t.op === "insert").map((t) => t.text)).toEqual(["صلى", "الله", "عليه", "وسلم"]);
    expect(d.every((t) => t.op !== "delete")).toBe(true);
  });

  it("ignoreHarakat folds tashkīl so only real wording differs", () => {
    const withH = wordDiff("إِنَّمَا الأَعْمَالُ", "إنما الأعمال", { ignoreHarakat: false });
    expect(withH.some((t) => t.op !== "equal")).toBe(true);
    const folded = wordDiff("إِنَّمَا الأَعْمَالُ", "إنما الأعمال", { ignoreHarakat: true });
    expect(folded.every((t) => t.op === "equal")).toBe(true);
  });

  it("diffRuns collapses consecutive same-op tokens", () => {
    const runs = diffRuns(wordDiff("a b c", "a x y c"));
    expect(runs.map((r) => r.op)).toEqual(["equal", "delete", "insert", "equal"]);
    expect(runs[2].text).toBe("x y");
  });
});
