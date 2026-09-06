import { app, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { PROVIDERS, type ProviderId } from '../../shared/agent/providers.js';

/**
 * M9 Phase C — per-provider BYOK key storage.
 *
 * One encrypted file per provider under userData: `byok_<id>.enc`. The Gemini
 * file name is `byok_gemini.enc`, unchanged from M8, so an existing key keeps
 * working. Each key is encrypted with OS `safeStorage` and never leaves the
 * main process in the clear. A headless / eval context with no saved key falls
 * back to the provider's env var (`GEMINI_API_KEY`, `GROQ_API_KEY`, …).
 */

function keyFileName(provider: ProviderId): string {
  return `byok_${provider}.enc`;
}

function keyFilePath(provider: ProviderId): string {
  // Reaches into Electron `app` — callers guard for the headless case.
  return path.join(app.getPath('userData'), keyFileName(provider));
}

export interface KeyStatus {
  hasKey: boolean;
  lastFour: string | null;
  /** true when the key comes from the process env, not the encrypted store. */
  fromEnv?: boolean;
}

export async function saveProviderKey(provider: ProviderId, key: string): Promise<boolean> {
  const trimmed = key.trim();
  if (!trimmed) throw new Error('Key cannot be empty');
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS safeStorage encryption is not available on this device');
  }
  await fs.writeFile(keyFilePath(provider), safeStorage.encryptString(trimmed));
  return true;
}

export async function deleteProviderKey(provider: ProviderId): Promise<void> {
  try {
    await fs.unlink(keyFilePath(provider));
  } catch { /* not there — fine */ }
}

/** The decrypted key for API requests — main-process only. Saved key wins; env is the fallback. */
export async function getProviderKey(provider: ProviderId): Promise<string | null> {
  try {
    const buf = await fs.readFile(keyFilePath(provider));
    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(buf);
      if (decrypted) return decrypted;
    }
  } catch {
    /* no Electron app, no saved key, or safeStorage unavailable — env fallback */
  }
  const envVar = PROVIDERS[provider].keyEnvVar;
  return process.env[envVar]?.trim() || null;
}

/** Whether a key exists + its last 4 chars, for UI status. Never returns the key. */
export async function getProviderKeyStatus(provider: ProviderId): Promise<KeyStatus> {
  try {
    const buf = await fs.readFile(keyFilePath(provider));
    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(buf);
      if (decrypted) return { hasKey: true, lastFour: decrypted.slice(-4) };
    }
  } catch { /* fall through */ }
  const fromEnv = process.env[PROVIDERS[provider].keyEnvVar]?.trim();
  if (fromEnv) return { hasKey: true, lastFour: fromEnv.slice(-4), fromEnv: true };
  return { hasKey: false, lastFour: null };
}

// ── M8 back-compat: the Gemini-only names the rest of the app still imports ──

export const saveGeminiKey = (key: string): Promise<boolean> => saveProviderKey('gemini', key);
export const getGeminiKeyStatus = (): Promise<KeyStatus> => getProviderKeyStatus('gemini');
export const getDecryptedGeminiKey = (): Promise<string | null> => getProviderKey('gemini');
export const deleteGeminiKey = (): Promise<void> => deleteProviderKey('gemini');
