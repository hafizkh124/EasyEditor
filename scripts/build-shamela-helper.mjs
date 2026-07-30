#!/usr/bin/env node
/**
 * Build script for shamela-helper.jar
 *
 * ADR-0007: Compiles ShamelaHelper.java into a JAR using Shamela's bundled JRE
 * or any available JDK. The helper uses reflection for Lucene classes so it
 * compiles without Lucene jars on the classpath.
 *
 * Usage:
 *   node scripts/build-shamela-helper.mjs [--jdk <path-to-javac>]
 *
 * Output:
 *   electron/shamela/java/shamela-helper.jar
 */

import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const JAVA_SRC = join(ROOT, 'electron', 'shamela', 'java', 'ShamelaHelper.java');
const BUILD_DIR = join(ROOT, 'electron', 'shamela', 'java', 'build');
const OUTPUT_JAR = join(ROOT, 'electron', 'shamela', 'java', 'shamela-helper.jar');
const RESOURCES_BIN = join(ROOT, 'resources', 'bin');

// Find javac — prefer argument, then JAVA_HOME, then PATH
function findJavac() {
  const args = process.argv.slice(2);
  const jdkIdx = args.indexOf('--jdk');
  if (jdkIdx >= 0 && args[jdkIdx + 1]) {
    const custom = args[jdkIdx + 1];
    if (existsSync(custom)) return custom;
    const javac = join(custom, 'bin', 'javac.exe');
    if (existsSync(javac)) return javac;
    const javac2 = join(custom, 'bin', 'javac');
    if (existsSync(javac2)) return javac2;
  }

  if (process.env.JAVA_HOME) {
    const javac = join(process.env.JAVA_HOME, 'bin', 'javac.exe');
    if (existsSync(javac)) return javac;
    const javac2 = join(process.env.JAVA_HOME, 'bin', 'javac');
    if (existsSync(javac2)) return javac2;
  }

  // Try Shamela's bundled JDK (it ships JRE, not JDK, so javac may not exist)
  const shamelaJavac = 'C:\\Program Files\\shamela\\app\\win\\64\\jre\\2\\bin\\javac.exe';
  if (existsSync(shamelaJavac)) return shamelaJavac;

  // Fall back to PATH
  try {
    execSync('javac -version', { stdio: 'pipe' });
    return 'javac';
  } catch {
    return null;
  }
}

function findJar() {
  if (process.env.JAVA_HOME) {
    const jar = join(process.env.JAVA_HOME, 'bin', 'jar.exe');
    if (existsSync(jar)) return jar;
    const jar2 = join(process.env.JAVA_HOME, 'bin', 'jar');
    if (existsSync(jar2)) return jar2;
  }
  try {
    execSync('jar --version', { stdio: 'pipe' });
    return 'jar';
  } catch {
    return null;
  }
}

function main() {
  console.log('[build-shamela-helper] Building shamela-helper.jar...');

  if (!existsSync(JAVA_SRC)) {
    console.error(`[build-shamela-helper] Source not found: ${JAVA_SRC}`);
    process.exit(1);
  }

  const javac = findJavac();
  if (!javac) {
    console.warn('[build-shamela-helper] javac not found. Skipping Java build.');
    console.warn('  To build, install JDK 17+ or pass --jdk <path>');
    console.warn('  The pre-built shamela-helper.jar (if present) will be used at runtime.');
    process.exit(0); // Not a fatal error — jar may already be committed
  }

  const jar = findJar();
  if (!jar) {
    console.warn('[build-shamela-helper] jar tool not found. Skipping.');
    process.exit(0);
  }

  // Clean build directory
  if (existsSync(BUILD_DIR)) {
    rmSync(BUILD_DIR, { recursive: true, force: true });
  }
  mkdirSync(BUILD_DIR, { recursive: true });

  // Compile
  console.log(`[build-shamela-helper] Compiling with ${javac}...`);
  try {
    execFileSync(javac, [
      '-d', BUILD_DIR,
      '-source', '17',
      '-target', '17',
      '-encoding', 'UTF-8',
      JAVA_SRC,
    ], { stdio: 'inherit' });
  } catch (e) {
    console.error('[build-shamela-helper] Compilation failed.');
    process.exit(1);
  }

  // Create JAR
  console.log(`[build-shamela-helper] Creating ${OUTPUT_JAR}...`);
  try {
    execFileSync(jar, [
      'cf', OUTPUT_JAR,
      '-C', BUILD_DIR, '.',
    ], { stdio: 'inherit' });
  } catch (e) {
    console.error('[build-shamela-helper] JAR creation failed.');
    process.exit(1);
  }

  // Copy to resources/bin for electron-builder packaging
  mkdirSync(RESOURCES_BIN, { recursive: true });
  copyFileSync(OUTPUT_JAR, join(RESOURCES_BIN, 'shamela-helper.jar'));

  // Cleanup build directory
  rmSync(BUILD_DIR, { recursive: true, force: true });

  console.log('[build-shamela-helper] ✅ shamela-helper.jar built successfully.');
  console.log(`  Output: ${OUTPUT_JAR}`);
  console.log(`  Copied to: ${join(RESOURCES_BIN, 'shamela-helper.jar')}`);
}

main();
