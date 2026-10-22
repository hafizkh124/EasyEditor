import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parseGlossary, type GlossaryEntry } from "@/lib/translate/glossary";

/**
 * The user's book translations (`translation_projects`, hosted only — the
 * same tables and the same exemption as useBookTranslation.ts), kept apart
 * from that hook so Files can list them without loading the PDF pipeline.
 */

export interface BookTranslationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** Book translations, newest first, for Files → Results. Off (empty) when `userId` is null. */
export function useBookTranslationList(userId: string | null): { items: BookTranslationSummary[]; loading: boolean } {
  const [items, setItems] = useState<BookTranslationSummary[]>([]);
  const [loading, setLoading] = useState(Boolean(userId));
  useEffect(() => {
    if (!userId) {
      setItems([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    void supabase
      .from("translation_projects")
      .select("id, title, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(100)
      .then(({ data }) => {
        if (!alive) return;
        setItems((data ?? []).map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at })));
        setLoading(false);
      });
    return () => { alive = false; };
  }, [userId]);
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

export async function loadEarlierGlossaries(userId: string, excludeProjectId?: string | null): Promise<EarlierGlossary[]> {
  const { data, error } = await supabase
    .from("translation_projects")
    .select("id, title, glossary")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(30);
  if (error || !data) return [];
  return (data as unknown as Array<{ id: string; title: string; glossary?: unknown }>)
    .filter((row) => row.id !== excludeProjectId)
    .map((row) => ({ projectId: row.id, title: row.title, entries: parseGlossary(row.glossary) }))
    .filter((g) => g.entries.length > 0);
}
