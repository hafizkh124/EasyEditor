#!/usr/bin/env node
/**
 * Smoke tests for every Supabase Edge Function.
 *
 * Purpose: right after a deploy, prove that each function is (a) actually
 * deployed, (b) boots without a runtime/import error, and (c) answers CORS
 * preflight. It deliberately does NOT test business logic — it sends a
 * harmless request and asserts the function replies with a *sane* status.
 *
 * A missing function returns 404, a function whose module fails to import
 * returns 5xx with a boot error — those are the two failure modes that kept
 * shipping silently, and they are exactly what this catches.
 *
 * Usage:
 *   node scripts/smoke-edge-functions.mjs            # all functions
 *   node scripts/smoke-edge-functions.mjs transcribe refine-text
 *   node scripts/smoke-edge-functions.mjs --json     # machine-readable report
 *
 * Env (read from .env / .env.local or the shell):
 *   VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY
 *   SMOKE_ACCESS_TOKEN (optional) — a real user JWT; when set, auth-gated
 *   functions are exercised past the 401 wall.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTIONS_DIR = join(ROOT, "supabase", "functions");

// ── env loading ──────────────────────────────────────────────────────────────
function loadEnvFile(file) {
  const path = join(ROOT, file);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    if (process.env[key]) continue;
    process.env[key] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvFile(".env");
loadEnvFile(".env.local");

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const ACCESS_TOKEN = process.env.SMOKE_ACCESS_TOKEN || ANON_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("✖ VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are missing.");
  process.exit(2);
}

// ── per-function probe config ────────────────────────────────────────────────
// `body`  — a minimal payload that must not mutate anything or spend tokens.
// `ok`    — statuses that prove the function is alive and healthy.
// 401/403 = deployed, booted, and correctly rejecting us (no user JWT).
// 400/422 = deployed, booted, and correctly validating input.
const DEFAULT_OK = [200, 400, 401, 403, 422];

const PROBES = {
  "islamic-health":   { method: "GET",  ok: [200] },
  "mcp":              { method: "POST", body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, ok: [200, 400, 401] },
  // Cron/admin functions: never invoke their work path, just prove they boot.
  "reset-monthly-quotas":     { method: "POST", body: {}, ok: [200, 401, 403] },
  "check-subscription-expiry":{ method: "POST", body: {}, ok: [200, 401, 403] },
  "process-email-queue":      { method: "POST", body: {}, ok: [200, 401, 403] },
  "backfill-embeddings":      { method: "POST", body: { dryRun: true }, ok: [200, 400, 401, 403] },
  "ingest-batch":             { method: "POST", body: {}, ok: [400, 401, 403] },
  "ingest-scholarly-data":    { method: "POST", body: {}, ok: [400, 401, 403] },
};

function listFunctions() {
  return readdirSync(FUNCTIONS_DIR)
    .filter((n) => !n.startsWith("_") && !n.startsWith("."))
    .filter((n) => statSync(join(FUNCTIONS_DIR, n)).isDirectory())
    .filter((n) => existsSync(join(FUNCTIONS_DIR, n, "index.ts")))
    .sort();
}

const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 30_000);

async function request(url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function smokeOne(name) {
  const url = `${SUPABASE_URL}/functions/v1/${name}`;
  const probe = PROBES[name] ?? {};
  const method = probe.method ?? "POST";
  const okStatuses = probe.ok ?? DEFAULT_OK;
  const started = Date.now();

  // 1. CORS preflight — the browser can't call the function without this.
  let cors = { pass: false, detail: "" };
  try {
    const res = await request(url, {
      method: "OPTIONS",
      headers: {
        Origin: "https://easy-editor.lovable.app",
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": "authorization, content-type, apikey",
      },
    });
    const allowOrigin = res.headers.get("access-control-allow-origin");
    cors.pass = res.status >= 200 && res.status < 300 && !!allowOrigin;
    cors.detail = `${res.status}${allowOrigin ? "" : " no-allow-origin"}`;
  } catch (e) {
    cors.detail = e.name === "AbortError" ? "timeout" : String(e.message ?? e);
  }

  // 2. Live invocation.
  let invoke = { pass: false, status: 0, detail: "" };
  try {
    const res = await request(url, {
      method,
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: method === "GET" ? undefined : JSON.stringify(probe.body ?? {}),
    });
    const text = (await res.text()).slice(0, 300);
    invoke.status = res.status;
    invoke.pass = okStatuses.includes(res.status);
    // A boot/import failure shows up as 5xx or as the runtime's own error text.
    if (/BOOT_ERROR|WORKER_LIMIT|failed to (load|resolve)|Uncaught|Module not found/i.test(text)) {
      invoke.pass = false;
    }
    invoke.detail = invoke.pass ? "" : text.replace(/\s+/g, " ").trim();
  } catch (e) {
    invoke.detail = e.name === "AbortError" ? "timeout" : String(e.message ?? e);
  }

  return {
    name,
    pass: cors.pass && invoke.pass,
    ms: Date.now() - started,
    cors,
    invoke,
    expected: okStatuses,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const only = args.filter((a) => !a.startsWith("--"));
  const targets = only.length > 0 ? only : listFunctions();

  // Bounded concurrency: fast, but never enough parallel cold starts to
  // trip the platform's per-project worker limit (which would report a
  // healthy function as failing).
  const CONCURRENCY = 4;
  const results = [];
  const queue = [...targets];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length) results.push(await smokeOne(queue.shift()));
    }),
  );
  results.sort((a, b) => a.name.localeCompare(b.name));

  const failed = results.filter((r) => !r.pass);

  if (json) {
    console.log(JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
  } else {
    console.log(`\nEdge function smoke tests — ${SUPABASE_URL}\n`);
    const pad = Math.max(...results.map((r) => r.name.length));
    for (const r of results) {
      const icon = r.pass ? "✔" : "✖";
      const line = `${icon} ${r.name.padEnd(pad)}  cors=${r.cors.detail || "ok"}  invoke=${r.invoke.status || "ERR"}  ${r.ms}ms`;
      console.log(line);
      if (!r.pass) {
        if (!r.cors.pass) console.log(`    ↳ CORS preflight failed: ${r.cors.detail}`);
        if (!r.invoke.pass) {
          console.log(`    ↳ expected one of [${r.expected.join(", ")}], got ${r.invoke.status || "network error"}`);
          if (r.invoke.detail) console.log(`    ↳ ${r.invoke.detail}`);
        }
      }
    }
    console.log(
      `\n${results.length - failed.length}/${results.length} passed` +
        (failed.length ? ` — FAILED: ${failed.map((f) => f.name).join(", ")}\n` : "\n"),
    );
  }

  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("smoke runner crashed:", e);
  process.exit(2);
});
