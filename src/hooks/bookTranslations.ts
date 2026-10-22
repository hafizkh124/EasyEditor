import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isDesktop } from "@/utils/environment";
import { parseGlossary, type GlossaryEntry } from "@/lib/translate/glossary";
import type { TranslationChunk, TranslationProject, TranslationStore } from "@/lib/translate/translationStore";
import { deviceTranslationStore } from "@/lib/translate/deviceTranslationStore";

/**
 * Where the user's book translations live, and the reads Files needs, kept
 * apart from useBookTranslation.ts so Files can list them without loading
 * the PDF pipeline. Signed in: the account's `translation_projects` tables
 * (hosted only — the same exemption as useBookTranslation.ts). A desktop
 * that is not signed in keeps them on the computer (SYSTEM-2026 §10).
 */

/**
 * Newer columns (glossary, style, reviewed — migration 20261022000000) may
 * not exist yet where the migration has not run; a call naming one is
 * retried without them rather than failing the translation.
 */
function mentionsColumn(error: { message?: string } | null, columns: readonly string[]): boolean {
  const msg = error?.message ?? "";
  return columns.some((c) => msg.includes(c));
}

const NEW_PROJECT_COLUMNS = ["glossary", "style"] as const;
const PROJECT_COLUMNS = "id, title, source_lang, target_lang, genre, status, source_ref, project_id, updated_at";
const CHUNK_COLUMNS = "project_id, chunk_index, source_text, translated_text, status";

function without<T extends Record<string, unknown>>(row: T, keys: readonly string[]): T {
  const copy = { ...row };
  for (const k of keys) delete copy[k];
  return copy;
}

function accountStore(userId: string): TranslationStore {
  // The generated types predate the newer columns; rows are shaped by TranslationProject.
  const projects = () => supabase.from("translation_projects") as unknown as ReturnType<typeof supabase.from>;
  return {
    kind: "account",

    async createProject(row) {
      const insert = (values: Record<string, unknown>) =>
        projects().insert({ ...values, user_id: userId } as never).select("id").single();
      let { data, error } = await insert(row as unknown as Record<string, unknown>);
      if (error && mentionsColumn(error, NEW_PROJECT_COLUMNS)) {
        ({ data, error } = await insert(without(row as unknown as Record<string, unknown>, NEW_PROJECT_COLUMNS)));
      }
      if (error || !data) throw new Error(error?.message ?? "Could not create the translation project.");
      return (data as { id: string }).id;
    },

    async updateProject(id, patch) {
      const update = (values: Record<string, unknown>) => projects().update(values as never).eq("id", id);
      let { error } = await update(patch as Record<string, unknown>);
      if (error && mentionsColumn(error, NEW_PROJECT_COLUMNS)) {
        const rest = without(patch as Record<string, unknown>, NEW_PROJECT_COLUMNS);
        ({ error } = Object.keys(rest).length ? await update(rest) : { error: null });
      }
      if (error) throw new Error(error.message);
    },

    async getProject(id) {
      const read = (columns: string) => projects().select(columns).eq("id", id).single();
      let { data, error } = await read(`${PROJECT_COLUMNS}, style, glossary`);
      if (error && mentionsColumn(error, NEW_PROJECT_COLUMNS)) ({ data, error } = await read(PROJECT_COLUMNS));
      return error || !data ? null : (data as unknown as TranslationProject);
    },

    async listProjects(limit = 100) {
      const read = (columns: string) =>
        projects().select(columns).eq("user_id", userId).order("updated_at", { ascending: false }).limit(limit);
      let { data, error } = await read(`${PROJECT_COLUMNS}, glossary`);
      if (error && mentionsColumn(error, NEW_PROJECT_COLUMNS)) ({ data, error } = await read(PROJECT_COLUMNS));
      return (data ?? []) as unknown as TranslationProject[];
    },

    async upsertChunk(row) {
      const upsert = (values: Record<string, unknown>) =>
        supabase.from("translation_chunks").upsert(values as never, { onConflict: "project_id,chunk_index" });
      let { error } = await upsert(row as unknown as Record<string, unknown>);
      if (error && mentionsColumn(error, ["reviewed"])) ({ error } = await upsert(without(row as unknown as Record<string, unknown>, ["reviewed"])));
      if (error) throw new Error(error.message);
    },

    async listChunks(projectId) {
      const read = (columns: string) => supabase.from("translation_chunks").select(columns).eq("project_id", projectId);
      const first = await read(`${CHUNK_COLUMNS}, reviewed`);
      let data = first.data;
      if (first.error && mentionsColumn(first.error, ["reviewed"])) ({ data } = await read(CHUNK_COLUMNS));
      return (data ?? []) as unknown as TranslationChunk[];
    },
  };
}

/**
 * The store for this user: their account when signed in; this computer on a
 * desktop that is not; none on the web signed out (nothing to translate with).
 */
export function getTranslationStore(userId: string | null | undefined): TranslationStore | null {
  if (userId) return accountStore(userId);
  return isDesktop() ? deviceTranslationStore : null;
}

export interface BookTranslationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** Book translations, newest first, for Files → Results. Off (empty) when `enabled` is false. */
export function useBookTranslationList(
  userId: string | null,
  enabled = true,
): { items: BookTranslationSummary[]; loading: boolean } {
  const [items, setItems] = useState<BookTranslationSummary[]>([]);
  const store = enabled ? getTranslationStore(userId) : null;
  const storeKey = store ? `${store.kind}:${userId ?? ""}` : null;
  const [loading, setLoading] = useState(Boolean(store));
  useEffect(() => {
    const current = storeKey ? getTranslationStore(userId) : null;
    if (!current) {
      setItems([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    void current.listProjects(100).then((rows) => {
      if (!alive) return;
      setItems(rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at })));
      setLoading(false);
    }).catch(() => alive && setLoading(false));
    return () => { alive = false; };
    // storeKey stands for (store kind, user).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeKey]);
  return { items, loading };
}

/**
 * Glossaries from the user's earlier translations, newest first, so a series
 * keeps its terms from one book to the next (SYSTEM-2026 §6). Empty where the
 * glossary column does not exist yet.
 */
export interface EarlierGlossary {
  projectId: string;
  title: string;
  entries: GlossaryEntry[];
}

export async function loadEarlierGlossaries(userId: string | null, excludeProjectId?: string | null): Promise<EarlierGlossary[]> {
  const store = getTranslationStore(userId);
  if (!store) return [];
  const rows = await store.listProjects(30).catch(() => []);
  return rows
    .filter((row) => row.id !== excludeProjectId)
    .map((row) => ({ projectId: row.id, title: row.title, entries: parseGlossary(row.glossary) }))
    .filter((g) => g.entries.length > 0);
}
