import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useWorkspace } from "@/core/workspace/WorkspaceContext";
import { WorkspaceTopBar } from "./WorkspaceTopBar";
import { CanvasPanel } from "./CanvasPanel";
import { WorkbenchPanel } from "./WorkbenchPanel";
import { CommandPalette } from "./CommandPalette";
import { WorkspaceStatusBar } from "./WorkspaceStatusBar";
import { ActivityRail } from "./rail/ActivityRail";
import { SidePanelHost } from "./rail/SidePanelHost";
import { ArtifactStage } from "./artifacts/ArtifactStage";
import { useOptionalSharedAgentRun } from "@/core/workspace/useSharedAgentRun";
import { useWorkspaceShortcuts } from "@/core/workspace/useWorkspaceShortcuts";
import { useDocument } from "@/core/workspace/useDocument";
import { countWords } from "@/core/workspace/documentService";
import type { DocChangePayload } from "@/components/editor/RichEditor";

import { useAllDocuments } from "@/core/workspace/useAllDocuments";
import { useShamelaBook } from "@/hooks/useShamelaBook";
import { ShamelaReader } from "@/components/shamela/ShamelaReader";
import { SplitReader, type SplitBook } from "@/components/shamela/SplitReader";
import { SplitBookPickerDialog } from "@/components/shamela/SplitBookPickerDialog";

