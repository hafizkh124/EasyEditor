/**
 * Hashes ShamelaHelper.java for the "is the committed jar current?" check.
 *
 * Why this is not just sha256 of the file bytes: git's Windows default
 * (core.autocrlf=true) checks text files out as CRLF, while Linux — and so
 * GitHub Actions — checks the same blob out as LF. Hashing raw bytes therefore
 * produces a different digest per platform, so a hash recorded on Windows made
 * `npm run check:shamela-helper` fail on CI with a "source has changed" error
 * against an identical, unmodified source.
 *
 * Line endings do not change what javac emits, so they must not change the
 * hash. Normalising to LF first makes the digest describe the source *content*,
 * which is what the staleness check actually cares about.
 *
 * Both the recorder (build-shamela-helper.mjs) and the verifier
 * (check-shamela-helper.mjs) go through here — computing it in two places is
 * what let them drift in the first place.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export function hashJavaSource(sourcePath) {
  const normalized = readFileSync(sourcePath, "utf8").replace(/\r\n/g, "\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}
