/**
 * M8 Layer 6 — the shape the agent needs to know about this machine's tools
 * (SPEC-M8 §3, "This machine's capabilities" strip). Kept minimal and pure;
 * the real detection lives in electron/host/detectTools.ts.
 */
export interface ToolAvailabilityLike {
  word: boolean;
  wordVersion: string | null;
  windows: boolean;
  libreoffice?: boolean;
  inpage?: boolean;
}

/** A one-line, user-facing summary for the capabilities strip. */
export function summariseCapabilities(c: ToolAvailabilityLike): string {
  const parts: string[] = [];
  parts.push(c.word ? `Word ${c.wordVersion ?? ''}`.trim() : 'Word: not found');
  if (c.libreoffice) parts.push('LibreOffice');
  if (c.inpage) parts.push('InPage');
  if (!c.windows) parts.push('(not Windows — Word automation unavailable)');
  return parts.join(' · ');
}
