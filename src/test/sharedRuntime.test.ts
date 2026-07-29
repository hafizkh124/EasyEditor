/**
 * Guards the one rule that keeps shared/ shared: it must contain nothing that
 * only one runtime can execute.
 *
 * shared/ exists so the Deno edge functions and the Electron main process
 * (Node) run the SAME prompts, chunking, rank fusion, and embedding constants.
 * The moment a `Deno.env` or a `node:fs` sneaks in, one of the two builds
 * breaks — usually silently, and usually long after the commit that caused it.
 * M4's risk R14 was exactly this failure mode.
 *
 * This test asserts the constraint statically (source scan) and dynamically
 * (every module imports cleanly under the test runtime).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SHARED_ROOT = join(__dirname, "..", "..", "shared");

/** Runtime APIs that must never appear in shared/. */
const FORBIDDEN: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bDeno\s*\./, label: "Deno.* (Deno-only)" },
  { pattern: /from\s+["']node:/, label: 'import from "node:*" (Node-only)' },
  { pattern: /from\s+["']npm:/, label: 'import from "npm:*" (Deno-only)' },
  { pattern: /\bimport\.meta\.env\b/, label: "import.meta.env (Vite-only)" },
  { pattern: /\bprocess\s*\.\s*env\b/, label: "process.env (Node-only)" },
  { pattern: /\bwindow\s*\./, label: "window.* (browser-only)" },
  { pattern: /\bdocument\s*\.\s*(getElementById|querySelector|createElement)\b/, label: "document.* (browser-only)" },
  { pattern: /\blocalStorage\b/, label: "localStorage (browser-only)" },
];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("shared/ is runtime-independent", () => {
  const files = listTsFiles(SHARED_ROOT);

  it("contains at least one module (guards against a silently empty scan)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [relative(SHARED_ROOT, f), f]))(
    "%s uses no runtime-specific API",
    (_name, full) => {
      // Strip comments first — the explanatory prose in these files names the
      // very APIs it forbids, and a naive scan would flag its own docs.
      const source = readFileSync(full, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

      const violations = FORBIDDEN.filter((f) => f.pattern.test(source)).map((f) => f.label);
      expect(violations).toEqual([]);
    },
  );

  it.each(files.map((f) => [relative(SHARED_ROOT, f), f]))(
    "%s imports cleanly",
    async (_name, full) => {
      await expect(import(/* @vite-ignore */ full)).resolves.toBeTruthy();
    },
  );
});
