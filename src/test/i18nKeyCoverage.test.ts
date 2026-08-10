import en from "@/locales/en.json";
import ur from "@/locales/ur.json";
import ar from "@/locales/ar.json";
import { readSource, relativeSourcePath, sourceFiles } from "./sourceScan";

describe("translation key coverage", () => {
  it("keeps Urdu and Arabic dictionaries in exact parity with English", () => {
    const expected = Object.keys(en).sort();
    expect(Object.keys(ur).sort()).toEqual(expected);
    expect(Object.keys(ar).sort()).toEqual(expected);
  });

  it("does not introduce a literal t() key missing from en.json", () => {
    const missing = new Map<string, string[]>();
    const literalTranslationCalls = [
      /\b(?:t|translateStored)\s*\(\s*["']([^"']+)["']/g,
      /\btranslate\s*\(\s*[^,]+,\s*["']([^"']+)["']/g,
    ];

    for (const file of sourceFiles()) {
      const source = readSource(file);
      for (const pattern of literalTranslationCalls) {
        for (const match of source.matchAll(pattern)) {
          const key = match[1];
          if (key in en) continue;
          const locations = missing.get(key) ?? [];
          locations.push(relativeSourcePath(file));
          missing.set(key, locations);
        }
      }
    }

    const unexpected = [...missing]
      .map(([key, files]) => `${key}: ${[...new Set(files)].join(", ")}`);

    expect(unexpected).toEqual([]);
  });
});
