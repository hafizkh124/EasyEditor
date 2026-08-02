import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { useWorkspace } from "@/core/workspace/WorkspaceContext";
import { WorkspaceTopBar } from "./WorkspaceTopBar";
import { LibraryPanel } from "./LibraryPanel";
import { CanvasPanel } from "./CanvasPanel";
import { WorkbenchPanel } from "./WorkbenchPanel";
import { CommandPalette } from "./CommandPalette";
import { useDocument } from "@/core/workspace/useDocument";
import type { DocChangePayload } from "@/components/editor/RichEditor";

import { useAllDocuments } from "@/core/workspace/useAllDocuments";
import { useShamelaBook } from "@/hooks/useShamelaBook";
import { ShamelaReader } from "@/components/shamela/ShamelaReader";

export const WorkspaceLayout: React.FC = () => {
  const { direction } = useLanguage();
  const navigate = useNavigate();
  const {
    activeDocumentId,
    setActiveDocumentId,
    libraryCollapsed,
    workbenchCollapsed,
    setWorkbenchOpen,
    mobileLibraryOpen,
    setMobileLibraryOpen,
  } = useWorkspace();

  const { allDocs } = useAllDocuments();
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  const shamelaBook = useShamelaBook(activeDocumentId);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const drawerStyle = (open: boolean, edge: "start" | "end"): React.CSSProperties => {
    const base: React.CSSProperties = { position: "absolute", top: 0, bottom: 0, zIndex: 40 };
    const startIsLeft = direction !== "rtl";
    const onTheLeft = edge === "start" ? startIsLeft : !startIsLeft;
    const side: React.CSSProperties = onTheLeft ? { left: 0, right: "auto" } : { right: 0, left: "auto" };
    return {
      ...base,
      ...side,
      transform: open ? "translateX(0)" : `translateX(${onTheLeft ? "-100%" : "100%"})`,
      visibility: open ? "visible" : "hidden",
    };
  };

  const {
    doc,
    loading: docLoading,
    saveStatus,
    versions,
    updateTitle: syncDocTitle,
    updateContent: syncDocContent,
    createSnapshot,
  } = useDocument(activeDocumentId ?? undefined);

  const activeDocWithProject = allDocs.find((d) => d.id === doc?.id);
  const projectName = activeDocWithProject?.projectName;

  const [currentText, setCurrentText] = useState("");
  const [currentHtml, setCurrentHtml] = useState("");
  const [restoredContent, setRestoredContent] = useState<Record<string, unknown> | null>(null);
  const [contentRevision, setContentRevision] = useState(0);

  const handleTitleChange = (newTitle: string) => {
    if (activeDocumentId) {
      syncDocTitle(newTitle);
    }
  };

  const handleEditorChange = (html: string, text: string) => {
    setCurrentHtml(html);
    setCurrentText(text);
  };

  const handleCloseReader = () => {
    setActiveDocumentId(null);
    navigate("/workspace", { replace: true });
  };

  const handleDocChange = ({ json, text, html }: DocChangePayload) => {
    setCurrentHtml(html);
    setCurrentText(text);
    if (activeDocumentId) {
      syncDocContent(json);
    }
  };

  const handleRestoreVersion = (contentJson: Record<string, unknown>) => {
    setRestoredContent(contentJson);
    setContentRevision((n) => n + 1);
    syncDocContent(contentJson);
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background" dir={direction}>
      {/* TopBar */}
      <WorkspaceTopBar
        doc={doc}
        projectName={projectName}
        saveStatus={saveStatus}
        versions={versions}
        currentText={currentText}
        currentHtml={currentHtml}
        onTitleChange={handleTitleChange}
        onRestoreVersion={handleRestoreVersion}
        onCreateSnapshot={createSnapshot}
      />

      {/* Main 3-Pillar Workspace Area — one tree at every viewport size */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {/* Mobile scrim behind an open drawer */}
        {isMobile && (mobileLibraryOpen || !workbenchCollapsed) && (
          <div
            className="absolute inset-0 z-30 bg-black/50"
            onClick={() => {
              setMobileLibraryOpen(false);
              setWorkbenchOpen(false);
            }}
          />
        )}

        <ResizablePanelGroup
          direction="horizontal"
          autoSaveId="workspace.layout"
          className="h-full relative"
        >
          {/* Pillar 1: Library — a column on desktop, a start-edge drawer on mobile */}
          <ResizablePanel
            defaultSize={20}
            minSize={15}
            maxSize={30}
            collapsible={true}
            className={cn(
              "bg-sidebar",
              !isMobile && libraryCollapsed && "max-w-[48px]",
              isMobile && "w-[min(20rem,85vw)] border-e border-border shadow-xl transition-transform duration-300",
            )}
            style={isMobile ? drawerStyle(mobileLibraryOpen, "start") : undefined}
            aria-hidden={isMobile && !mobileLibraryOpen}
          >
            <LibraryPanel
              forceExpanded={isMobile}
              onNavigate={isMobile ? () => setMobileLibraryOpen(false) : undefined}
            />
          </ResizablePanel>

          <ResizableHandle withHandle className={isMobile ? "hidden" : ""} />

          {/* Pillar 2: Canvas — the only pillar left in the flex flow on mobile,
              so it fills the viewport there (FR-8.1) */}
          <ResizablePanel defaultSize={55} minSize={35}>
            {shamelaBook.bookId ? (
              <ShamelaReader
                bookId={shamelaBook.bookId}
                title={shamelaBook.title || shamelaBook.bookId}
                subtitle={shamelaBook.author}
                onClose={handleCloseReader}
              />
            ) : (
              <CanvasPanel
                doc={doc}
                docLoading={docLoading}
                contentRevision={contentRevision}
                restoredContent={restoredContent}
                onEditorChange={handleEditorChange}
                onDocChange={handleDocChange}
              />
            )}
          </ResizablePanel>

          {/* Pillar 3: Workbench — hidden by CSS, never unmounted, so a running
              SSE answer survives closing it (FR-4.3, FR-8.3) */}
          <ResizableHandle withHandle className={isMobile || workbenchCollapsed ? "hidden" : ""} />

          <ResizablePanel
            defaultSize={25}
            minSize={20}
            maxSize={40}
            className={cn(
              !isMobile && workbenchCollapsed && "hidden",
              isMobile && "w-[min(26rem,90vw)] bg-background shadow-xl transition-transform duration-300",
            )}
            style={isMobile ? drawerStyle(!workbenchCollapsed, "end") : undefined}
            aria-hidden={isMobile && workbenchCollapsed}
          >
            <WorkbenchPanel alwaysVisible={isMobile} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Spotlight Command Palette */}
      <CommandPalette />
    </div>
  );
};
