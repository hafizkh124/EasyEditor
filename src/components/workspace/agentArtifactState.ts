/**
 * M9 ADR-0024 — reducer for the live artifact list.
 *
 * Pure state-folding, kept out of the component file so the panel stays a
 * component-only module (react-refresh) and this is unit-testable on its own.
 */
import type { AgentArtifactEvent, AgentArtifactType } from "../../../shared/agent/types";

export interface ArtifactCitationEntry {
  marker: string;
  reference: string;
  sourceId: string;
  supported?: boolean;
  url?: string;
  tier?: 1 | 2 | 3 | 4;
  /** The retrieved source passage — shown on expand, before the scholar accepts the tracked change. */
  excerpt?: string;
  /** The claim this citation supports, when one was given. */
  claim?: string;
}

export interface ArtifactState {
  id: string;
  title: string;
  type: AgentArtifactType;
  status: "open" | "final" | "aborted";
  html?: string;
  text?: string;
  table?: { columns: string[]; rows: string[][]; caption?: string };
  citations?: ArtifactCitationEntry[];
  targetChapter?: string;
}

/** Fold one artifact event into the ordered artifact list. */
export function applyArtifactEvent(prev: ArtifactState[], ev: AgentArtifactEvent): ArtifactState[] {
  const next = [...prev];
  const idx = next.findIndex((a) => a.id === ev.artifactId);
  const at = (patch: Partial<ArtifactState>) => {
    if (idx !== -1) next[idx] = { ...next[idx], ...patch };
  };

  switch (ev.op) {
    case "open":
      if (idx === -1) next.push({ id: ev.artifactId, title: ev.title, type: ev.artifactType, status: "open" });
      else at({ title: ev.title, type: ev.artifactType, status: "open" });
      break;
    case "delta": {
      if (idx === -1) break;
      const cur = next[idx];
      at({
        html: ev.html !== undefined ? (ev.mode === "append" ? (cur.html ?? "") + ev.html : ev.html) : cur.html,
        text: ev.text !== undefined ? (ev.mode === "append" ? (cur.text ?? "") + ev.text : ev.text) : cur.text,
      });
      break;
    }
    case "table":
      at({ table: { columns: ev.columns, rows: ev.rows, caption: ev.caption } });
      break;
    case "citations":
      at({ citations: ev.entries });
      break;
    case "close":
      at({ status: ev.status === "final" ? "final" : "aborted", targetChapter: ev.targetChapter });
      break;
  }
  return next;
}
