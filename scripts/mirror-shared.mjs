#!/usr/bin/env node
/**
 * Edge-function deploys bundle only `supabase/functions/`, so modules that live
 * in `shared/` (used by both the Electron main process and the Deno functions)
 * must exist physically inside that folder. This copies them into
 * `supabase/functions/_shared/mirror/`. Run after editing anything in shared/.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const FILES = [
  "ai/embedConstants.ts",
  "ai/graphSchema.ts",
  "ai/prompts/refineText.ts",
  "ai/prompts/research.ts",
  "text/chunk.ts",
  "text/documentChunks.ts",
  "text/fileText.ts",
  "text/takhrij.ts",
  "search/rankFusion.ts",
];

const OUT = "supabase/functions/_shared/mirror";

for (const f of FILES) {
  const src = join("shared", f);
  const dest = join(OUT, f);
  mkdirSync(dirname(dest), { recursive: true });
  const header =
    `// AUTO-MIRRORED from ${src} — edge deploy bundles only supabase/functions/.\n` +
    `// Edit ${src} and re-run: node scripts/mirror-shared.mjs\n`;
  writeFileSync(dest, header + readFileSync(src, "utf8"));
  console.log(`mirrored ${src} -> ${dest}`);
}
