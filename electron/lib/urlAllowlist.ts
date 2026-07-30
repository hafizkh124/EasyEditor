/**
 * SPEC-M5 FR-2.2: `shell.openExternal` may only be reached with an
 * allowlisted https host — never whatever URL a renderer script, a
 * navigation event, or an IPC call happens to hand over. Shared by
 * electron/main.ts (window-open / navigation interception) and
 * electron/ipc/systemHandlers.ts (the explicit open-external IPC channel)
 * so the two enforce exactly the same rule rather than two versions of it.
 */
const ALLOWED_EXTERNAL_HOSTS = new Set([
  'shamela.ws',
  'github.com',
  'aistudio.google.com',
  'huggingface.co',
]);

/** Returns the parsed URL if it is allowed to be opened externally, else null. */
export function isAllowedExternalUrl(rawUrl: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null; // rules out http:, file:, javascript:, etc.
  if (!ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname)) return null;
  return parsed;
}
