import { useState, useEffect, useCallback, useRef } from "react";
import { documentService } from "./documentService";
import type { Document, DocumentVersion } from "./types";
import { useDebounce } from "@/hooks/useDebounce";
import { logger } from "@/lib/logger";

const log = logger.child("useDocument");

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export function useDocument(documentId?: string) {
  const [doc, setDoc] = useState<Document | null>(null);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(documentId));
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  const [pendingTitle, setPendingTitle] = useState<string>("");
  const [pendingContent, setPendingContent] = useState<Record<string, unknown> | null>(null);

  const debouncedContent = useDebounce(pendingContent, 1500);
  const debouncedTitle = useDebounce(pendingTitle, 1000);

  const isInitialMount = useRef(true);
  const docRef = useRef<Document | null>(null);
  const pendingTitleRef = useRef<string>("");
  const pendingContentRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  useEffect(() => {
    pendingTitleRef.current = pendingTitle;
  }, [pendingTitle]);

  useEffect(() => {
    pendingContentRef.current = pendingContent;
  }, [pendingContent]);

  // Load document and versions
  const loadDocument = useCallback(async (id: string) => {
    try {
      setLoading(true);
      setError(null);
      const data = await documentService.getDocument(id);
      if (data) {
        setDoc(data);
        docRef.current = data;
        setPendingTitle(data.title);
        pendingTitleRef.current = data.title;
        setPendingContent(data.content_json);
        pendingContentRef.current = data.content_json;
      } else {
        setError("Document not found");
      }
      const vList = await documentService.listDocumentVersions(id);
      setVersions(vList);
    } catch (err: any) {
      setError(err.message || "Failed to load document");
    } finally {
      setLoading(false);
      isInitialMount.current = false;
    }
  }, []);

  useEffect(() => {
    if (documentId) {
      loadDocument(documentId);
    }
  }, [documentId, loadDocument]);

  /** Pending edits that the 1.5s debounce hasn't written yet, if any. */
  const collectPendingUpdates = useCallback((): Record<string, any> => {
    if (!documentId || !docRef.current) return {};
    const currentTitle = pendingTitleRef.current;
    const currentContent = pendingContentRef.current;
    const updates: Record<string, any> = {};

    if (currentTitle && currentTitle !== docRef.current.title) {
      updates.title = currentTitle;
    }

    if (currentContent && JSON.stringify(currentContent) !== JSON.stringify(docRef.current.content_json)) {
      updates.content_json = currentContent;
    }

    return updates;
  }, [documentId]);

  const hasUnsavedChanges = useCallback(
    () => Object.keys(collectPendingUpdates()).length > 0,
    [collectPendingUpdates],
  );

  const flushSave = useCallback(async () => {
    if (!documentId || !docRef.current) return;
    const updates = collectPendingUpdates();

    if (Object.keys(updates).length > 0) {
      try {
        setSaveStatus("saving");
        const updated = await documentService.updateDocument(documentId, updates);
        setDoc(updated);
        docRef.current = updated;
        setSaveStatus("saved");
      } catch (err) {
        log.error("Flush save error", { err });
        setSaveStatus("error");
      }
    }
  }, [documentId, collectPendingUpdates]);

  // Debounced Autosave Trigger
  useEffect(() => {
    if (isInitialMount.current || !doc || !documentId) return;

    const performSave = async () => {
      try {
        setSaveStatus("saving");
        const updates: Record<string, any> = {};

        if (debouncedTitle && debouncedTitle !== doc.title) {
          updates.title = debouncedTitle;
        }

        if (debouncedContent && JSON.stringify(debouncedContent) !== JSON.stringify(doc.content_json)) {
          updates.content_json = debouncedContent;
        }

        if (Object.keys(updates).length > 0) {
          const updated = await documentService.updateDocument(documentId, updates);
          setDoc(updated);
          docRef.current = updated;
        }
        setSaveStatus("saved");
      } catch (err) {
        log.error("Autosave error", { err });
        setSaveStatus("error");
      }
    };

    performSave();
  }, [debouncedContent, debouncedTitle, documentId, doc]);

  // Flush pending changes on unmount, tab-hide, and page close.
  //
  // `beforeunload` cannot await an async save — the browser tears the page down
  // without waiting, so the request may never land. Two things compensate:
  //   • `visibilitychange → hidden` fires *before* unload (and is the only
  //     reliable signal on mobile, where tabs are discarded without unloading),
  //     giving the save a real chance to complete;
  //   • if edits are still pending at `beforeunload`, we ask the browser to
  //     confirm, which is the only actual guarantee against losing them.
  // In-app navigation is covered by the unmount flush, which does complete.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") flushSave();
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      flushSave();
      e.preventDefault();
      e.returnValue = "";
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      flushSave();
    };
  }, [flushSave, hasUnsavedChanges]);

  const updateTitle = (newTitle: string) => {
    setPendingTitle(newTitle);
    pendingTitleRef.current = newTitle;
    setSaveStatus("saving");
  };

  const updateContent = (json: Record<string, unknown>) => {
    setPendingContent(json);
    pendingContentRef.current = json;
    setSaveStatus("saving");
  };

  const createSnapshot = async (label?: string) => {
    if (!documentId || !doc) return null;
    try {
      const snapshot = await documentService.snapshotVersion(
        documentId,
        pendingContent || doc.content_json,
        label
      );
      setVersions((prev) => [snapshot, ...prev]);
      return snapshot;
    } catch (err: any) {
      log.error("Snapshot creation failed", { err });
      return null;
    }
  };

  return {
    doc,
    loading,
    error,
    saveStatus,
    versions,
    updateTitle,
    updateContent,
    createSnapshot,
    flushSave,
    reload: () => documentId && loadDocument(documentId),
  };
}
