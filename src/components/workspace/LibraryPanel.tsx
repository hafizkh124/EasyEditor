import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  FolderPlus, BookOpen, Search, Plus, Upload, ChevronLeft, Volume2, Home, Library as LibraryIcon,
} from "lucide-react";import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useLanguage } from "@/contexts/LanguageContext";
import { useWorkspace } from "@/core/workspace/WorkspaceContext";
import { useAllDocuments } from "@/core/workspace/useAllDocuments";
import { documentService } from "@/core/workspace/documentService";
import { stripHarakat } from "@/utils/arabicUtils";
import { useShamelaAvailability } from "@/hooks/useShamelaAvailability";
import { logger } from "@/lib/logger";
import { LibraryDocumentTree } from "./LibraryDocumentTree";
import { LibraryNewProjectDialog } from "./LibraryNewProjectDialog";
import { ProjectFolderSection } from "./ProjectFolderSection";

const log = logger.child("LibraryPanel");
import { LibrarySourcesTab } from "./LibrarySourcesTab";
import { HomeTab } from "./HomeTab";
import { ShamelaTab } from "./ShamelaTab";
import { ShamelaImportDialog } from "@/components/shamela/ShamelaImportDialog";
import type { Document, ProjectKind } from "@/core/workspace/types";
import { availableCapabilities } from "@/core/capabilities/registry";
import { LegacyImportBanner } from "./LegacyImportBanner";

interface LibraryPanelProps {
  /** Inside the mobile drawer the icon-rail state makes no sense — stay open. */
  forceExpanded?: boolean;
  /** Called after the user opens something, so a drawer can close itself. */
  onNavigate?: () => void;
  /** Live word count of the open document — see LibraryDocumentTree. */
  activeDocumentWordCount?: number | null;
}

