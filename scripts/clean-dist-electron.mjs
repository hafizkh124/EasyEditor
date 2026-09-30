#!/usr/bin/env node
/**
 * Empties dist-electron/ before a packaging build.
 *
 * vite-plugin-electron builds main and preload as two separate Vite builds
 * into the same folder, so neither can use `emptyOutDir` (the second would
 * wipe the first). Without this step every build's hashed chunks
 * (main-<hash>.cjs, audiobook-<hash>.cjs, …) piled up — ~40 stale main chunks
 * were being packed into the 2.0.10 installer. electron-builder ships
 * `dist-electron/**`, so stale files cost installer size, not correctness.
 *
 * Run by build:electron / build:appx / pack:electron (not by `vite` dev).
 */
import { rmSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist-electron');

if (existsSync(OUT)) {
  rmSync(OUT, { recursive: true, force: true });
  console.log('[clean-dist-electron] removed dist-electron/');
} else {
  console.log('[clean-dist-electron] nothing to remove');
}
