import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { isDesktop } from "@/utils/environment";
import type { ChapterFile, ProjectFolder } from "../../../shared/fs/projectTypes";

const log = logger.child("useProjectFolder");
const LAST_FOLDER_KEY = "easyeditor-project-folder";

interface UseProjectFolder {
  supported: boolean;
  folder: ProjectFolder | null;
  chapters: ChapterFile[];
  busy: boolean;
  /** A chapter changed on disk outside the app (Word, or a sync conflict). */
  externalChange: string | null;
  dismissExternalChange: () => void;
  openFolder: () => Promise<void>;
  closeFolder: () => void;
  refresh: () => Promise<void>;
  /** Pull a chapter into the editor as HTML. */
  importChapter: (name: string) => Promise<string | null>;
  /** Write the given HTML back into `<name>` (backed up first). */
  saveChapter: (name: string, html: string) => Promise<boolean>;
}

export function useProjectFolder(): UseProjectFolder {
  const bridge = typeof window !== "undefined" ? window.electronAPI?.projectFolder : undefined;
  const supported = isDesktop() && Boolean(bridge);

  const [folder, setFolder] = useState<ProjectFolder | null>(null);
  const [chapters, setChapters] = useState<ChapterFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [externalChange, setExternalChange] = useState<string | null>(null);
  const rootRef = useRef<string | null>(null);

  const attach = useCallback((pf: ProjectFolder) => {
    setFolder(pf);
    setChapters(pf.chapters);
    rootRef.current = pf.path;
    try { localStorage.setItem(LAST_FOLDER_KEY, pf.path); } catch { /* ignore */ }
    void bridge?.watch(pf.path);
  }, [bridge]);

  // Reopen the last folder on mount.
  useEffect(() => {
    if (!supported || folder) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem(LAST_FOLDER_KEY); } catch { /* ignore */ }
    if (!saved) return;
    bridge!.open(saved).then(attach).catch(() => {
      try { localStorage.removeItem(LAST_FOLDER_KEY); } catch { /* ignore */ }
    });
  }, [supported, folder, bridge, attach]);

  // External-change notifications.
  useEffect(() => {
    if (!supported || !bridge?.onChanged) return;
    return bridge.onChanged((p) => {
      if (p.kind === "external") {
        setExternalChange(p.name);
        void refresh();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, bridge]);

  const refresh = useCallback(async () => {
    if (!bridge || !rootRef.current) return;
    try {
      setChapters(await bridge.listChapters(rootRef.current));
    } catch (err) {
      log.warn("refresh chapters failed", { err });
    }
  }, [bridge]);

  const openFolder = useCallback(async () => {
    if (!bridge) return;
    setBusy(true);
    try {
      const picked = await bridge.pickFolder();
      if (picked.cancelled) return;
      attach(await bridge.open(picked.path));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [bridge, attach]);

  const closeFolder = useCallback(() => {
    void bridge?.unwatch();
    setFolder(null);
    setChapters([]);
    rootRef.current = null;
    setExternalChange(null);
    try { localStorage.removeItem(LAST_FOLDER_KEY); } catch { /* ignore */ }
  }, [bridge]);

  const importChapter = useCallback(async (name: string): Promise<string | null> => {
    if (!bridge || !rootRef.current) return null;
    setBusy(true);
    try {
      const res = await bridge.readChapterHtml(rootRef.current, name);
      return res.html;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }, [bridge]);

  const saveChapter = useCallback(async (name: string, html: string): Promise<boolean> => {
    if (!bridge || !rootRef.current) return false;
    setBusy(true);
    try {
      const res = await bridge.saveChapter(rootRef.current, name, html);
      await refresh();
      toast.success(
        res.backupPath
          ? `“${name}” saved — previous version backed up`
          : `“${name}” created in the project folder`,
      );
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, [bridge, refresh]);

  return {
    supported,
    folder,
    chapters,
    busy,
    externalChange,
    dismissExternalChange: () => setExternalChange(null),
    openFolder,
    closeFolder,
    refresh,
    importChapter,
    saveChapter,
  };
}
