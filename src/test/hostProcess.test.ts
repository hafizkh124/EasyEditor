// @vitest-environment node
// electron/host/process.ts — the orphan-process guard (SPEC-M8 §6 constraint 1
// / P0 proof 6: WINWORD.EXE does not exit when its automator dies).
//
// The load-bearing safety property here is the start-time FINGERPRINT: a bare
// PID can be recycled onto an unrelated process — even the user's own Word —
// so a kill must only fire when the PID is still live, still WINWORD.EXE, AND
// started at exactly the recorded time. These tests pin that: a mismatched
// fingerprint discards the record WITHOUT killing anything.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'docbridge-test-'));
vi.mock('electron', () => ({ app: { getPath: () => userData } }));

// child_process: spawnSync backs the PID probes, spawn/execFileSync back the
// kills. Each test configures the responses it needs.
const spawnSyncMock = vi.fn();
const spawnMock = vi.fn();
const execFileSyncMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock,
  spawn: spawnMock,
  execFileSync: execFileSyncMock,
}));

let mod: typeof import('../../electron/host/process.ts');
const realPlatform = process.platform;
const setPlatform = (p: NodeJS.Platform) =>
  Object.defineProperty(process, 'platform', { value: p, configurable: true });

const recordPath = () => path.join(userData, 'doc-bridge-host.json');

/** spawnSync stub: answer the isProcess / getStartTime probes by script text. */
function probe({ isWinword, startTime }: { isWinword: boolean; startTime: string | null }) {
  spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
    const script = args.join(' ');
    if (script.includes('ProcessName -eq')) {
      return { stdout: isWinword ? 'yes\n' : '', status: 0 };
    }
    if (script.includes("StartTime.ToString('o')")) {
      return { stdout: startTime ? `${startTime}\n` : '', status: 0 };
    }
    return { stdout: '', status: 0 };
  });
}

/** Per-process probe: `matches` maps a process name → whether that pid is it. */
function probeByName(matches: Record<string, boolean>, startTime: string | null) {
  spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
    const script = args.join(' ');
    const m = script.match(/ProcessName -eq '(\w+)'/);
    if (m) return { stdout: matches[m[1]] ? 'yes\n' : '', status: 0 };
    if (script.includes("StartTime.ToString('o')")) {
      return { stdout: startTime ? `${startTime}\n` : '', status: 0 };
    }
    return { stdout: '', status: 0 };
  });
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  fs.rmSync(recordPath(), { force: true });
  setPlatform('win32');
  spawnMock.mockImplementation(() => {
    const e = new EventEmitter() as EventEmitter & { on: EventEmitter['on'] };
    queueMicrotask(() => e.emit('exit', 0));
    return e;
  });
  mod = await import('../../electron/host/process.ts');
});

afterEach(() => setPlatform(realPlatform));

describe('recordOwnedWord / clearOwnedWord', () => {
  it('records a positive pid with a fingerprint and persists it', () => {
    probe({ isWinword: true, startTime: '2026-08-29T10:00:00.0000000+05:00' });
    mod.recordOwnedWord(8364);
    const rec = mod._currentRecord();
    expect(rec).toMatchObject({ name: 'WINWORD', pid: 8364, startTime: '2026-08-29T10:00:00.0000000+05:00' });
    expect(JSON.parse(fs.readFileSync(recordPath(), 'utf8'))).toMatchObject({ owned: [{ name: 'WINWORD', pid: 8364 }] });
  });

  it('ignores a non-positive or non-integer pid', () => {
    mod.recordOwnedWord(0);
    mod.recordOwnedWord(-1);
    mod.recordOwnedWord(1.5);
    expect(mod._currentRecord()).toBeNull();
    expect(fs.existsSync(recordPath())).toBe(false);
  });

  it('clearOwnedWord drops the record and the file', () => {
    probe({ isWinword: true, startTime: 'x' });
    mod.recordOwnedWord(10);
    mod.clearOwnedWord();
    expect(mod._currentRecord()).toBeNull();
    expect(fs.existsSync(recordPath())).toBe(false);
  });
});

