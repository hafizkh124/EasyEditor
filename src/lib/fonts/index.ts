import "./eager.css";

import { logger } from "@/lib/logger";

export type LazyEditorFontId = "nastaliq" | "amiri" | "quran" | "vazir";

const log = logger.child("Fonts");
const loaders: Record<LazyEditorFontId, () => Promise<unknown>> = {
  nastaliq: () => import("./nastaliq.css"),
  amiri: () => import("./amiri.css"),
  quran: () => import("./quran.css"),
  vazir: () => import("./vazir.css"),
};
const requests = new Map<LazyEditorFontId, Promise<void>>();

export function isLazyEditorFontId(value: unknown): value is LazyEditorFontId {
  return value === "nastaliq" || value === "amiri" || value === "quran" || value === "vazir";
}

export function loadEditorFont(id: LazyEditorFontId): Promise<void> {
  const existing = requests.get(id);
  if (existing) return existing;

  const request = loaders[id]().then(() => undefined).catch((error: unknown) => {
    requests.delete(id);
    throw error;
  });
  requests.set(id, request);
  return request;
}

export function prefetchStoredReaderFont(): void {
  if (typeof window === "undefined") return;

  const prefetch = () => {
    try {
      const raw = window.localStorage.getItem("reader.settings.v1");
      const fontId = raw ? (JSON.parse(raw) as { fontId?: unknown }).fontId : undefined;
      if (!isLazyEditorFontId(fontId)) return;
      void loadEditorFont(fontId).catch((error: unknown) => {
        log.warn("stored reader font could not be prefetched", { fontId, error });
      });
    } catch (error) {
      log.warn("stored reader settings could not be read", { error });
    }
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(prefetch);
  } else {
    globalThis.setTimeout(prefetch, 0);
  }
}
