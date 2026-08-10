import { supabase } from "@/integrations/supabase/client";
import type { SessionSection } from "@/hooks/useSessionHistory";
import { logger } from "@/lib/logger";

const log = logger.child("userSessions");

// Escape hatch until migrations are reflected in generated Supabase types.
const fromUserSessions = () =>
  (supabase.from as unknown as (table: string) => ReturnType<typeof supabase.from>)("user_sessions");

interface UpsertArgs {
  id: string | null;
  userId: string;
  section: SessionSection;
  title: string;
  metadata?: Record<string, unknown>;
}

/**
 * Insert (if id is null) or update an existing session.
 * Returns the session id on success, null on failure (e.g. table missing pre-migration).
 */
export async function upsertUserSession({ id, userId, section, title, metadata = {} }: UpsertArgs): Promise<string | null> {
  try {
    if (id) {
      const { error } = await fromUserSessions()
        .update({ title, metadata })
        .eq("id", id)
        .eq("user_id", userId);
      if (error) throw error;
      return id;
    }
    const { data, error } = await fromUserSessions()
      .insert({ user_id: userId, section, title, metadata })
      .select("id")
      .single();
    if (error) throw error;
    return (data as { id: string } | null)?.id ?? null;
  } catch (err) {
    log.debug("upsert failed", { err });
    return null;
  }
}

export interface LoadedUserSession {
  id: string;
  section: SessionSection;
  title: string;
  metadata: Record<string, unknown>;
}

export async function loadUserSession(id: string, userId: string): Promise<LoadedUserSession | null> {
  try {
    const { data, error } = await fromUserSessions()
      .select("id, section, title, metadata")
      .eq("id", id)
      .eq("user_id", userId)
      .single();
    if (error || !data) return null;
    const row = data as LoadedUserSession;
    return { ...row, metadata: row.metadata ?? {} };
  } catch (err) {
    log.debug("load failed", { err });
    return null;
  }
}

export async function deleteUserSession(id: string, userId: string): Promise<boolean> {
  try {
    const { error } = await fromUserSessions()
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    return !error;
  } catch {
    return false;
  }
}
