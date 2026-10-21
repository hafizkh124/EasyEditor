import type { Project } from "@/core/workspace/types";
import { documentService } from "@/core/workspace/documentService";

/**
 * A folder's pinned sources (SYSTEM-2026 §3, §8): the books every chat in the
 * folder answers from. Kept in the folder's `meta`, so no schema change.
 *
 * `ref` uses the chat scope's own forms — `shamela:<bookId>`, `jkhssn:<id>`,
 * `corpus:<libraryItemId>` — so pinned sources pass straight into a run.
 */
export interface PinnedSource {
  ref: string;
  label: string;
  sublabel?: string;
}

export type SourceKind = "shamela" | "jkhssn" | "corpus";

export function sourceKind(ref: string): SourceKind | null {
  const kind = ref.split(":", 1)[0];
  return kind === "shamela" || kind === "jkhssn" || kind === "corpus" ? kind : null;
}

/** The Shamela book id behind a ref, for opening it in the reader; null for other kinds. */
export function shamelaBookIdOf(ref: string): string | null {
  return ref.startsWith("shamela:") ? ref.slice("shamela:".length) || null : null;
}

export function pinnedSourcesOf(project: Pick<Project, "meta"> | null | undefined): PinnedSource[] {
  const raw = (project?.meta as { pinnedSources?: unknown } | null | undefined)?.pinnedSources;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is PinnedSource =>
      !!s && typeof s === "object" && typeof (s as PinnedSource).ref === "string" && typeof (s as PinnedSource).label === "string",
  );
}

/** Replace the folder's pinned sources, keeping everything else in its `meta`. */
export async function savePinnedSources(project: Project, sources: PinnedSource[]): Promise<Project> {
  const unique = sources.filter((s, i) => sources.findIndex((x) => x.ref === s.ref) === i);
  return documentService.updateProject(project.id, { meta: { ...(project.meta ?? {}), pinnedSources: unique } });
}
