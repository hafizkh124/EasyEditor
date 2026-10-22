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

interface Snapshot {
  owner: string | null;
  projects: Project[];
  docsMap: Record<string, Document[]>;
  allDocs: DocumentWithProject[];
  fetchedAt: number;
}

/** A mount-time read newer than this is reused instead of refetched. */
const FRESH_MS = 30_000;

/**
 * The last result, shared across mounts. Every page wraps itself in AppLayout,
 * so the sidebar's recent list remounts on each navigation; starting from the
 * cached list (and refreshing behind it) keeps it from flashing empty.
 *
 * The workspace mounts this hook in ~8 places at once. Each used to fetch the
 * whole tree on its own (48 `documents` requests on one page load), so all
 * mounts now share one in-flight load and one fresh result.
 */
let cache: Snapshot | null = null;
let inflight: { owner: string | null; promise: Promise<Snapshot | null> } | null = null;
const subscribers = new Set<(s: Snapshot) => void>();

/** For tests: forget the shared result. */
export function resetAllDocumentsCache() {
  cache = null;
  inflight = null;
}

async function loadAll(owner: string | null): Promise<Snapshot | null> {
  try {
    const projList = (await documentService.listProjects()) ?? [];

    if (projList.length === 0) {
      return { owner, projects: projList, docsMap: {}, allDocs: [], fetchedAt: Date.now() };
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

    return { owner, projects: projList, docsMap: map, allDocs: flatList, fetchedAt: Date.now() };
  } catch (err) {
    log.warn("error loading documents", { err });
    return null;
  }
}

/** One load at a time per account; `force` skips the freshness window. */
function load(owner: string | null, force: boolean): Promise<Snapshot | null> {
  if (!force && cache && cache.owner === owner && Date.now() - cache.fetchedAt < FRESH_MS) {
    return Promise.resolve(cache);
  }
  if (inflight && inflight.owner === owner) return inflight.promise;

  const promise = loadAll(owner).then((snap) => {
    if (inflight?.promise === promise) inflight = null;
    if (snap) {
      cache = snap;
      subscribers.forEach((fn) => fn(snap));
    }
    return snap;
  });
  inflight = { owner, promise };
  return promise;
}

export function useAllDocuments() {
  // Keyed by account so a sign-out never shows the next person the last one's files.
  const owner = useAuth()?.user?.id ?? null;
  if (cache && cache.owner !== owner) cache = null;
  const [projects, setProjects] = useState<Project[]>(cache?.projects ?? []);
  const [docsMap, setDocsMap] = useState<Record<string, Document[]>>(cache?.docsMap ?? {});
  const [allDocs, setAllDocs] = useState<DocumentWithProject[]>(cache?.allDocs ?? []);
  const [loading, setLoading] = useState(false);

  const apply = useCallback(
    (snap: Snapshot) => {
      if (snap.owner !== owner) return;
      setProjects(snap.projects);
      setDocsMap(snap.docsMap);
      setAllDocs(snap.allDocs);
    },
    [owner],
  );

  // Callers invoke `refresh` after a mutation, so it always goes to the network.
  const run = useCallback(
    async (force: boolean) => {
      setLoading(true);
      try {
        const snap = await load(owner, force);
        if (snap) apply(snap);
      } finally {
        setLoading(false);
      }
    },
    [owner, apply],
  );

  const refresh = useCallback(() => run(true), [run]);

  useEffect(() => {
    subscribers.add(apply);
    return () => {
      subscribers.delete(apply);
    };
  }, [apply]);

  useEffect(() => {
    void run(false);
  }, [run]);

  return { projects, docsMap, allDocs, loading, refresh };
}
