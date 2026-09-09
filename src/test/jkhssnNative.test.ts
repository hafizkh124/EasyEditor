// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createElectronMock } from './helpers/electronMock';

const electron = createElectronMock();
vi.mock('electron', () => electron);

let userData: string;
let install: string;

beforeEach(() => {
  process.env.JKHSSN_NO_CANDIDATE_SCAN = '1'; // hermetic — ignore any real D:\JKHSSN
  delete process.env.JKHSSN_DATA_PATH;
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jkhssn-ud-'));
  install = fs.mkdtempSync(path.join(os.tmpdir(), 'jkhssn-inst-'));
  electron.app.getPath.mockImplementation((key: string) => {
    if (key === 'userData') return userData;
    throw new Error(`unexpected getPath(${key})`);
  });
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(install, { recursive: true, force: true });
  delete process.env.JKHSSN_NO_CANDIDATE_SCAN;
  vi.resetModules();
});

async function load() {
  return import('../../electron/jkhssn/jkhssnNative');
}

describe('jkhssnNative detection', () => {
  it('reports not-installed with an Urdu reason when nothing is found', async () => {
    const { detectJkhssnInstallation } = await load();
    const s = await detectJkhssnInstallation();
    expect(s.installed).toBe(false);
    expect(s.indexBuilt).toBe(false);
    expect(s.reason).toMatch(/[\u0600-\u06FF]/);
  });

  it('round-trips a saved data-path override', async () => {
    const { saveJkhssnPath, getSavedJkhssnPath } = await load();
    saveJkhssnPath('D:\\Custom\\JKHSSN\\Data\\HadithDB');
    expect(getSavedJkhssnPath()).toBe('D:\\Custom\\JKHSSN\\Data\\HadithDB');
    expect(fs.existsSync(path.join(userData, 'jkhssn_config.json'))).toBe(true);
  });

  it('finds the HadithDB via a saved override and reports index-not-built', async () => {
    const hadithDb = path.join(install, 'Data', 'HadithDB');
    fs.mkdirSync(hadithDb, { recursive: true });
    fs.writeFileSync(path.join(hadithDb, 'Catalog.xml'), '<Catalog/>');
    fs.mkdirSync(path.join(hadithDb, 'Nouns'));
    fs.writeFileSync(path.join(hadithDb, 'Nouns', 'Catalog.xml'), '<Table/>');

    const { saveJkhssnPath, detectJkhssnInstallation } = await load();
    saveJkhssnPath(install); // root; detection walks into Data/HadithDB
    const s = await detectJkhssnInstallation();
    expect(s.installed).toBe(true);
    expect(s.dataPath).toBe(hadithDb);
    expect(s.catalogFound).toBe(true);
    expect(s.indexBuilt).toBe(false);
    expect(s.reason).toMatch(/[\u0600-\u06FF]/);
  });

  it('diagnostics enumerate readable tables and surface Urdu errors', async () => {
    const hadithDb = path.join(install, 'Data', 'HadithDB');
    fs.mkdirSync(path.join(hadithDb, 'Nouns'), { recursive: true });
    fs.writeFileSync(path.join(hadithDb, 'Catalog.xml'), '<Catalog/>');
    fs.writeFileSync(path.join(hadithDb, 'Nouns', 'Catalog.xml'), '<Table/>');

    const { saveJkhssnPath, diagnoseJkhssnInstallation } = await load();
    saveJkhssnPath(install);
    const d = await diagnoseJkhssnInstallation();
    expect(d.catalogFound).toBe(true);
    expect(d.readableTables).toBeGreaterThanOrEqual(1);
    expect(d.indexBuilt).toBe(false);
    expect(d.errors.some((e) => /[\u0600-\u06FF]/.test(e))).toBe(true);
  });
});
