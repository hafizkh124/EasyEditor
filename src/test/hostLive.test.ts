// @vitest-environment node
// electron/host/ — LIVE end-to-end test (SPEC-M8 Layer 1 / P1 exit criterion:
// "an integration test driving the real host").
//
// Skipped unless DOC_BRIDGE_LIVE=1, because it needs a real Windows machine
// with Microsoft Word installed — CI (Ubuntu) cannot run it. Run locally:
//
//     DOC_BRIDGE_LIVE=1 npx vitest run src/test/hostLive.test.ts
//
// It exercises the whole P1 stack against real Word: tool detection, the
// long-lived host, a document round-trip, and — the point of P0 proof 6 —
// that process.ts actually kills a WINWORD.EXE the host started once the host
// dies uncleanly.
import { describe, it, expect, afterAll } from 'vitest';
import type { WordPidReply } from '../../electron/host/types.ts';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const LIVE = process.env.DOC_BRIDGE_LIVE === '1';
const FIXTURE = path.resolve(__dirname, 'fixtures/minimal.docx');

function winwordAlive(pid: number): boolean {
  const r = spawnSync('powershell', [
    '-NoProfile', '-Command',
    `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'yes' }`,
  ], { encoding: 'utf8' });
  return (r.stdout || '').includes('yes');
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docbridge-live-'));

describe.runIf(LIVE)('doc-bridge live (real Word)', () => {
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('detectTools sees Word on this machine', async () => {
    const { detectTools } = await import('../../electron/host/detectTools.ts');
    const tools = detectTools();
    expect(tools.windows).toBe(true);
    expect(tools.powershell).toBe(true);
    expect(tools.word).toBe(true);
    expect(tools.wordVersion).toMatch(/^\d+\.\d+/);
  });

  it('starts the host, pings, round-trips a docx, and cleans up the orphan', async () => {
    const { WordHost } = await import('../../electron/host/powershell.ts');
    const proc = await import('../../electron/host/process.ts');

    const host = new WordHost();
    host.start();

    // ping
    const pong = await host.send({ op: 'ping' });
    expect(pong).toMatchObject({ ok: true, pong: true });

    // open the fixture — this is what actually starts WINWORD.EXE
    const opened = await host.sendOk({ op: 'open', path: FIXTURE });
    expect(opened.ok).toBe(true);

    // the operations the Word adapter (P2) will need — proven end to end here
    await host.sendOk({ op: 'setTrackRevisions', enabled: true });
    await host.sendOk({ op: 'setRtlPageSetup' });
    const fn = await host.sendOk({ op: 'insertFootnote', text: 'M8 P1 live-test footnote — نمونہ کتاب، ج۱ ص۱' });
    expect(fn.footnoteCount).toBe(1);
    const out = path.join(tmp, 'roundtrip.docx');
    await host.sendOk({ op: 'saveAs', path: out });
    expect(fs.existsSync(out)).toBe(true);

    // we must own the WINWORD.EXE we started
    const wp = await host.sendOk<WordPidReply>({ op: 'wordPid' });
    expect(wp.ownedByUs).toBe(true);
    expect(typeof wp.pid).toBe('number');
    proc.recordOwnedWord(wp.pid);

    // P0 proof 6: kill the host WITHOUT {op:"quit"} — Word will NOT exit on
    // its own, so process.ts has to.
    host.kill();
    expect(winwordAlive(wp.pid)).toBe(true);

    const killed = await proc.killOwnedWordIfAlive();
    expect(killed.killed).toBe(true);

    // give the OS a moment, then confirm it's really gone
    await new Promise((r) => setTimeout(r, 1500));
    expect(winwordAlive(wp.pid)).toBe(false);
    expect(proc._currentRecord()).toBeNull();
  });

  it('a clean stop() leaves no WINWORD.EXE behind', async () => {
    const { WordHost } = await import('../../electron/host/powershell.ts');
    const proc = await import('../../electron/host/process.ts');

    const host = new WordHost();
    host.start();
    await host.sendOk({ op: 'open', path: FIXTURE });
    const wp = await host.sendOk<WordPidReply>({ op: 'wordPid' });
    proc.recordOwnedWord(wp.pid);

    await host.stop(); // sends {op:"quit"} → Word.Quit()
    proc.clearOwnedWord();

    await new Promise((r) => setTimeout(r, 1500));
    expect(winwordAlive(wp.pid)).toBe(false);
  });
});
