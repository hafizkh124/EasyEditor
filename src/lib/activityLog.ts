import { supabase } from "@/integrations/supabase/client";

export interface ActivityEntry {
  id: string;
  type: "tts" | "ocr" | "stt";
  label: string;
  timestamp: number;
}

const MAX_ENTRIES = 5;

// localStorage key for offline/unauthenticated fallback
const STORAGE_KEY = "easyeditor-activity";

export async function getRecentActivity(): Promise<ActivityEntry[]> {
  const { data: { session } } = await supabase.auth.getSession();

  if (session?.user) {
    const { data, error } = await supabase
      .from("activity_log")
      .select("id, type, label, created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(MAX_ENTRIES);

    if (!error && data) {
      return data.map((row) => ({
        id: row.id,
        type: row.type as ActivityEntry["type"],
        label: row.label,
        timestamp: new Date(row.created_at).getTime(),
      }));
    }
  }

  // Fallback to localStorage when not authenticated
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function logActivity(type: "tts" | "ocr" | "stt", label: string) {
  const truncatedLabel = label.slice(0, 80);
  const { data: { session } } = await supabase.auth.getSession();

  if (session?.user) {
    await supabase.from("activity_log").insert({
      user_id: session.user.id,
      type,
      label: truncatedLabel,
    });
    return;
  }

  // Fallback to localStorage when not authenticated
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const entries: ActivityEntry[] = raw ? JSON.parse(raw) : [];
    const entry: ActivityEntry = {
      id: crypto.randomUUID(),
      type,
      label: truncatedLabel,
      timestamp: Date.now(),
    };
    const updated = [entry, ...entries].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore storage errors
  }
}
