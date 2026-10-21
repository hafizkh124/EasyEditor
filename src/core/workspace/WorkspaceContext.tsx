import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { type WorkbenchTab, type RailPanel, usePanelState } from "./usePanelState";

/** The page the Shamela reader is currently showing (plain text, for AI). */
export interface ReaderPageSignal {
  bookId: string;
  title: string;
  pageNumber: number;
  text: string;
}

/** Ask the Shamela reader to open a specific page (Workbench → Reader). */
export interface ReaderJumpSignal {
  bookId: string;
  pageNumber: number;
}

/** What one whole-document task run reports back to whoever asked for it. */
export interface DocumentTaskOutcome {
  ok: boolean;
  applied: number;
  total: number;
  tokensSpent: number;
  /** Why it did not run (or did not finish) — shown to the user verbatim. */
  reason?: string;
}

/**
 * Run a registered task over the whole active document.
 *
 * The editor lives in the Canvas, but Recipes are driven from the Library
 * panel, so the runner is published here the same way the Canvas↔Workbench
 * signals are. `null` means no editor is mounted and nothing can be run.
 */
export type DocumentTaskRunner = (taskSlug: string) => Promise<DocumentTaskOutcome>;

interface WorkspaceContextType {
  activeDocumentId: string | null;
  setActiveDocumentId: (id: string | null) => void;
  
  // Panel states & controls
  /** Plan §3.1 — the active start-edge rail panel, or null (collapsed to rail). */
  activeRailPanel: RailPanel | null;
  setActiveRailPanel: (panel: RailPanel | null) => void;
  toggleRailPanel: (panel: RailPanel) => void;
  /** `openRailPanel(id)` — open a panel (never toggles it shut). */
  openRailPanel: (panel: RailPanel) => void;
  libraryCollapsed: boolean;
  toggleLibrary: () => void;
  workbenchCollapsed: boolean;
  toggleWorkbench: () => void;
  setWorkbenchOpen: (open: boolean) => void;
  workbenchTab: WorkbenchTab;
  setWorkbenchTab: (tab: WorkbenchTab) => void;
  /** Plan §5.2 — artifact stage (vertical split of the Canvas zone). */
  stageCollapsed: boolean;
  setStageCollapsed: (collapsed: boolean) => void;
  stageMaximized: boolean;
  setStageMaximized: (maximized: boolean) => void;
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

  // Reader <-> AI panel bridge (SPEC-M6 Phase 7). The reader pushes the page
  // it is showing (plain text); the AI Reader panel consumes it as context.
  readerPage: ReaderPageSignal | null;
  setReaderPage: (page: ReaderPageSignal | null) => void;

  // Reader <-> Workbench bridge (SPEC-M6 Phase 8). The Notes panel asks the
  // reader to jump to a bookmarked page by publishing a jump request; the
  // reader consumes it and clears it.
  readerJump: ReaderJumpSignal | null;
  setReaderJump: (jump: ReaderJumpSignal | null) => void;

  // Spotlight command palette state
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  /** The mounted editor's whole-document task runner, or null (see above). */
  runDocumentTask: DocumentTaskRunner | null;
  registerDocumentTaskRunner: (runner: DocumentTaskRunner | null) => void;

  /**
   * Headings of the document currently open in the Canvas, in order. Published
   * here so the Agent tab's `@` picker (SPEC-M8 Layer 7) can offer the outline
   * as explicit references without reaching into the editor instance.
   */
  documentOutline: string[];
  setDocumentOutline: (headings: string[]) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export const WorkspaceProvider: React.FC<{
  children: React.ReactNode;
  /** The document in the URL. Not just an initial value — see the effect below. */
  documentId?: string;
  initialWorkbenchOpenFromUrl?: boolean;
  /** e.g. `?panel=research` — opens the workbench on that specific tab. */
  initialWorkbenchTab?: WorkbenchTab;
  /** A question typed on Home: pre-fills the research composer once. */
  initialWorkbenchQuery?: string;
}> = ({ children, documentId, initialWorkbenchOpenFromUrl = false, initialWorkbenchTab, initialWorkbenchQuery }) => {
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(documentId ?? null);
  const panelState = usePanelState(initialWorkbenchOpenFromUrl, initialWorkbenchTab);

  // `/workspace` resolves a blank document and redirects to `/workspace/:id`,
  // but React keeps this provider mounted across that redirect — both routes
  // render the same page at the same position. Reading the param only at mount
  // would leave the workspace on no document at all, so follow the route.
  useEffect(() => {
    if (documentId) setActiveDocumentId(documentId);
  }, [documentId]);

  const [pendingWorkbenchQuery, setPendingWorkbenchQuery] = useState<string | null>(initialWorkbenchQuery ?? null);
  const [pendingCanvasInsertion, setPendingCanvasInsertion] = useState<string | null>(null);
  const [readerPage, setReaderPage] = useState<ReaderPageSignal | null>(null);
  const [readerJump, setReaderJump] = useState<ReaderJumpSignal | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [mobileLibraryOpen, setMobileLibraryOpen] = useState(false);
  const [documentOutline, setDocumentOutlineState] = useState<string[]>([]);

  const setDocumentOutline = useCallback((headings: string[]) => {
    setDocumentOutlineState((prev) =>
      prev.length === headings.length && prev.every((h, i) => h === headings[i]) ? prev : headings,
    );
  }, []);

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

  // Held in state, not a ref: the Recipes tab has to re-render when the editor
  // mounts or unmounts, or its Run button would stay disabled forever.
  const [runDocumentTask, setRunDocumentTask] = useState<DocumentTaskRunner | null>(null);
  const registerDocumentTaskRunner = useCallback((runner: DocumentTaskRunner | null) => {
    // Wrapped, because a bare function passed to a setter is treated as an
    // updater by React.
    setRunDocumentTask(() => runner);
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        activeDocumentId,
        setActiveDocumentId,
        activeRailPanel: panelState.activeRailPanel,
        setActiveRailPanel: panelState.setActiveRailPanel,
        toggleRailPanel: panelState.toggleRailPanel,
        openRailPanel: panelState.setActiveRailPanel,
        libraryCollapsed: panelState.libraryCollapsed,
        toggleLibrary: panelState.toggleLibrary,
        workbenchCollapsed: panelState.workbenchCollapsed,
        toggleWorkbench: panelState.toggleWorkbench,
        setWorkbenchOpen: panelState.setWorkbenchOpen,
        workbenchTab: panelState.workbenchTab,
        stageCollapsed: panelState.stageCollapsed,
        setStageCollapsed: panelState.setStageCollapsed,
        stageMaximized: panelState.stageMaximized,
        setStageMaximized: panelState.setStageMaximized,
        setWorkbenchTab: panelState.setWorkbenchTab,
        mobileLibraryOpen,
        setMobileLibraryOpen,
        pendingWorkbenchQuery,
        sendSelectionToWorkbench,
        clearPendingWorkbenchQuery,
        pendingCanvasInsertion,
        insertIntoCanvas,
        clearPendingCanvasInsertion,
        readerPage,
        setReaderPage,
        readerJump,
        setReaderJump,
        commandPaletteOpen,
        setCommandPaletteOpen,
        runDocumentTask,
        registerDocumentTaskRunner,
        documentOutline,
        setDocumentOutline,
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
