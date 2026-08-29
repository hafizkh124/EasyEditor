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

/** spawnSync stub: answer the isWinword / getStartTime probes by script text. */
function probe({ isWinword, startTime }: { isWinword: boolean; startTime: string | null }) {
  spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
    const script = args.join(' ');
    if (script.includes("ProcessName -eq 'WINWORD'")) {
      return { stdout: isWinword ? 'yes\n' : '', status: 0 };
    }
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
    expect(rec).toMatchObject({ pid: 8364, startTime: '2026-08-29T10:00:00.0000000+05:00' });
    expect(JSON.parse(fs.readFileSync(recordPath(), 'utf8'))).toMatchObject({ pid: 8364 });
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

  it('kills a matching orphan left by a previous run', async () => {
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
