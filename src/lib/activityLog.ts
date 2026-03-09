export interface ActivityEntry {
  id: string;
  type: "tts" | "ocr";
  label: string;
  timestamp: number;
}

const STORAGE_KEY = "easyeditor-activity";
const MAX_ENTRIES = 5;

export function getRecentActivity(): ActivityEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function logActivity(type: "tts" | "ocr", label: string) {
  const entries = getRecentActivity();
  const entry: ActivityEntry = {
    id: crypto.randomUUID(),
    type,
    label: label.slice(0, 80),
    timestamp: Date.now(),
  };
  const updated = [entry, ...entries].slice(0, MAX_ENTRIES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}