export const WorkspaceLayout: React.FC = () => {
  const { direction } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pageParam = Number(searchParams.get("page"));
  const initialReaderPage = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : null;
  const {
    activeDocumentId,
    setActiveDocumentId,
    libraryCollapsed,
    workbenchCollapsed,
    setWorkbenchOpen,
    mobileLibraryOpen,
    setMobileLibraryOpen,
    setDocumentOutline,
    stageCollapsed,
    stageMaximized,
  } = useWorkspace();

  useWorkspaceShortcuts();

  const { allDocs } = useAllDocuments();
  // SPEC M10 Phase 3 — this used to be its own innerWidth<768 state+resize
  // listener, a third copy of the same breakpoint (OcrReview.tsx had the
  // second). use-mobile.tsx's matchMedia-based hook is the one already
  // shared elsewhere in the app.
  const isMobile = useIsMobile();

  // Plan §5.2 — the artifact stage shares the Canvas zone as a vertical split.
  const sharedAgent = useOptionalSharedAgentRun();
  const showStage = !isMobile && (sharedAgent?.artifacts.length ?? 0) > 0 && !stageCollapsed;

  const shamelaBook = useShamelaBook(activeDocumentId);

  // SPEC-M6 Phase 9 — Split View. When a second book is picked, the Canvas
  // pillar renders SplitReader instead of the single-book ShamelaReader.
  const [splitSecondary, setSplitSecondary] = useState<SplitBook | null>(null);
  const [splitPickerOpen, setSplitPickerOpen] = useState(false);

  // A split pairs two specific books; switching the active document invalidates it.
  useEffect(() => {
    setSplitSecondary(null);
    setSplitPickerOpen(false);
  }, [shamelaBook.bookId]);

  const handleCloseSplit = () => {
    setSplitSecondary(null);
    setSplitPickerOpen(false);
  };

  const handleSelectSecondary = (book: SplitBook) => {
    setSplitSecondary(book);
    setSplitPickerOpen(false);
  };

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
    updateDirection: syncDocDirection,
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

  // Counted from what the editor holds right now rather than the row's saved
  // `word_count`, which only advances when a save lands. Null while no document
  // is open so the tree falls back to each row's stored value.
  const liveWordCount = useMemo(
    () => (activeDocumentId && currentText ? countWords(currentText) : null),
    [activeDocumentId, currentText],
  );

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

  // Publish the open document's headings so the Agent tab's `@` picker can
  // offer them (SPEC-M8 Layer 7). Cheap regex over the editor HTML; the context
  // setter de-dupes so this is safe to run on every content change.
  useEffect(() => {
    if (!currentHtml) { setDocumentOutline([]); return; }
    const headings = [...currentHtml.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim())
      .filter(Boolean);
    setDocumentOutline(headings);
  }, [currentHtml, setDocumentOutline]);

  const handleRestoreVersion = (contentJson: Record<string, unknown>) => {
    setRestoredContent(contentJson);
    setContentRevision((n) => n + 1);
    syncDocContent(contentJson);
  };

  return (
    <div className="flex flex-col h-[100dvh] w-full overflow-hidden bg-background" dir={direction}>
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

      {/* Main 3-Pillar Workspace Area — one tree at every viewport size.
          `flex` so the activity rail (a 48px shrink-0 child) and the resizable
          group sit in a row; under dir="rtl" the row reverses, putting the rail
          on the right (react-resizable-panels v2 negates its own drag delta for
          rtl, so the panels mirror correctly with no [...panels].reverse()). */}
      <div className="flex flex-1 min-h-0 relative overflow-hidden">
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

        {/* Plan §3.1 — the activity rail is a fixed flex child OUTSIDE the
            resizable group (always visible; the side panel collapses, the rail
            does not). Hidden on mobile — the Library drawer keeps its own
            header controls there. */}
        {!isMobile && <ActivityRail />}

        <ResizablePanelGroup
          direction="horizontal"
          autoSaveId="workspace.layout.v2"
          className="h-full min-w-0 flex-1 relative"
        >
          {/* Pillar 1: the active rail panel — a column on desktop, a start-edge
              drawer on mobile. Collapsed to 0 when no rail panel is active. */}
          <ResizablePanel
            id="side"
            defaultSize={20}
            minSize={15}
            maxSize={32}
            collapsible={true}
            className={cn(
              "min-w-0 bg-sidebar",
              !isMobile && libraryCollapsed && "hidden",
              isMobile && "w-[min(20rem,85vw)] border-e border-border shadow-xl transition-transform duration-300",
            )}
            style={isMobile ? drawerStyle(mobileLibraryOpen, "start") : undefined}
            aria-hidden={isMobile && !mobileLibraryOpen}
          >
            <SidePanelHost
              forceExpanded={isMobile}
              forcePanel={isMobile ? "library" : undefined}
              onNavigate={isMobile ? () => setMobileLibraryOpen(false) : undefined}
              activeDocumentWordCount={liveWordCount}
            />
          </ResizablePanel>

          <ResizableHandle withHandle className={cn((isMobile || libraryCollapsed) && "hidden")} />

          {/* Pillar 2: Canvas — the only pillar left in the flex flow on mobile,
              so it fills the viewport there (FR-8.1). Plan §5.2 — a nested
              VERTICAL split: editor on top, artifact stage below (only rendered
              once the agent has produced an artifact, so the column count never
              changes). */}
          <ResizablePanel defaultSize={55} minSize={35} className="min-w-0">
            <ResizablePanelGroup direction="vertical" autoSaveId="workspace.canvas.v1" className="h-full">
              {!(showStage && stageMaximized) && (
              <ResizablePanel
                id="canvas-editor"
                order={1}
                defaultSize={showStage ? 55 : 100}
                minSize={20}
                className="min-h-0"
              >
                {shamelaBook.bookId ? (
                  splitSecondary ? (
                    <SplitReader
                      primary={{
                        bookId: shamelaBook.bookId,
                        title: shamelaBook.title || shamelaBook.bookId,
                        author: shamelaBook.author,
                      }}
                      secondary={splitSecondary}
                      onClose={handleCloseReader}
                      onCloseSecondary={handleCloseSplit}
                    />
                  ) : (
                    <ShamelaReader
                      bookId={shamelaBook.bookId}
                      title={shamelaBook.title || shamelaBook.bookId}
                      subtitle={shamelaBook.author}
                      onClose={handleCloseReader}
                      initialPage={initialReaderPage}
                      onRequestSplit={() => setSplitPickerOpen(true)}
                    />
                  )
                ) : (
                  <CanvasPanel
                    doc={doc}
                    docLoading={docLoading}
                    contentRevision={contentRevision}
                    restoredContent={restoredContent}
                    onDirectionChange={syncDocDirection}
                    onEditorChange={handleEditorChange}
                    onDocChange={handleDocChange}
                  />
                )}
              </ResizablePanel>
              )}
              {showStage && (
                <>
                  {!stageMaximized && <ResizableHandle withHandle />}
                  <ResizablePanel id="canvas-stage" order={2} defaultSize={stageMaximized ? 100 : 45} minSize={20} className="min-h-0">
                    <ArtifactStage />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>

          {/* Pillar 3: Workbench — hidden by CSS, never unmounted, so a running
              SSE answer survives closing it (FR-4.3, FR-8.3) */}
          <ResizableHandle withHandle className={isMobile || workbenchCollapsed ? "hidden" : ""} />

          <ResizablePanel
            defaultSize={25}
            minSize={20}
            maxSize={40}
            className={cn(
              // A flex item's automatic min-width is its content's min-content
              // size, not 0 — so a `max-w-3xl` chat input inside (768px) could
              // hold this panel wider than its 20-40% share and past the
              // window edge, worse in RTL (SPEC-M9 QA finding). min-w-0 is the
              // standard antidote; the panel's own overflow-hidden still clips
              // anything that doesn't fit once it's held to its real size.
              "min-w-0",
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

      {/* Plan §3.2 — bottom status bar: local corpora + open-document state */}
      <WorkspaceStatusBar
        wordCount={liveWordCount}
        direction={doc?.text_direction === "rtl" || doc?.text_direction === "ltr" ? doc.text_direction : null}
        saveStatus={saveStatus}
      />

      {/* Spotlight Command Palette */}
      <CommandPalette />

      {/* SPEC-M6 Phase 9 — Split View book picker (search the Shamela catalogue
          for a second book to compare against the one already open). */}
      <SplitBookPickerDialog
        open={splitPickerOpen}
        onOpenChange={setSplitPickerOpen}
        onSelect={handleSelectSecondary}
        excludeBookId={shamelaBook.bookId}
      />
    </div>
  );
};
