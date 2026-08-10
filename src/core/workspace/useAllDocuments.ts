import { useState, useEffect, useCallback } from "react";
import { documentService } from "@/core/workspace/documentService";
import type { Project, Document, ProjectKind } from "@/core/workspace/types";
import { logger } from "@/lib/logger";

const log = logger.child("useAllDocuments");

export interface DocumentWithProject extends Document {
  projectName: string;
  projectKind?: ProjectKind;
}

export function useAllDocuments() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [docsMap, setDocsMap] = useState<Record<string, Document[]>>({});
  const [allDocs, setAllDocs] = useState<DocumentWithProject[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const projList = await documentService.listProjects();
      setProjects(projList);

      if (projList.length === 0) {
        setDocsMap({});
        setAllDocs([]);
        setLoading(false);
        return;
      }

      // Parallel fetch across all projects instead of N+1 sequential loop
      const docResults = await Promise.all(
        projList.map(async (p: Project) => {
          try {
            const list = await documentService.listDocuments(p.id);
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

      setDocsMap(map);
      setAllDocs(flatList);
    } catch (err) {
      log.warn("error loading documents", { err });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { projects, docsMap, allDocs, loading, refresh };
}
