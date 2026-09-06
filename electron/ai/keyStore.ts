import { app, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';

const KEY_FILE_NAME = 'byok_gemini.enc';

function getKeyFilePath(): string {
  return path.join(app.getPath('userData'), KEY_FILE_NAME);
}

export interface KeyStatus {
  hasKey: boolean;
  lastFour: string | null;
}

/**
 * Encrypts and saves the user's Gemini API key using OS safeStorage.
 * Key never leaves main process memory unencrypted on disk.
 */
export async function saveGeminiKey(key: string): Promise<boolean> {
  const trimmed = key.trim();
  if (!trimmed) {
    throw new Error('Key cannot be empty');
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS safeStorage encryption is not available on this device');
  }

  const encryptedBuffer = safeStorage.encryptString(trimmed);
  const filePath = getKeyFilePath();
  await fs.writeFile(filePath, encryptedBuffer);
  return true;
}

/**
 * Returns whether a key exists and its last 4 characters for UI status display.
 * NEVER returns the full key to renderer.
 */
export async function getGeminiKeyStatus(): Promise<KeyStatus> {
  const filePath = getKeyFilePath();
  try {
    const encryptedBuffer = await fs.readFile(filePath);
    if (!safeStorage.isEncryptionAvailable()) {
      return { hasKey: false, lastFour: null };
    }
    const decryptedKey = safeStorage.decryptString(encryptedBuffer);
    if (!decryptedKey) {
      return { hasKey: false, lastFour: null };
    }
    const lastFour = decryptedKey.length >= 4 ? decryptedKey.slice(-4) : decryptedKey;
    return { hasKey: true, lastFour };
  } catch {
    return { hasKey: false, lastFour: null };
  }
}

/**
 * Internal helper to retrieve the decrypted key for API requests.
 * ONLY callable inside Electron main process.
 *
 * The user's saved BYOK key wins. When there is none (a headless run, or the
 * live eval harness — `AGENT_EVAL_LIVE=1`), `GEMINI_API_KEY` in the process
 * environment is the fallback, matching the edge functions' convention.
 */
export async function getDecryptedGeminiKey(): Promise<string | null> {
  try {
    // `getKeyFilePath` reaches into Electron `app` — guarded so a headless /
    // test context (no `app`) falls straight through to the env fallback.
    const encryptedBuffer = await fs.readFile(getKeyFilePath());
    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(encryptedBuffer);
      if (decrypted) return decrypted;
    }
  } catch {
    /* no Electron app, no saved key, or safeStorage unavailable — env fallback */
  }
  return process.env.GEMINI_API_KEY?.trim() || null;
}

/**
 * Deletes the stored encrypted key.
 */
export async function deleteGeminiKey(): Promise<void> {
  const filePath = getKeyFilePath();
  try {
    await fs.unlink(filePath);
  } catch {
    // Ignore error if file doesn't exist
  }
}
