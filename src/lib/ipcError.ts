/**
 * Electron wraps anything thrown inside an `ipcMain.handle` as
 * "Error invoking remote method 'ai:invoke': Error: <message>", so a toast built
 * from `err.message` shows the plumbing instead of the reason. This returns just
 * the reason (`[Could not read file]`, "no Gemini key — add yours in Settings", …).
 */
export function cleanIpcError(input: unknown): string {
  const raw = input instanceof Error ? input.message : String(input ?? "");
  const cleaned = raw
    .replace(/^Error invoking remote method '[^']*':\s*/, "")
    // the original error's own class prefix: "Error: ", "ByokApiError: ", "TypeError: " …
    .replace(/^[A-Za-z]*Error:\s*/, "")
    .trim();
  return cleaned || raw;
}
