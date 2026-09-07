import { describe, it, expect } from "vitest";
import { readSource } from "./sourceScan";

/**
 * M10 Phase 2.4 — vite.config.ts's VitePWA manifest previously had none of
 * start_url/scope/id/orientation/lang/dir/shortcuts, and its theme_color
 * (#ffffff) clashed with index.html's own (#0d9488/#0f766e). Read the
 * committed source text rather than importing vite.config.ts itself — it
 * depends on plugins (lovable-tagger, the desktop renderer plugin) that are
 * awkward to load in a plain vitest run, and a real `vite build` (verified
 * once by hand — dist/manifest.webmanifest carries every field below) is
 * enough proof of correctness; this test only needs to catch a REGRESSION,
 * the same "grep the committed source" pattern capabilityRegistry.test.ts
 * already uses for App.tsx's routes.
 */
const source = readSource(`${process.cwd()}/vite.config.ts`);

// Only the manifest object, not the whole file — so a match against e.g.
// "shortcuts" can't accidentally hit an unrelated part of vite.config.ts.
const manifestBlock = (() => {
  const start = source.indexOf("manifest: {");
  const end = source.indexOf("\n        workbox:", start);
  expect(start, "manifest: { not found in vite.config.ts").toBeGreaterThan(-1);
  expect(end, "workbox: boundary not found after manifest").toBeGreaterThan(start);
  return source.slice(start, end);
})();

describe("vite.config.ts — PWA manifest", () => {
  it("declares start_url, scope, and id, all under this app's own origin", () => {
    expect(manifestBlock).toMatch(/start_url:\s*"\/"/);
    expect(manifestBlock).toMatch(/scope:\s*"\/"/);
    expect(manifestBlock).toMatch(/id:\s*"\/"/);
  });

  it("declares orientation, lang, and dir", () => {
    expect(manifestBlock).toMatch(/orientation:\s*"any"/);
    expect(manifestBlock).toMatch(/lang:\s*"en"/);
    expect(manifestBlock).toMatch(/dir:\s*"ltr"/);
  });

  it("theme_color matches index.html's light-mode meta, not a plain white", () => {
    expect(manifestBlock).toMatch(/theme_color:\s*"#0d9488"/);
    const html = readSource(`${process.cwd()}/index.html`);
    expect(html).toContain('content="#0d9488" media="(prefers-color-scheme: light)"');
  });

  it("declares two shortcuts — new research and my projects", () => {
    expect(manifestBlock).toContain("نئی تحقیق");
    expect(manifestBlock).toContain("/workspace?panel=research");
    expect(manifestBlock).toContain("میرے پراجیکٹس");
    expect(manifestBlock).toContain("/dashboard");
  });

  it("every shortcut's url is a real route App.tsx declares", () => {
    const app = readSource(`${process.cwd()}/src/App.tsx`);
    const declaredPaths = new Set([...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]));
    const shortcutUrls = [...manifestBlock.matchAll(/url:\s*"([^"?]+)/g)].map((m) => m[1]);
    expect(shortcutUrls.length).toBeGreaterThan(0);
    for (const url of shortcutUrls) {
      expect(declaredPaths, `shortcut url "${url}" has no matching App.tsx route`).toContain(url);
    }
  });
});