describe('killOwnedWordIfAlive', () => {
  it('kills when the fingerprint still matches', async () => {
    probe({ isWinword: true, startTime: '2026-08-29T10:00:00.0000000Z' });
    mod.recordOwnedWord(8364);

    const res = await mod.killOwnedWordIfAlive();
    expect(res.killed).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith('taskkill', ['/PID', '8364', '/T', '/F'], expect.anything());
    expect(mod._currentRecord()).toBeNull();
  });

  it('does NOT kill when the process is no longer WINWORD (pid reused)', async () => {
    probe({ isWinword: true, startTime: '2026-08-29T10:00:00.0000000Z' });
    mod.recordOwnedWord(8364);
    // Now the PID belongs to something else.
    probe({ isWinword: false, startTime: 'whatever' });

    const res = await mod.killOwnedWordIfAlive();
    expect(res.killed).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(mod._currentRecord()).toBeNull();
  });

  it('does NOT kill when the start time no longer matches', async () => {
    probe({ isWinword: true, startTime: '2026-08-29T10:00:00.0000000Z' });
    mod.recordOwnedWord(8364);
    probe({ isWinword: true, startTime: '2026-08-29T13:37:00.0000000Z' }); // different

    const res = await mod.killOwnedWordIfAlive();
    expect(res.killed).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing is recorded', async () => {
    const res = await mod.killOwnedWordIfAlive();
    expect(res.killed).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe('sweepStaleOnStartup', () => {
  it('returns immediately off Windows', async () => {
    setPlatform('linux');
    fs.writeFileSync(recordPath(), JSON.stringify({ pid: 1, startTime: 'x', recordedAt: 'y' }));
    await mod.sweepStaleOnStartup();
    expect(spawnSyncMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('no-ops when there is no record file', async () => {
    await mod.sweepStaleOnStartup();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('discards a stale record whose process is gone, without killing', async () => {
    fs.writeFileSync(recordPath(), JSON.stringify({ pid: 999, startTime: 'old', recordedAt: 'y' }));
    probe({ isWinword: false, startTime: null });
    await mod.sweepStaleOnStartup();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(fs.existsSync(recordPath())).toBe(false);
  });

  it('kills a matching orphan left by a previous run (legacy single-Word file)', async () => {
    fs.writeFileSync(
      recordPath(),
      JSON.stringify({ pid: 8364, startTime: '2026-08-29T10:00:00.0000000Z', recordedAt: 'y' }),
    );
    probe({ isWinword: true, startTime: '2026-08-29T10:00:00.0000000Z' });
    await mod.sweepStaleOnStartup();
    expect(spawnMock).toHaveBeenCalledWith('taskkill', ['/PID', '8364', '/T', '/F'], expect.anything());
    expect(fs.existsSync(recordPath())).toBe(false);
  });
});

describe('multi-process ownership (P9 — Word / Excel / PowerPoint)', () => {
  const START = '2026-08-30T09:00:00.0000000Z';

  it('records each Office app under its own name', () => {
    probeByName({ WINWORD: true, EXCEL: true, POWERPNT: true }, START);
    mod.recordOwnedWord(11);
    mod.recordOwnedExcel(22);
    mod.recordOwnedPowerpoint(33);
    expect(mod._ownedRecords().map((r) => [r.name, r.pid]).sort()).toEqual([
      ['EXCEL', 22], ['POWERPNT', 33], ['WINWORD', 11],
    ]);
    expect(JSON.parse(fs.readFileSync(recordPath(), 'utf8')).owned).toHaveLength(3);
  });

  it('killOwnedWordIfAlive kills every still-matching owned process', async () => {
    probeByName({ WINWORD: true, EXCEL: true, POWERPNT: true }, START);
    mod.recordOwnedWord(11);
    mod.recordOwnedExcel(22);
    const res = await mod.killOwnedWordIfAlive();
    expect(res.killed).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith('taskkill', ['/PID', '11', '/T', '/F'], expect.anything());
    expect(spawnMock).toHaveBeenCalledWith('taskkill', ['/PID', '22', '/T', '/F'], expect.anything());
    expect(mod._ownedRecords()).toEqual([]);
  });

  it('leaves an app alone whose pid was reused by something else', async () => {
    probeByName({ WINWORD: true, EXCEL: true, POWERPNT: true }, START);
    mod.recordOwnedWord(11);
    mod.recordOwnedExcel(22);
    // Excel's pid is now some other process.
    probeByName({ WINWORD: true, EXCEL: false, POWERPNT: true }, START);
    const res = await mod.killOwnedWordIfAlive();
    expect(spawnMock).toHaveBeenCalledWith('taskkill', ['/PID', '11', '/T', '/F'], expect.anything());
    expect(spawnMock).not.toHaveBeenCalledWith('taskkill', ['/PID', '22', '/T', '/F'], expect.anything());
    expect(res.killed).toBe(true);
  });

  it('sweeps a multi-process record from a previous session', async () => {
    fs.writeFileSync(recordPath(), JSON.stringify({
      owned: [
        { name: 'WINWORD', pid: 11, startTime: START, recordedAt: 'y' },
        { name: 'EXCEL', pid: 22, startTime: START, recordedAt: 'y' },
      ],
    }));
    probeByName({ WINWORD: true, EXCEL: true }, START);
    await mod.sweepStaleOnStartup();
    expect(spawnMock).toHaveBeenCalledWith('taskkill', ['/PID', '11', '/T', '/F'], expect.anything());
    expect(spawnMock).toHaveBeenCalledWith('taskkill', ['/PID', '22', '/T', '/F'], expect.anything());
    expect(fs.existsSync(recordPath())).toBe(false);
  });
});
