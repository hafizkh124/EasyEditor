// @vitest-environment node
// electron/shamela/cloudOAuth.ts (ADR-0044) — the OAuth client provider + the
// one-shot loopback callback server.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createElectronMock } from './helpers/electronMock';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-scloud-'));
const electron = createElectronMock();
electron.app.getPath = vi.fn(() => tmp);
// A trivial "encryption" so blobs round-trip in the test.
(electron as unknown as { safeStorage: unknown }).safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(`enc:${s}`),
  decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
};
vi.mock('electron', () => electron);

let mod: typeof import('../../electron/shamela/cloudOAuth');

/** Fire a one-shot request at the loopback server (no keep-alive agent). */
function hit(url: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { agent: false }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
    });
    req.on('error', reject);
  });
}

beforeAll(async () => { mod = await import('../../electron/shamela/cloudOAuth'); });

beforeEach(() => {
  vi.clearAllMocks();
  electron.app.getPath = vi.fn(() => tmp);
  for (const f of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, f), { force: true });
  mod.abortFlow('reset');
});

afterAll(() => {
  mod.stopLoopbackServer();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('ShamelaCloudOAuthProvider', () => {
  it('clientMetadata is a public native client with loopback redirect URIs', () => {
    const p = new mod.ShamelaCloudOAuthProvider();
    const m = p.clientMetadata;
    expect(m.token_endpoint_auth_method).toBe('none');
    expect(m.grant_types).toContain('authorization_code');
    expect(m.grant_types).toContain('refresh_token');
    expect((m.redirect_uris as string[]).every((u) => u.startsWith('http://127.0.0.1:'))).toBe(true);
    expect(m.redirect_uris).toEqual([...mod.REDIRECT_URIS]);
  });

  it('tokens + clientInformation round-trip through safeStorage', () => {
    const p = new mod.ShamelaCloudOAuthProvider();
    expect(p.tokens()).toBeUndefined();
    expect(mod.hasSavedAccount()).toBe(false);
    p.saveTokens({ access_token: 'AT', token_type: 'Bearer', refresh_token: 'RT' } as never);
    p.saveClientInformation({ client_id: 'cid' } as never);
    expect(p.tokens()?.access_token).toBe('AT');
    expect(p.clientInformation()?.client_id).toBe('cid');
    expect(mod.hasSavedAccount()).toBe(true);
  });

  it('invalidateCredentials deletes the right blobs', () => {
    const p = new mod.ShamelaCloudOAuthProvider();
    p.saveTokens({ access_token: 'AT', token_type: 'Bearer' } as never);
    p.saveClientInformation({ client_id: 'cid' } as never);
    p.invalidateCredentials('tokens');
    expect(p.tokens()).toBeUndefined();
    expect(p.clientInformation()?.client_id).toBe('cid');
    p.invalidateCredentials('all');
    expect(p.clientInformation()).toBeUndefined();
  });

  it('state() is stable within a flow and a fresh random after invalidate', () => {
    const p = new mod.ShamelaCloudOAuthProvider();
    const a = p.state();
    expect(p.state()).toBe(a);
    p.invalidateCredentials('verifier');
    expect(p.state()).not.toBe(a);
  });

  it('redirectToAuthorization refuses a non-https URL', async () => {
    const p = new mod.ShamelaCloudOAuthProvider();
    await expect(p.redirectToAuthorization(new URL('http://evil.example/authorize'))).rejects.toThrow(/non-https/);
    expect(electron.shell.openExternal).not.toHaveBeenCalled();
  });

  it('redirectToAuthorization starts the loopback + opens the browser; the callback yields the code', async () => {
    const p = new mod.ShamelaCloudOAuthProvider();
    p.saveCodeVerifier('v');
    const state = p.state();
    await p.redirectToAuthorization(new URL('https://shamela.link/oauth/authorize?x=1'));
    expect(electron.shell.openExternal).toHaveBeenCalledWith('https://shamela.link/oauth/authorize?x=1');

    const codePromise = mod.waitForLoopbackCode();
    const { status } = await hit(`${mod.activeRedirectUri()}?code=THECODE&state=${state}`);
    expect(status).toBe(200);
    await expect(codePromise).resolves.toBe('THECODE');
  });

  it('a callback with a mismatched state rejects', async () => {
    const p = new mod.ShamelaCloudOAuthProvider();
    p.state();
    await p.redirectToAuthorization(new URL('https://shamela.link/a'));
    const rejected = expect(mod.waitForLoopbackCode()).rejects.toThrow(/state mismatch/);
    const { status } = await hit(`${mod.activeRedirectUri()}?code=X&state=WRONG`);
    expect(status).toBe(400);
    await rejected;
  });

  it('a callback with ?error rejects', async () => {
    const p = new mod.ShamelaCloudOAuthProvider();
    await p.redirectToAuthorization(new URL('https://shamela.link/a'));
    const rejected = expect(mod.waitForLoopbackCode()).rejects.toThrow(/access_denied/);
    await hit(`${mod.activeRedirectUri()}?error=access_denied`);
    await rejected;
  });

  it('a non-/callback path 404s and does not settle the flow', async () => {
    const p = new mod.ShamelaCloudOAuthProvider();
    await p.redirectToAuthorization(new URL('https://shamela.link/a'));
    const rejected = expect(mod.waitForLoopbackCode()).rejects.toThrow(/cleanup/);
    const { status } = await hit(`http://127.0.0.1:${new URL(mod.activeRedirectUri()).port}/favicon.ico`);
    expect(status).toBe(404);
    expect(mod.isFlowPending()).toBe(true); // the 404 path left the flow alone
    mod.abortFlow('cleanup');
    await rejected;
  });

  it('abortFlow rejects a waiting code promise and stops the server', async () => {
    const p = new mod.ShamelaCloudOAuthProvider();
    await p.redirectToAuthorization(new URL('https://shamela.link/a'));
    const rejected = expect(mod.waitForLoopbackCode()).rejects.toThrow(/cancelled/);
    expect(mod.isFlowPending()).toBe(true);
    mod.abortFlow('cancelled');
    await rejected;
    expect(mod.isFlowPending()).toBe(false);
  });
});
