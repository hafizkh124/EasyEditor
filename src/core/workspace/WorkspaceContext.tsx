import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { type WorkbenchTab, usePanelState } from "./usePanelState";

interface WorkspaceContextType {
  activeDocumentId: string | null;
  setActiveDocumentId: (id: string | null) => void;
  
  // Panel states & controls
  libraryCollapsed: boolean;
  toggleLibrary: () => void;
  workbenchCollapsed: boolean;
  toggleWorkbench: () => void;
  setWorkbenchOpen: (open: boolean) => void;
  workbenchTab: WorkbenchTab;
  setWorkbenchTab: (tab: WorkbenchTab) => void;
  /**
   * Mobile only. The Library is a drawer there, so it must start closed even
   * though the desktop column is expanded by default — hence its own flag,
   * deliberately not persisted alongside the panel widths.
   */
  mobileLibraryOpen: boolean;
  setMobileLibraryOpen: (open: boolean) => void;

  // Inter-panel communication signals (Canvas <-> Workbench bridge)
  pendingWorkbenchQuery: string | null;
  sendSelectionToWorkbench: (text: string) => void;
  clearPendingWorkbenchQuery: () => void;

  pendingCanvasInsertion: string | null;
  insertIntoCanvas: (html: string) => void;
  clearPendingCanvasInsertion: () => void;

  // Spotlight command palette state
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export const WorkspaceProvider: React.FC<{
  children: React.ReactNode;
  /** The document in the URL. Not just an initial value — see the effect below. */
  documentId?: string;
  initialWorkbenchOpenFromUrl?: boolean;
}> = ({ children, documentId, initialWorkbenchOpenFromUrl = false }) => {
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(documentId ?? null);
  const panelState = usePanelState(initialWorkbenchOpenFromUrl);

  // `/workspace` resolves a blank document and redirects to `/workspace/:id`,
  // but React keeps this provider mounted across that redirect — both routes
  // render the same page at the same position. Reading the param only at mount
  // would leave the workspace on no document at all, so follow the route.
  useEffect(() => {
    if (documentId) setActiveDocumentId(documentId);
  }, [documentId]);

  const [pendingWorkbenchQuery, setPendingWorkbenchQuery] = useState<string | null>(null);
  const [pendingCanvasInsertion, setPendingCanvasInsertion] = useState<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [mobileLibraryOpen, setMobileLibraryOpen] = useState(false);

  const sendSelectionToWorkbench = useCallback(
    (text: string) => {
      setPendingWorkbenchQuery(text);
      panelState.setWorkbenchTab("research");
    },
    [panelState],
  );

  const clearPendingWorkbenchQuery = useCallback(() => {
    setPendingWorkbenchQuery(null);
  }, []);

  const insertIntoCanvas = useCallback((html: string) => {
    setPendingCanvasInsertion(html);
  }, []);

  const clearPendingCanvasInsertion = useCallback(() => {
    setPendingCanvasInsertion(null);
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        activeDocumentId,
        setActiveDocumentId,
        libraryCollapsed: panelState.libraryCollapsed,
        toggleLibrary: panelState.toggleLibrary,
        workbenchCollapsed: panelState.workbenchCollapsed,
        toggleWorkbench: panelState.toggleWorkbench,
        setWorkbenchOpen: panelState.setWorkbenchOpen,
        workbenchTab: panelState.workbenchTab,
        setWorkbenchTab: panelState.setWorkbenchTab,
        mobileLibraryOpen,
        setMobileLibraryOpen,
        pendingWorkbenchQuery,
        sendSelectionToWorkbench,
        clearPendingWorkbenchQuery,
        pendingCanvasInsertion,
        insertIntoCanvas,
        clearPendingCanvasInsertion,
        commandPaletteOpen,
        setCommandPaletteOpen,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
};

export function useWorkspace(): WorkspaceContextType {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return ctx;
}

export function useOptionalWorkspace(): WorkspaceContextType | null {
  return useContext(WorkspaceContext);
}
