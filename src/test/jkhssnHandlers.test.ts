// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createElectronMock } from './helpers/electronMock';
import { writeSyntheticHadithDb } from './helpers/jkhssnFixture';
import { ALLOWED_IPC_CHANNELS, isAllowedIpcChannel } from '../../electron/ipc/registry';

const electron = createElectronMock();
vi.mock('electron', () => electron);

let userData: string;

beforeAll(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jkhssn-h-'));
  userData = path.join(tmp, 'userData');
  fs.mkdirSync(userData, { recursive: true });
  electron.app.getPath.mockImplementation((k: string) => (k === 'userData' ? userData : (() => { throw new Error(k); })()));
  process.env.JKHSSN_NO_CANDIDATE_SCAN = '1';
  process.env.JKHSSN_DATA_PATH = writeSyntheticHadithDb(tmp);

  const { buildJkhssnIndex } = await import('../../electron/jkhssn/buildIndex');
  await buildJkhssnIndex({ dataPath: process.env.JKHSSN_DATA_PATH, outPath: path.join(userData, 'jkhssn.sqlite') });

  const { registerJkhssnHandlers } = await import('../../electron/ipc/jkhssnHandlers');
  registerJkhssnHandlers();
});

afterAll(async () => {
  const { closeJkhssnDb } = await import('../../electron/jkhssn/indexDb');
  closeJkhssnDb();
  delete process.env.JKHSSN_NO_CANDIDATE_SCAN;
  delete process.env.JKHSSN_DATA_PATH;
  fs.rmSync(path.dirname(userData), { recursive: true, force: true });
});

const invoke = (payload: Record<string, unknown>): Promise<unknown> =>
  Promise.resolve(electron.invoke(ALLOWED_IPC_CHANNELS.JKHSSN_INVOKE, payload));
const obj = (v: unknown) => v as Record<string, any>;

describe('jkhssn IPC', () => {
  it('registers the channels', () => {
    expect(ALLOWED_IPC_CHANNELS.JKHSSN_INVOKE).toBe('jkhssn:invoke');
    expect(isAllowedIpcChannel('jkhssn:invoke')).toBe(true);
    expect(isAllowedIpcChannel('jkhssn:index-progress')).toBe(true);
    expect(isAllowedIpcChannel('jkhssn:evil')).toBe(false);
  });

  it('detect reports an installed, built index', async () => {
    const s = obj(await invoke({ action: 'detect' }));
    expect(s.installed).toBe(true);
    expect(s.indexBuilt).toBe(true);
    expect(s.indexStale).toBe(false);
  });

  it('routes axis actions', async () => {
    expect(obj(await invoke({ action: 'axisNarrator', nameQuery: 'شعبة' })).jkRawyId).toBe(11);
    expect(obj(await invoke({ action: 'axisSanadTree', hadithMainId: 10 })).chains.length).toBe(1);
    expect(obj(await invoke({ action: 'axisJudgments', hadithMainId: 10 })).judgments[0].say).toContain('صحيح');
    expect(obj(await invoke({ action: 'searchBooks', query: 'بخاري' }))[0].title).toContain('البخاري');
  });

  it('validates required args', async () => {
    expect(await invoke({ action: 'axisTakhrij' })).toEqual({ error: 'hadithMainId required' });
  });

  it('throws on an unknown action', async () => {
    await expect(invoke({ action: 'nope' })).rejects.toThrow(/Unknown JKHSSN IPC action/);
  });
});
