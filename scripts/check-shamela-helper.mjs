#!/usr/bin/env node
/**
 * Verifies the committed shamela-helper.jar is present and current.
 *
 * SPEC-M5 R26 keeps the jar in the repo so an ordinary build needs no JDK.
 * That convenience has a cost: an edited ShamelaHelper.java sitting beside a
 * stale jar ships the OLD helper, and nothing about the source diff would hint
 * at it. Shamela search and import both run through this jar, so a stale one
 * fails in the least obvious way possible — the app works, just not the part
 * that was edited.
 *
 * The build script records a hash of the source it compiled; this compares it
 * back. Run before packaging (build:electron / pack:electron).
 */
import { existsSync, readFileSync, copyFileSync, mkdirSync } from "node:fs";
import { hashJavaSource } from "./lib/javaSourceHash.mjs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const JAVA_DIR = join(ROOT, "electron", "shamela", "java");
const JAVA_SRC = join(JAVA_DIR, "ShamelaHelper.java");
const JAR = join(JAVA_DIR, "shamela-helper.jar");
const HASH_FILE = join(JAVA_DIR, "shamela-helper.jar.sha256");
const PACKAGED_JAR = join(ROOT, "resources", "bin", "shamela-helper.jar");

const REBUILD = "npm run build:shamela-helper";

function fail(message) {
  console.error(`[check-shamela-helper] ${message}`);
  process.exit(1);
}

if (!existsSync(JAVA_SRC)) fail(`Source missing: ${JAVA_SRC}`);
if (!existsSync(JAR)) fail(`shamela-helper.jar is missing. Run: ${REBUILD}`);

if (!existsSync(HASH_FILE)) {
  fail(
    `No source hash beside the jar, so it cannot be proven current. Run: ${REBUILD}`,
  );
}

const recorded = readFileSync(HASH_FILE, "utf8").trim();
const actual = hashJavaSource(JAVA_SRC);

if (recorded !== actual) {
  fail(
    `ShamelaHelper.java has changed since the jar was built — packaging now would\n` +
      `  ship the old helper.\n` +
      `    recorded: ${recorded.slice(0, 16)}…\n` +
      `    actual:   ${actual.slice(0, 16)}…\n` +
      `  Run: ${REBUILD}`,
  );
}

// electron-builder packages resources/bin, which is a build artefact rather
// than a second committed copy of the jar. Staging it here is what lets a
// fresh clone run build:electron with no JDK at all (SPEC-M5 R26).
mkdirSync(dirname(PACKAGED_JAR), { recursive: true });
copyFileSync(JAR, PACKAGED_JAR);

console.log("[check-shamela-helper] jar is present, current, and staged for packaging.");
