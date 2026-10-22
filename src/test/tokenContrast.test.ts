// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { readSource, relativeSourcePath, sourceFiles } from "./sourceScan";

type Hsl = { h: number; s: number; l: number };

const css = readFileSync(path.join(process.cwd(), "src", "index.css"), "utf8");

function tokenBlock(selector: string): Map<string, Hsl> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`))?.[1] ?? "";
  const tokens = new Map<string, Hsl>();
  const declaration = /--([\w-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g;
  for (const match of body.matchAll(declaration)) {
    tokens.set(match[1], { h: Number(match[2]), s: Number(match[3]), l: Number(match[4]) });
  }
  return tokens;
}

function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
  const saturation = s / 100;
  const lightness = l / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const candidates: [number, number, number][] = [
    [chroma, x, 0], [x, chroma, 0], [0, chroma, x],
    [0, x, chroma], [x, 0, chroma], [chroma, 0, x],
  ];
  const [r, g, b] = candidates[Math.floor(segment) % 6];
  const m = lightness - chroma / 2;
  return [r + m, g + m, b + m];
}

function luminance(color: Hsl): number {
  const channels = hslToRgb(color).map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function ratio(foreground: Hsl, background: Hsl): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const checks = [
  ["light.muted-fg/background", ":root", "muted-foreground", "background", 4.5],
  ["light.muted-fg/card", ":root", "muted-foreground", "card", 4.5],
  ["light.muted-fg/muted", ":root", "muted-foreground", "muted", 4.5],
  ["light.secondary-fg/secondary", ":root", "secondary-foreground", "secondary", 4.5],
  ["light.input/background", ":root", "input", "background", 3],
  ["light.primary/card", ":root", "primary", "card", 4.5],
  ["dark.muted-fg/background", ".dark", "muted-foreground", "background", 4.5],
  ["dark.muted-fg/muted", ".dark", "muted-foreground", "muted", 4.5],
  ["dark.input/card", ".dark", "input", "card", 3],
  // Semantic status families: text and icons sit on their soft surface
  // (chips, banners) and on plain cards.
  ["light.success/soft", ":root", "success", "success-soft", 4.5],
  ["light.warning/soft", ":root", "warning", "warning-soft", 4.5],
  ["light.weak/soft", ":root", "weak", "weak-soft", 4.5],
  ["light.info/soft", ":root", "info", "info-soft", 4.5],
  ["dark.success/soft", ".dark", "success", "success-soft", 4.5],
  ["dark.warning/soft", ".dark", "warning", "warning-soft", 4.5],
  ["dark.weak/soft", ".dark", "weak", "weak-soft", 4.5],
  ["dark.info/soft", ".dark", "info", "info-soft", 4.5],
  ["light.destructive/soft", ":root", "destructive", "destructive-soft", 4.5],
  ["dark.destructive/soft", ".dark", "destructive", "destructive-soft", 4.5],
  ["light.success/card", ":root", "success", "card", 4.5],
  ["light.warning/card", ":root", "warning", "card", 4.5],
  ["light.weak/card", ":root", "weak", "card", 4.5],
  ["light.info/card", ":root", "info", "card", 4.5],
  ["dark.success/card", ".dark", "success", "card", 4.5],
  ["dark.warning/card", ".dark", "warning", "card", 4.5],
  ["dark.weak/card", ".dark", "weak", "card", 4.5],
  ["dark.info/card", ".dark", "info", "card", 4.5],
] as const;

describe("design-token contrast", () => {
  it("meets the WCAG thresholds for every checked token pairing", () => {
    const blocks = { ":root": tokenBlock(":root"), ".dark": tokenBlock(".dark") };
    const unexpected: string[] = [];

    for (const [id, selector, foregroundName, backgroundName, minimum] of checks) {
      const foreground = blocks[selector].get(foregroundName);
      const background = blocks[selector].get(backgroundName);
      expect(foreground, `${selector} --${foregroundName}`).toBeDefined();
      expect(background, `${selector} --${backgroundName}`).toBeDefined();
      const actual = ratio(foreground!, background!);
      if (actual < minimum) {
        unexpected.push(`${id}: ${actual.toFixed(2)} < ${minimum}`);
      }
    }

    expect(unexpected).toEqual([]);
  });

  it("keeps muted surface opacity aligned with the Phase 2 token semantics", () => {
    const deprecated = /\bhover:bg-muted\/\d+\b|\bbg-muted\/(?:10|20|30|40|50|70)\b/g;
    const violations = sourceFiles().flatMap((file) =>
      Array.from(readSource(file).matchAll(deprecated), (match) =>
        `${relativeSourcePath(file)}: ${match[0]}`,
      ),
    );

    expect(violations).toEqual([]);
  });
});
