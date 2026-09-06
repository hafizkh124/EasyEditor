// @vitest-environment node
// electron/host/powershell.ts — WordHost, the long-lived PowerShell/Word host
// (SPEC-M8 Layer 1 / P1). The real process is mocked (Vitest runs on plain
// Node with no PowerShell); this pins the parts that are pure protocol logic:
//   - off Windows, start() refuses up front
//   - replies match requests strictly FIFO (the bridge is serial)
//   - a per-op timeout rejects and frees the slot so a late reply can't desync
//   - an unexpected host exit rejects every in-flight request AND emits 'exit'
//     (that's the hook electron/host/process.ts uses to kill orphaned Word)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ── fakes ────────────────────────────────────────────────────────────────
class FakeProc extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  killed = false;
  stdin = { write: vi.fn() };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn(() => { this.killed = true; return true; });
}
let fakeProc: FakeProc;
let rlEmitter: EventEmitter;

const spawnMock = vi.fn((..._args: unknown[]) => fakeProc);
vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('node:readline', () => ({
  createInterface: () => {
    rlEmitter = new EventEmitter();
    return Object.assign(rlEmitter, { close: vi.fn() });
  },
}));
vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }));
// resolveBridgeScript() walks the filesystem for wordBridge.ps1 — the real
// file exists in the repo, so let it resolve naturally rather than mocking fs.

let powershell: typeof import('../../electron/host/powershell.ts');
let types: typeof import('../../electron/host/types.ts');

const realPlatform = process.platform;
function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  fakeProc = new FakeProc();
  setPlatform('win32');
  powershell = await import('../../electron/host/powershell.ts');
  types = await import('../../electron/host/types.ts');
});

afterEach(() => {
  setPlatform(realPlatform);
  vi.useRealTimers();
});

describe('start()', () => {
  it('refuses off Windows with a typed error', () => {
    setPlatform('linux');
    const host = new powershell.WordHost();
    try {
      host.start();
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(types.HostError);
      expect((err as InstanceType<typeof types.HostError>).code).toBe('not-windows');
    }
  });

  it('spawns powershell once and is idempotent while alive', () => {
    const host = new powershell.WordHost();
    host.start();
    host.start();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][0]).toBe('powershell');
    expect(host.isAlive()).toBe(true);
    expect(host.pid).toBe(4242);
  });
});

describe('request / reply', () => {
  it('matches replies to requests strictly FIFO', async () => {
    const host = new powershell.WordHost();
    host.start();

    const p1 = host.send({ op: 'ping' });
    const p2 = host.send({ op: 'wordPid' });

    rlEmitter.emit('line', JSON.stringify({ ok: true, op: 'ping', pong: true }));
    rlEmitter.emit('line', JSON.stringify({ ok: true, op: 'wordPid', pid: 9, ownedByUs: true }));

    await expect(p1).resolves.toMatchObject({ op: 'ping', pong: true });
    await expect(p2).resolves.toMatchObject({ op: 'wordPid', pid: 9 });
  });

  it('sendOk rejects when the reply says ok:false', async () => {
    const host = new powershell.WordHost();
    host.start();
    const p = host.sendOk({ op: 'save' });
    rlEmitter.emit('line', JSON.stringify({ ok: false, op: 'save', error: 'no document open' }));
    await expect(p).rejects.toThrow(/no document open/);
  });

  it('a non-JSON reply line rejects with bad-reply', async () => {
    const host = new powershell.WordHost();
    host.start();
    const p = host.send({ op: 'ping' });
    rlEmitter.emit('line', 'PS C:\\> not json');
    await expect(p).rejects.toMatchObject({ code: 'bad-reply' });
  });
});

describe('timeout', () => {
  it('rejects after the op budget and frees the FIFO slot', async () => {
    vi.useFakeTimers();
    const host = new powershell.WordHost();
    host.start();

    const slow = host.send({ op: 'ping' }); // 5000ms budget
    vi.advanceTimersByTime(5001);
    await expect(slow).rejects.toMatchObject({ code: 'timeout', op: 'ping' });

    // A reply that arrives late must NOT be handed to the next request.
    const next = host.send({ op: 'ping' });
    rlEmitter.emit('line', JSON.stringify({ ok: true, op: 'ping', pong: true }));
    await expect(next).resolves.toMatchObject({ pong: true });
  });

  it('kills the host on a non-ping timeout so a wedged process is not reused', async () => {
    vi.useFakeTimers();
    const host = new powershell.WordHost();
    host.start();
    const onExit = vi.fn();
    host.on('exit', onExit);

    const stuck = host.send({ op: 'open', path: 'C:\\x.docx' }); // 60000ms budget
    vi.advanceTimersByTime(60001);
    await expect(stuck).rejects.toMatchObject({ code: 'timeout', op: 'open' });

    expect(fakeProc.kill).toHaveBeenCalledWith('SIGKILL');
    expect(host.isAlive()).toBe(false);
    fakeProc.emit('exit', null); // simulate the OS confirming the SIGKILL
    expect(onExit).toHaveBeenCalled();

    await expect(host.send({ op: 'ping' })).rejects.toMatchObject({ code: 'host-crashed' });
  });
});

describe('crash', () => {
  it('an unexpected exit rejects all pending and emits "exit"', async () => {
    const host = new powershell.WordHost();
    host.start();
    const onExit = vi.fn();
    host.on('exit', onExit);

    const inflight = host.send({ op: 'open', path: 'C:\\x.docx' });
    fakeProc.exitCode = 1;
    fakeProc.emit('exit', 1);

    await expect(inflight).rejects.toMatchObject({ code: 'host-crashed' });
    expect(onExit).toHaveBeenCalledWith(1);
    expect(host.isAlive()).toBe(false);
  });

  it('send() after a crash rejects immediately', async () => {
    const host = new powershell.WordHost();
    host.start();
    fakeProc.exitCode = 0;
    fakeProc.emit('exit', 0);
    await expect(host.send({ op: 'ping' })).rejects.toMatchObject({ code: 'host-crashed' });
  });
});
