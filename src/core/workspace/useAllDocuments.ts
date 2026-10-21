import { useState, useEffect, useCallback } from "react";
import { documentService } from "@/core/workspace/documentService";
import type { Project, Document, ProjectKind } from "@/core/workspace/types";
import { logger } from "@/lib/logger";
import { useAuth } from "@/contexts/AuthContext";

const log = logger.child("useAllDocuments");

export interface DocumentWithProject extends Document {
  projectName: string;
  projectKind?: ProjectKind;
}

/**
 * The last result, shared across mounts. Every page wraps itself in AppLayout,
 * so the sidebar's recent list remounts on each navigation; starting from the
 * cached list (and refreshing behind it) keeps it from flashing empty.
 */
let cache: { owner: string | null; projects: Project[]; docsMap: Record<string, Document[]>; allDocs: DocumentWithProject[] } | null = null;

/** For tests: forget the shared result. */
export function resetAllDocumentsCache() {
  cache = null;
}

export function useAllDocuments() {
  // Keyed by account so a sign-out never shows the next person the last one's files.
  const owner = useAuth()?.user?.id ?? null;
  if (cache && cache.owner !== owner) cache = null;
  const [projects, setProjects] = useState<Project[]>(cache?.projects ?? []);
  const [docsMap, setDocsMap] = useState<Record<string, Document[]>>(cache?.docsMap ?? {});
  const [allDocs, setAllDocs] = useState<DocumentWithProject[]>(cache?.allDocs ?? []);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const projList = (await documentService.listProjects()) ?? [];
      setProjects(projList);

      if (projList.length === 0) {
        cache = { owner, projects: projList, docsMap: {}, allDocs: [] };
        setDocsMap({});
        setAllDocs([]);
        setLoading(false);
        return;
      }

      // Parallel fetch across all projects instead of N+1 sequential loop
      const docResults = await Promise.all(
        projList.map(async (p: Project) => {
          try {
            const list = (await documentService.listDocuments(p.id)) ?? [];
            return { projectId: p.id, project: p, docs: list };
          } catch {
            return { projectId: p.id, project: p, docs: [] };
          }
        }),
      );

      const map: Record<string, Document[]> = {};
      const flatList: DocumentWithProject[] = [];

      for (const res of docResults) {
        map[res.projectId] = res.docs;
        for (const doc of res.docs) {
          flatList.push({
            ...doc,
            projectName: res.project.title,
            projectKind: res.project.kind,
          });
        }
      }

      cache = { owner, projects: projList, docsMap: map, allDocs: flatList };
      setDocsMap(map);
      setAllDocs(flatList);
    } catch (err) {
      log.warn("error loading documents", { err });
    } finally {
      setLoading(false);
    }
  }, [owner]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { projects, docsMap, allDocs, loading, refresh };
}