export const LibraryPanel: React.FC<LibraryPanelProps> = ({ forceExpanded = false, onNavigate, activeDocumentWordCount }) => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  // Only the ingest tools that exist on this runtime (OCR is web-only; the two
  // voice tools ride the offline-engine flag on desktop).
  const ingestRoutes = availableCapabilities("dashboard-grid").filter((c) => c.group === "tool");
  const { activeDocumentId, setActiveDocumentId, libraryCollapsed: storedCollapsed, toggleLibrary } = useWorkspace();
  const libraryCollapsed = forceExpanded ? false : storedCollapsed;

  const { projects, docsMap, allDocs, loading: docsLoading, refresh: refreshAllDocs } = useAllDocuments();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("home");
  const [shamelaInitialSubTab, setShamelaInitialSubTab] = useState<"browse" | "search" | "favorites">("browse");

  // Browse/Search/Favorites are backed entirely by a native Shamela install
  // today (BrowseTab and SearchTab call window.electronAPI.shamela.* directly;
  // FavoritesTab's cloud backend is a stub that returns nothing). Showing them
  // with no library connected is a tab that can only ever be empty — SPEC-M5
  // FR-2.5 says absent, not empty. useShamelaAvailability is the one place
  // that later grows a web-bridge branch (P7) once those surfaces are wired.
  const { available: shamelaAvailable, masterDbPath: shamelaMasterDbPath } = useShamelaAvailability();

  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjTitle, setNewProjTitle] = useState("");
  const [newProjKind, setNewProjKind] = useState<ProjectKind>("general");
  const [creatingProj, setCreatingProj] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  // Global search filtering across plain_text and title (diacritic-insensitive)
  const searchResults = useMemo(() => {
    const q = stripHarakat(searchQuery.trim().toLowerCase());
    if (!q) return [];
    return allDocs.filter((doc) => {
      const matchTitle = stripHarakat(doc.title.toLowerCase()).includes(q);
      const matchText = doc.plain_text ? stripHarakat(doc.plain_text.toLowerCase()).includes(q) : false;
      return matchTitle || matchText;
    });
  }, [searchQuery, allDocs]);

  const handleSelectDocument = (doc: Document, projectKind?: ProjectKind) => {
    onNavigate?.();
    setActiveDocumentId(doc.id);
    if (projectKind === "translation") {
      // Per FR-1.4: translation projects open TranslationWorkspace in Canvas
      navigate(`/workspace/${doc.id}?view=translation`, { replace: true });
      return;
    }
    navigate(`/workspace/${doc.id}`, { replace: true });
  };

  const handleCreateProject = async () => {
    if (!newProjTitle.trim()) return;
    try {
      setCreatingProj(true);
      await documentService.createProject(newProjTitle, newProjKind);
      toast.success(t("library.project_created", "Project created"));
      setNewProjectOpen(false);
      setNewProjTitle("");
      refreshAllDocs();
    } catch (err) {
      log.error("createProject failed", { err });
      toast.error(t("library.create_error", "Failed to create project"));
    } finally {
      setCreatingProj(false);
    }
  };

  const handleCreateDocument = async (projectId: string) => {
    try {
      const d = await documentService.createDocument(projectId, t("editor.untitled", "Untitled Document"));
      refreshAllDocs();
      handleSelectDocument(d);
    } catch (err) {
      log.error("createDocument failed", { err });
      toast.error(t("library.doc_create_error", "Failed to create document"));
    }
  };

  if (libraryCollapsed) {
    return (
      <div className="flex flex-col items-center py-3 gap-3 h-full bg-sidebar border-e border-sidebar-border w-12 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8 min-h-touch min-w-touch md:min-h-0 md:min-w-0 text-sidebar-foreground" onClick={toggleLibrary} aria-label={t("library.expand_library", "Expand Library")}>
          <BookOpen className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-sidebar border-e border-sidebar-border select-none text-sidebar-foreground">
      {/* Panel Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <span className="font-semibold text-xs tracking-wide uppercase">{t("library.title", "Library")}</span>
        </div>
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 min-h-touch min-w-touch md:min-h-0 md:min-w-0 text-sidebar-foreground" aria-label={t("library.add_menu", "Add project or ingest")}>
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuItem onClick={() => setNewProjectOpen(true)} className="gap-2 cursor-pointer">
                <FolderPlus className="h-4 w-4 text-primary" />
                <span>{t("library.new_project", "New Project")}</span>
              </DropdownMenuItem>
              {/* The workspace IS the desktop home, so this menu was the most
                  reachable of the three hardcoded tool lists — it offered
                  "Ingest via OCR" on a build where /ocr redirects straight back. */}
              {ingestRoutes.length > 0 && <DropdownMenuSeparator />}
              {ingestRoutes.map((capability) => (
                <DropdownMenuItem
                  key={capability.id}
                  onClick={() => navigate(capability.route!)}
                  className="gap-2 cursor-pointer text-xs"
                >
                  {capability.id === "speak"
                    ? <Volume2 className="h-3.5 w-3.5" />
                    : <Upload className="h-3.5 w-3.5" />}
                  <span>{t("library.ingest_via", "Ingest via {tool}").replace("{tool}", t(capability.labelKey, capability.fallbackLabel))}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="ghost" size="icon" className="h-7 w-7 min-h-touch min-w-touch md:min-h-0 md:min-w-0 text-sidebar-foreground" onClick={toggleLibrary} aria-label={t("library.collapse_library", "Collapse Library")}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Global Search */}
      <div className="p-2 border-b border-sidebar-border">
        <div className="relative">
          <Search className="absolute start-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={t("library.search_projects", "Search all projects...")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 text-xs ps-8 bg-sidebar-accent/50 border-0 focus-visible:ring-1"
          />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="px-2 pt-2 border-b border-sidebar-border">
          {/* Tab count follows the flags: with both M4 pillars off and no
              Shamela library connected, the Library is back to three tabs,
              not several dead ones (NFR-6, SPEC-M5 FR-2.5). */}
          {/* Container height is the touch target: h-11 (44px, min-h-touch) below
              md, back to the compact h-7 (28px) once a mouse is the input —
              MobileTaskSheet.tsx documents the same split. Triggers fill it with
              h-full instead of repeating the breakpoint on every one. */}
          {/* A grid that squeezes up to 6 columns truncated labels illegibly on a
              narrow viewport (Phase 3 follow-up); scrolling horizontally instead
              keeps every label intact, matching Admin.tsx's tab strip. */}
          {/* Plan §3.0 — Knowledge Graph & Recipes moved to ⚙️ ترتیبات; the
              Library panel is now just: Home · My Documents · Shamela · Personal
              Library (JKHSSN's own browse surface lands with Phase 5). */}
          <TabsList className="w-full justify-start overflow-x-auto h-11 md:h-7 bg-muted p-0.5">
            <TabsTrigger value="home" className="text-xs h-full py-0 px-2 shrink-0">
              <Home className="h-3.5 w-3.5 me-1" />
              {t("nav.home", "Home")}
            </TabsTrigger>
            <TabsTrigger value="documents" className="text-xs h-full py-0 px-2 shrink-0">{t("library.tab_docs", "Docs")}</TabsTrigger>
            {shamelaAvailable && (
              <TabsTrigger value="shamela" className="text-xs h-full py-0 px-2 shrink-0">
                <LibraryIcon className="h-3.5 w-3.5 me-1" />
                {t("library.tab_shamela", "Shamela")}
              </TabsTrigger>
            )}
            <TabsTrigger value="sources" className="text-xs h-full py-0 px-2 shrink-0">{t("library.tab_sources", "Sources")}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="home" className="flex-1 min-h-0 m-0">
          <HomeTab
            // "Search all books" means the Search tab, not the research chat —
            // and only exists once there is a Shamela corpus for it to search.
            onSearch={shamelaAvailable ? () => { setShamelaInitialSubTab("search"); setActiveTab("shamela"); } : undefined}
            // Downloads books into the local corpus via IPC, so it needs both a
            // native install and a masterDbPath to browse — not just "available".
            onImport={
              shamelaAvailable && shamelaMasterDbPath
                ? () => setImportDialogOpen(true)
                : undefined
            }
            // The personal-corpus upload flow lives on the Sources tab; there is
            // no separate native "open file" dialog to trigger.
            onOpenFile={() => setActiveTab("sources")}
            onSelectBook={(itemId) => {
              onNavigate?.();
              setActiveDocumentId(itemId);
              navigate(`/workspace/${itemId}`, { replace: true });
            }}
          />
        </TabsContent>

        <TabsContent value="documents" className="flex-1 min-h-0 m-0">
          <ScrollArea className="h-full">
            {/* Renders only while the user still has Book Studio / Translation
                Projects data to bring across; see LegacyImportBanner. */}
            <LegacyImportBanner />
            <div className="p-2 space-y-3">
              <ProjectFolderSection />
              <LibraryDocumentTree
                projects={projects}
                docsMap={docsMap}
                activeDocumentId={activeDocumentId}
                activeDocumentWordCount={activeDocumentWordCount}
                loading={docsLoading}
                searchQuery={searchQuery}
                searchResults={searchResults}
                onSelectDocument={handleSelectDocument}
                onCreateDocument={handleCreateDocument}
                onCreateProject={() => setNewProjectOpen(true)}
              />
            </div>
          </ScrollArea>
        </TabsContent>

        {shamelaAvailable && (
          <TabsContent value="shamela" className="flex-1 min-h-0 m-0">
            <ShamelaTab
              onNavigate={onNavigate}
              initialSubTab={shamelaInitialSubTab}
              onSelectBrowseBook={(bookId) => {
                setActiveDocumentId(bookId);
                navigate(`/workspace/${bookId}`, { replace: true });
              }}
              onSelectSearchResult={(hit) => {
                setActiveDocumentId(hit.itemId);
                const page = hit.pageNumber != null && hit.pageNumber > 1 ? `?page=${hit.pageNumber}` : "";
                navigate(`/workspace/${hit.itemId}${page}`, { replace: true });
              }}
              onSelectFavoriteBook={(bookId) => {
                onNavigate?.();
                setActiveDocumentId(bookId);
                navigate(`/workspace/${bookId}`, { replace: true });
              }}
            />
          </TabsContent>
        )}

        <TabsContent value="sources" className="flex-1 min-h-0 m-0">
          <LibrarySourcesTab />
        </TabsContent>
      </Tabs>

      <LibraryNewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        title={newProjTitle}
        onTitleChange={setNewProjTitle}
        kind={newProjKind}
        onKindChange={setNewProjKind}
        creating={creatingProj}
        onCreate={handleCreateProject}
      />

      {shamelaAvailable && shamelaMasterDbPath && (
        <ShamelaImportDialog
          open={importDialogOpen}
          onOpenChange={setImportDialogOpen}
          masterDbPath={shamelaMasterDbPath}
        />
      )}
    </div>
  );
};
