import path from "node:path";
import { existsSync } from "node:fs";
import { _electron as electron, test, expect } from "@playwright/test";

/**
 * TESTING-STRATEGY.md §5.5/§10 (P3): the one gap none of the 1400+ unit tests
 * can close — proving the packaged app actually starts. Everything below it
 * is trustworthy in isolation (IPC handlers, the migration runner, the URL
 * allowlist), but nothing before this test ever launched a real Electron
 * process, so a build that throws before its first window opens (a bad
 * `dist-electron/main.js`, a broken preload, a native module that didn't
 * survive packaging) could still ship as a release artifact.
 *
 * Runs against the raw build output (`vite build --mode desktop`), the same
 * files `electron-builder` packages — not a full OS installer, which would
 * need per-platform install/launch steps this check does not need to prove.
 * `npm run build:electron` produces both `dist/` and `dist-electron/` before
 * it hands off to `electron-builder`, so `release.yml` runs this step right
 * after that build and before the artifact upload.
 */

const MAIN_ENTRY = path.resolve(process.cwd(), "dist-electron/main.js");

test.beforeAll(() => {
  if (!existsSync(MAIN_ENTRY)) {
    throw new Error(
      `${MAIN_ENTRY} does not exist. Run \`npm run build:electron\` (or \`vite build --mode desktop\`) first.`,
    );
  }
});

test("the packaged app launches, opens its main window, and logs no main-process error", async () => {
  const stderr: string[] = [];

  const app = await electron.launch({ args: [MAIN_ENTRY] });
  app.process().stderr?.on("data", (chunk: Buffer) => stderr.push(chunk.toString()));

  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");

  // Electron syncs the window title to `document.title` once the page loads,
  // overriding the BrowserWindow constructor's initial title — so this is
  // really asserting the renderer's own <title> rendered, i.e. React mounted.
  await expect(win).toHaveTitle(/Quran|Hadith|Easy Editor/i);

  // A window that actually rendered has real content in <body>, not a blank
  // shell left behind by a renderer-side crash before React ever mounted.
  const bodyText = await win.locator("body").innerText();
  expect(bodyText.trim().length).toBeGreaterThan(0);

  await app.close();

  // Main-process crashes and unhandled exceptions land on stderr. Electron
  // itself can print benign noise on some CI runners (GPU/sandbox notices),
  // so this only fails on lines that actually look like a thrown error.
  const realErrors = stderr.filter((line) => /Uncaught|Error:|TypeError|ReferenceError/.test(line));
  expect(realErrors, stderr.join("\n")).toEqual([]);
});
