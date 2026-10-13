#!/usr/bin/env node
/**
 * Search-quality eval runner (Phase 0 diagnosis).
 *
 * Runs docs/eval/search-questions.json against the LIVE islamic-search edge
 * function and records, per question: first-byte time, how many sources came
 * back, which domains, the reference labels in rank order, the server's own
 * stage timings, and the final answer length.
 *
 * Auth: reads an access token from the EE_TEST_JWT environment variable — it is
 * never written to disk or printed. Each query spends the signed-in account's
 * tokens (islamic-search costs ~40), so run it on an account you are happy to
 * charge.
 *
 *   EE_TEST_JWT=<access token> node scripts/eval-search.mjs [--only 1,2,3] [--dry]
 *
 * Output: scratch/eval-results-<timestamp>.json (scratch/ is git-ignored).
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const onlyArg = args[args.indexOf("--only") + 1];
const only = args.includes("--only") && onlyArg ? new Set(onlyArg.split(",").map(Number)) : null;

function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return out;
}
const env = { ...readEnvFile(".env"), ...process.env };
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const JWT = process.env.EE_TEST_JWT;

const { questions } = JSON.parse(fs.readFileSync("docs/eval/search-questions.json", "utf8"));
const selected = questions.filter((q) => !only || only.has(q.id));

if (dry) {
  console.log(`dry run: ${selected.length} questions, url=${SUPABASE_URL ? "set" : "MISSING"}, jwt=${JWT ? "set" : "MISSING"}`);
  process.exit(0);
}
if (!SUPABASE_URL || !ANON) { console.error("VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing in .env"); process.exit(1); }
if (!JWT) { console.error("Set EE_TEST_JWT to a signed-in user's access token."); process.exit(1); }

function label(c) {
  const r = c.citation_ref ?? {};
  const bits = [r.collection ?? r.book ?? r.title ?? c.domain, r.hadith_number ? `#${r.hadith_number}` : "", r.surah_number ? `${r.surah_number}:${r.verse ?? "?"}` : "", r.volume ? `ج${r.volume}` : "", r.page ? `ص${r.page}` : ""];
  return bits.filter(Boolean).join(" ");
}

async function runOne(q) {
  const t0 = Date.now();
  const out = { id: q.id, kind: q.kind, q: q.q, ok: false };
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/islamic-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${JWT}` },
      body: JSON.stringify({ query: q.q, chatHistory: [], tier: "pro", debugTiming: true }),
    });
    if (!resp.ok) { out.error = `HTTP ${resp.status} ${(await resp.text()).slice(0, 200)}`; return out; }
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "", answer = "";
    const handle = (line) => {
      if (!line.startsWith("data: ")) return;
      const s = line.slice(6).trim();
      if (s === "[DONE]") return;
      try {
        const j = JSON.parse(s);
        if (j.type === "sources_ready") {
          out.sourcesReadyMs = Date.now() - t0;
          out.sourceCount = j.count ?? 0;
          out.domains = j.domains ?? [];
          out.ranked = (j.citations ?? []).map(label);
          out.serverTiming = j.timing?.totalMs;
          out.stages = (j.timing?.stages ?? []).map((x) => `${x.stage}=${x.ms}ms${x.count != null ? `(${x.count})` : ""}${x.error ? ` ERR:${x.error}` : ""}`);
        } else if (j.type === "error") out.streamError = j.message;
        else { const c = j.choices?.[0]?.delta?.content; if (c) { if (out.firstTokenMs == null) out.firstTokenMs = Date.now() - t0; answer += c; } }
      } catch { /* partial line */ }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) !== -1) { handle(buf.slice(0, i).replace(/\r$/, "")); buf = buf.slice(i + 1); }
    }
    if (buf.trim()) handle(buf.trim());
    out.totalMs = Date.now() - t0;
    out.answerChars = answer.length;
    out.answer = answer;
    out.ok = true;
  } catch (e) { out.error = String(e?.message ?? e); }
  return out;
}

const results = [];
for (const q of selected) {
  process.stdout.write(`[${q.id}] ${q.q} … `);
  const r = await runOne(q);
  results.push(r);
  console.log(r.ok ? `${r.sourceCount} sources, first token ${r.firstTokenMs}ms, ${r.answerChars} chars` : `FAILED ${r.error ?? r.streamError}`);
}
fs.mkdirSync("scratch", { recursive: true });
const file = path.join("scratch", `eval-results-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(file, JSON.stringify(results, null, 2));
console.log(`\nSaved ${file}`);
