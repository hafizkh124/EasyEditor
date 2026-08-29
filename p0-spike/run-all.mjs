// run-all.mjs — M7 P0 spike orchestrator for proofs (1), (2) and (6).
// Proofs (3), (4), (5) are separate (test-libreoffice.mjs,
// inpage-rtf-checklist.md, font-install-test.ps1) because they don't share
// this one's long-lived Word COM session.
//
// Usage:
//   node run-all.mjs <sample.docx> [sample.pdf]
//
// <sample.docx> should already contain a few paragraphs of Urdu/Nastaliq
// text — this script edits and re-saves it, it does not create content
// from nothing (Word COM can do that too, but "does an existing scholar's
// document survive a round-trip" is the more honest test).
//
// <sample.pdf>, if given, is used for proof (2) — Word's own PDF Reflow.

import { WordBridge } from './host.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bridgeScript = path.join(__dirname, 'word-bridge.ps1');

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ' — ' + JSON.stringify(detail) : ''}`);
}

async function checkPidAlive(pid) {
  return new Promise((resolve) => {
    const p = spawn('powershell', [
      '-NoProfile', '-Command',
      `if (Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue) { Write-Output 'ALIVE' } else { Write-Output 'GONE' }`,
    ]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('exit', () => resolve(out.includes('ALIVE')));
  });
}

async function main() {
  const docxPath = process.argv[2];
  const pdfPath = process.argv[3];
  if (!docxPath) {
    console.error('usage: node run-all.mjs <sample.docx> [sample.pdf]');
    process.exit(2);
  }

  // ── Proof (1): open real Word via COM, do the operations the plan's
  // word adapter actually needs — track changes, RTL page setup, a real
  // footnote — then save, all driven only by JSON over stdio. ──────────
  console.log('\n=== Proof 1: Word COM automation via long-lived PowerShell host ===');
  const bridge = new WordBridge(bridgeScript);
  let wordPid;
  try {
    const ping = await bridge.send({ op: 'ping' });
    record('ping', ping.ok === true);

    const opened = await bridge.send({ op: 'open', path: path.resolve(docxPath) });
    record('open existing docx', opened.ok === true, opened);

    const tracked = await bridge.send({ op: 'setTrackRevisions', enabled: true });
    record('enable track revisions', tracked.ok === true && tracked.enabled === true);

    const rtl = await bridge.send({ op: 'setRtlPageSetup' });
    record('set RTL page setup', rtl.ok === true);

    const footnote = await bridge.send({ op: 'insertFootnote', text: 'یہ P0 اسپائیک کا آزمائشی حاشیہ ہے — اصل کتاب: نمونہ، جلد ۱، صفحہ ۱۔' });
    record('insert real Word footnote', footnote.ok === true, footnote);

    const savedPath = docxPath.replace(/\.docx$/i, '.p0-spike-output.docx');
    const saved = await bridge.send({ op: 'saveAs', path: path.resolve(savedPath) });
    record('save as new docx', saved.ok === true, { path: savedPath });
    console.log(`  → Now open ${savedPath} in Word yourself and confirm: RTL margins look right, the footnote shows at the bottom of the page in Urdu, and Review ▸ Track Changes shows the edits as tracked.`);

    // ── Proof (2): Word's own PDF Reflow, no external converter. ──────
    if (pdfPath) {
      console.log('\n=== Proof 2: Word PDF Reflow (Documents.Open on a .pdf) ===');
      const pdfResult = await bridge.send({ op: 'openPdfReflow', path: path.resolve(pdfPath) }, 60_000);
      record('open .pdf directly via Word (reflow)', pdfResult.ok === true, pdfResult);
    } else {
      console.log('\n(skipping Proof 2 — no sample.pdf given)');
    }

    const pidResult = await bridge.send({ op: 'wordPid' });
    if (pidResult.ok) wordPid = pidResult.pid;
    record('read WINWORD.EXE pid', pidResult.ok === true, pidResult);
  } finally {
    // ── Proof (6): kill the host WITHOUT a clean {op:"quit"} — does
    // WINWORD.EXE linger as an orphan? This is the exact failure mode
    // electron/host/process.ts (تہہ ۱) must guard against. ─────────────
    console.log('\n=== Proof 6: orphaned WINWORD.EXE after an unclean host exit ===');
    bridge.killWithoutCleanup();
    if (wordPid) {
      await new Promise((r) => setTimeout(r, 3000));
      const stillAlive = await checkPidAlive(wordPid);
      record(
        'WINWORD.EXE cleaned up after host crash',
        !stillAlive,
        stillAlive
          ? { note: 'orphan CONFIRMED — electron/host/process.ts must actively kill this PID, Word will not exit on its own' }
          : { note: 'Word exited on its own when the automating process died' }
      );
    } else {
      console.log('  (skipped — never got a WINWORD.EXE pid to check)');
    }
  }

  console.log('\n=== Summary ===');
  for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log(`\n${failed.length} of ${results.length} checks failed — do not proceed to P1 until these are understood.`);
    process.exit(1);
  }
  console.log('\nAll automated checks passed. Still required: proofs 3, 4, 5 (test-libreoffice.mjs, inpage-rtf-checklist.md, font-install-test.ps1) and the manual visual confirmations printed above.');
}

main().catch((e) => {
  console.error('run-all.mjs crashed:', e);
  process.exit(1);
});
