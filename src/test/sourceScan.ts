import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SOURCE_ROOT = path.join(process.cwd(), "src");

/**
 * Four suites now walk and read the whole of `src/`. Uncached, each one paid
 * for the tree again — cheap when a file is run alone, but enough to blow a
 * 15s budget once vitest runs them in parallel against everything else, which
 * made `i18nHardcodedStrings` fail in CI while passing on its own. The tree
 * cannot change mid-run, so both layers memoise safely.
 */
let cachedFiles: string[] | null = null;
const cachedSources = new Map<string, string>();

export function sourceFiles(): string[] {
  if (cachedFiles) return cachedFiles;
  const files: string[] = [];

  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "test") walk(fullPath);
      } else if (/\.tsx?$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  walk(SOURCE_ROOT);
  cachedFiles = files.sort();
  return cachedFiles;
}

export function readSource(file: string): string {
  let source = cachedSources.get(file);
  if (source === undefined) {
    source = readFileSync(file, "utf8");
    cachedSources.set(file, source);
  }
  return source;
}

export function relativeSourcePath(file: string): string {
  return path.relative(process.cwd(), file).replace(/\\/g, "/");
}
