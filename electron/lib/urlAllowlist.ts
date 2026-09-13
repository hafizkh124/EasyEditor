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
  // BYOK "Get a free key" deep links (M9 Phase C, ADR-0031).
  'console.groq.com',
  'openrouter.ai',
  'huggingface.co',
  // Optional cloud sign-in (device-link flow, 2026-09-13): the project's
  // Google OAuth provider only works through Lovable's managed web broker,
  // which a file:// renderer has no origin to use directly. Desktop instead
  // opens the web app's own /connect-device page in the user's real browser
  // to confirm a short-lived code — see src/lib/desktopDeviceLink.ts.
  'editor.alulama.org',
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
