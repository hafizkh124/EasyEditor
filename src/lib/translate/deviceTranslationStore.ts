import type { NewTranslationProject, TranslationChunk, TranslationProject, TranslationStore } from "./translationStore";

/**
 * Book translations kept on this computer (IndexedDB) — the desktop signed
 * out, translating with its own key (SYSTEM-2026 §10). Nothing here leaves
 * the device. Where IndexedDB is unavailable every read is empty and writes
 * are dropped, so the translator still works for the visit.
 */

const DB_NAME = "easyeditor-translations";
const PROJECTS = "projects";
const CHUNKS = "chunks";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore(PROJECTS, { keyPath: "id" });
        const chunks = db.createObjectStore(CHUNKS, { keyPath: ["project_id", "chunk_index"] });
        chunks.createIndex("project", "project_id");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function request<T>(store: string, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const req = op(db.transaction(store, mode).objectStore(store));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

const now = () => new Date().toISOString();
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const deviceTranslationStore: TranslationStore = {
  kind: "device",

  async createProject(row: NewTranslationProject) {
    const id = newId();
    await request(PROJECTS, "readwrite", (s) => s.put({ ...row, id, updated_at: now() }));
    return id;
  },

  async updateProject(id, patch) {
    const prev = await request<TranslationProject | undefined>(PROJECTS, "readonly", (s) => s.get(id) as IDBRequest<TranslationProject | undefined>);
    if (!prev) return;
    await request(PROJECTS, "readwrite", (s) => s.put({ ...prev, ...patch, id, updated_at: now() }));
  },

  async getProject(id) {
    return (await request<TranslationProject | undefined>(PROJECTS, "readonly", (s) => s.get(id) as IDBRequest<TranslationProject | undefined>)) ?? null;
  },

  async listProjects(limit = 100) {
    const all = (await request<TranslationProject[]>(PROJECTS, "readonly", (s) => s.getAll() as IDBRequest<TranslationProject[]>)) ?? [];
    return all.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, limit);
  },

  async upsertChunk(row: TranslationChunk) {
    await request(CHUNKS, "readwrite", (s) => s.put(row));
    // A page saved is the project touched, for "newest first".
    await deviceTranslationStore.updateProject(row.project_id, {});
  },

  async listChunks(projectId) {
    return (
      (await request<TranslationChunk[]>(CHUNKS, "readonly", (s) =>
        s.index("project").getAll(projectId) as IDBRequest<TranslationChunk[]>,
      )) ?? []
    );
  },
};
