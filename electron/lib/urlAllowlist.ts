/**
 * SPEC-M5 FR-2.2: `shell.openExternal` may only be reached with an
 * allowlisted https host — never whatever URL a renderer script, a
 * navigation event, or an IPC call happens to hand over. Shared by
 * electron/main.ts (window-open / navigation interception) and
 * electron/ipc/systemHandlers.ts (the explicit open-external IPC channel)
 * so the two enforce exactly the same rule rather than two versions of it.
 */
/**
 * Substituted at build time by vite.config.ts's electron `define` map. Guarded
 * because this module is also imported by the Vitest suite, where no define
 * pass runs and the value is simply absent.
 */
const supabaseHost = (() => {
  try {
    return new URL(import.meta.env.VITE_SUPABASE_URL).hostname;
  } catch {
    return null;
  }
})();

const ALLOWED_EXTERNAL_HOSTS = new Set([
  'shamela.ws',
  'github.com',
  'aistudio.google.com',
  'huggingface.co',
  // Optional cloud sign-in: the OAuth consent page opens in the user's real
  // browser (Google refuses to authenticate inside an embedded window, and a
  // file:// renderer has no origin to redirect back to). Supabase issues the
  // authorize URL on its own host and redirects on from there, so both hosts
  // have to be openable.
  'accounts.google.com',
  ...(supabaseHost ? [supabaseHost] : []),
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
