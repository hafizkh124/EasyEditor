/**
 * Local copies of a job's input and progress (SYSTEM-2026 §9), so a job the
 * app closed on can resume where it stopped instead of starting over — and
 * without asking the user to pick the same file again. IndexedDB, in this
 * browser or desktop profile only; nothing here leaves the device.
 *
 * Every call is best-effort: where IndexedDB is unavailable (private mode,
 * tests) the stash is simply empty and jobs start over.
 */

const DB_NAME = "easyeditor-jobs";
const STORE = "stash";

export interface Stash {
  file?: Blob;
  fileName?: string;
  /** Runner-defined progress, e.g. the text of the pages already read. */
  progress?: unknown;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const req = op(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function readStash(key: string): Promise<Stash | undefined> {
  return run<Stash | undefined>("readonly", (s) => s.get(key) as IDBRequest<Stash | undefined>);
}

/** Merge into what is stored under `key`. */
export async function writeStash(key: string, patch: Stash): Promise<void> {
  const prev = (await readStash(key)) ?? {};
  await run("readwrite", (s) => s.put({ ...prev, ...patch }, key));
}

export async function deleteStash(key: string): Promise<void> {
  await run("readwrite", (s) => s.delete(key));
}
