#!/usr/bin/env node
/**
 * Packages `tools/shamela-bridge/` into `public/downloads/shamela-bridge.zip`
 * — the "لوکل برج ڈاؤن لوڈ کریں" button's actual payload.
 *
 * Two things make this more than a directory zip:
 *
 * 1. **Explicit file allowlist, never a directory sweep.** `tools/shamela-bridge/`
 *    also holds `.bridge-token.json` — a live pairing secret, gitignored but
 *    present in every working tree that has ever run the bridge. Shipping it
 *    would hand every downloader the same known token and defeat pairing
 *    outright. Listing files by name is what guarantees it can never sneak in,
 *    even if someone adds a directory-sweep helper here later.
 * 2. **shamela-mcp is vendored, not assumed.** `server.mjs` depends on the
 *    third-party `shamela-mcp` package and already probes
 *    `tools/shamela-bridge/vendor/shamela-mcp` as a candidate path — this
 *    script's job is just to make sure that directory exists before zipping,
 *    the same way `check-shamela-helper.mjs` proves the jar is current before
 *    `build:electron` packages it.
 *
 * Run via `prebuild`, alongside `generate-version.mjs` (same pattern: compute
 * something, write it into `public/`, which is gitignored there).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createZip } from "./lib/zip.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BRIDGE_DIR = join(ROOT, "tools", "shamela-bridge");
const VENDOR_DIR = join(BRIDGE_DIR, "vendor", "shamela-mcp");
const JAR_SRC = join(ROOT, "electron", "shamela", "java", "shamela-helper.jar");
const OUT_DIR = join(ROOT, "public", "downloads");
const OUT_ZIP = join(OUT_DIR, "shamela-bridge.zip");
const OUT_META = join(OUT_DIR, "shamela-bridge.json");

function fail(message) {
  console.error(`[package-shamela-bridge] ${message}`);
  process.exit(1);
}

// ── Preconditions ───────────────────────────────────────────────────────
for (const required of [
  join(BRIDGE_DIR, "server.mjs"),
  join(BRIDGE_DIR, "reader.mjs"),
  join(BRIDGE_DIR, "auth.mjs"),
  join(BRIDGE_DIR, "start-bridge.bat"),
  join(BRIDGE_DIR, "start-bridge.sh"),
]) {
  if (!existsSync(required)) fail(`Missing bridge source file: ${required}`);
}
if (!existsSync(JAR_SRC)) {
  fail(`shamela-helper.jar missing at ${JAR_SRC}. Run: npm run build:shamela-helper`);
}
for (const vendorFile of ["dist/index.js", "LICENSE", "manifest.json", "helper/shamela-helper.jar"]) {
  if (!existsSync(join(VENDOR_DIR, vendorFile))) {
    fail(
      `shamela-mcp is not vendored (missing ${vendorFile} under ${VENDOR_DIR}).\n` +
        `  Copy the redistributable MIT build there — see docs/adr for the packaging decision.`,
    );
  }
}

// ── README shipped inside the zip ───────────────────────────────────────
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const readme = `Al-Ulama Easy Editor — Local Shamela 4 Bridge
================================================

What this is
-------------
A small local server that lets the Easy Editor web app search and read your
own Shamela 4 library (installed on this computer) from your browser. It
never uploads your library anywhere — everything stays on 127.0.0.1.

How to run it
--------------
Windows:  double-click start-bridge.bat
Mac/Linux: run ./start-bridge.sh in a terminal

Keep the window open while using local search in Al-Ulama Easy Editor. The
web app detects the running bridge on its own — no extra setup once it is
running.

Requirements
-------------
Node.js 22.13 or newer (https://nodejs.org/). The launcher scripts check this
for you and explain what to do if it is missing or too old.

What's inside
---------------
server.mjs, reader.mjs, auth.mjs   - the bridge itself
lib/shamela-helper.jar             - reads Shamela's page/index format (same
                                      helper the desktop app ships)
vendor/shamela-mcp/                - catalogue & search backend, incl. its own
                                      helper jar (MIT, Hamoud Alhoqbani — see
                                      its own LICENSE)

Version: Al-Ulama Easy Editor ${pkg.version}
`;

// ── Assemble entries ─────────────────────────────────────────────────────
function file(diskPath, zipName) {
  return { name: zipName, data: readFileSync(diskPath) };
}

const entries = [
  file(join(BRIDGE_DIR, "server.mjs"), "shamela-bridge/server.mjs"),
  file(join(BRIDGE_DIR, "reader.mjs"), "shamela-bridge/reader.mjs"),
  file(join(BRIDGE_DIR, "auth.mjs"), "shamela-bridge/auth.mjs"),
  file(join(BRIDGE_DIR, "start-bridge.bat"), "shamela-bridge/start-bridge.bat"),
  file(join(BRIDGE_DIR, "start-bridge.sh"), "shamela-bridge/start-bridge.sh"),
  { name: "shamela-bridge/README.txt", data: Buffer.from(readme, "utf8") },
  file(JAR_SRC, "shamela-bridge/lib/shamela-helper.jar"),
  file(join(VENDOR_DIR, "dist", "index.js"), "shamela-bridge/vendor/shamela-mcp/dist/index.js"),
  file(join(VENDOR_DIR, "LICENSE"), "shamela-bridge/vendor/shamela-mcp/LICENSE"),
  file(join(VENDOR_DIR, "manifest.json"), "shamela-bridge/vendor/shamela-mcp/manifest.json"),
  file(join(VENDOR_DIR, "helper", "shamela-helper.jar"), "shamela-bridge/vendor/shamela-mcp/helper/shamela-helper.jar"),
];
if (existsSync(join(VENDOR_DIR, "README.md"))) {
  entries.push(file(join(VENDOR_DIR, "README.md"), "shamela-bridge/vendor/shamela-mcp/README.md"));
}

// Belt-and-suspenders: refuse to ship the pairing secret even if some future
// edit to this file's entry list ever tried to include it by name.
if (entries.some((e) => e.name.toLowerCase().includes("bridge-token"))) {
  fail("Refusing to package: a bridge-token file is in the entry list.");
}

const zipBuffer = createZip(entries);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_ZIP, zipBuffer);

// The panel reads this instead of hardcoding a size, so the download label
// can never drift from the actual artefact.
const meta = {
  version: pkg.version,
  bytes: zipBuffer.length,
  builtAt: new Date().toISOString(),
};
writeFileSync(OUT_META, JSON.stringify(meta, null, 2), "utf8");

const mb = (zipBuffer.length / (1024 * 1024)).toFixed(2);
console.log(`[package-shamela-bridge] wrote ${OUT_ZIP} (${mb} MB, ${entries.length} files)`);
