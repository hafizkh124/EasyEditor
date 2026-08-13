import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  FolderPlus, BookOpen, Search, Plus, Upload, ChevronLeft, Volume2, Home, FolderTree, Star,
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
import { LibraryDocumentTree } from "./LibraryDocumentTree";
import { LibraryNewProjectDialog } from "./LibraryNewProjectDialog";
import { LibrarySourcesTab } from "./LibrarySourcesTab";
import { KnowledgeGraphTab } from "./KnowledgeGraphTab";
import { RecipesTab } from "./RecipesTab";
import { HomeTab } from "./HomeTab";
import { BrowseTab } from "./BrowseTab";
import { SearchTab } from "./SearchTab";
import { FavoritesTab } from "./FavoritesTab";
import type { Document, ProjectKind } from "@/core/workspace/types";
import { availableCapabilities } from "@/core/capabilities/registry";
import { LegacyImportBanner } from "./LegacyImportBanner";

interface LibraryPanelProps {
  /** Inside the mobile drawer the icon-rail state makes no sense — stay open. */
  forceExpanded?: boolean;
  /** Called after the user opens something, so a drawer can close itself. */
  onNavigate?: () => void;
}

// Spelled out because Tailwind only ships classes it can see in the source —
// a template-built `grid-cols-${n}` is purged and the tabs collapse.
const TAB_GRID: Record<number, string> = {
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
};

export const LibraryPanel: React.FC<LibraryPanelProps> = ({ forceExpanded = false, onNavigate }) => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  // Only the ingest tools that exist on this runtime (OCR is web-only; the two
  // voice tools ride the offline-engine flag on desktop).
  const ingestRoutes = availableCapabilities("dashboard-grid").filter((c) => c.group === "tool");
  const { activeDocumentId, setActiveDocumentId, libraryCollapsed: storedCollapsed, toggleLibrary } = useWorkspace();
  const libraryCollapsed = forceExpanded ? false : storedCollapsed;

  const { projects, docsMap, allDocs, loading: docsLoading, refresh: refreshAllDocs } = useAllDocuments();
  const [searchQuery, setSearchQuery] = useState("");

  // M4 pillars ship independently; each tab exists only when its flag is on.
  // M6 adds Home tab as the first tab.
  const graphEnabled = import.meta.env.VITE_KNOWLEDGE_GRAPH !== "false";
  const recipesEnabled = import.meta.env.VITE_RECIPES !== "false";
  const tabCount = 6 + (graphEnabled ? 1 : 0) + (recipesEnabled ? 1 : 0);

  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjTitle, setNewProjTitle] = useState("");
  const [newProjKind, setNewProjKind] = useState<ProjectKind>("general");
  const [creatingProj, setCreatingProj] = useState(false);

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
      toast.success(t("library.project_created") || "Project created");
      setNewProjectOpen(false);
      setNewProjTitle("");
      refreshAllDocs();
    } catch {
      toast.error(t("library.create_error") || "Failed to create project");
    } finally {
      setCreatingProj(false);
    }
  };

  const handleCreateDocument = async (projectId: string) => {
    try {
      const d = await documentService.createDocument(projectId, t("editor.untitled") || "Untitled Document");
      refreshAllDocs();
      handleSelectDocument(d);
    } catch {
      toast.error(t("library.doc_create_error") || "Failed to create document");
    }
  };

  if (libraryCollapsed) {
    return (
      <div className="flex flex-col items-center py-3 gap-3 h-full bg-sidebar border-e border-sidebar-border w-12 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-sidebar-foreground" onClick={toggleLibrary} aria-label="Expand Library">
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
          <span className="font-semibold text-xs tracking-wide uppercase">Library</span>
        </div>
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-sidebar-foreground" aria-label="Add project or ingest">
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

          <Button variant="ghost" size="icon" className="h-7 w-7 text-sidebar-foreground" onClick={toggleLibrary} aria-label="Collapse Library">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Global Search */}
      <div className="p-2 border-b border-sidebar-border">
        <div className="relative">
          <Search className="absolute start-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search all projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 text-xs ps-8 bg-sidebar-accent/50 border-0 focus-visible:ring-1"
          />
        </div>
      </div>

      <Tabs defaultValue="home" className="flex-1 flex flex-col min-h-0">
        <div className="px-2 pt-2 border-b border-sidebar-border">
          {/* Tab count follows the flags: with both M4 pillars off the Library
              is back to M2/M3's two tabs, not two dead ones (NFR-6). */}
          <TabsList className={`grid ${TAB_GRID[tabCount]} h-7 bg-muted p-0.5`}>
            <TabsTrigger value="home" className="text-xs h-6 py-0 px-1 truncate">
              <Home className="h-3 w-3 mr-1" />
              Home
            </TabsTrigger>
            <TabsTrigger value="documents" className="text-xs h-6 py-0 px-1 truncate">Docs</TabsTrigger>
            <TabsTrigger value="browse" className="text-xs h-6 py-0 px-1 truncate">
              <FolderTree className="h-3 w-3 mr-1" />
              Browse
            </TabsTrigger>
            <TabsTrigger value="search" className="text-xs h-6 py-0 px-1 truncate">
              <Search className="h-3 w-3 mr-1" />
              Search
            </TabsTrigger>
            <TabsTrigger value="favorites" className="text-xs h-6 py-0 px-1 truncate">
              <Star className="h-3 w-3 mr-1" />
              Favorites
            </TabsTrigger>
            <TabsTrigger value="sources" className="text-xs h-6 py-0 px-1 truncate">Sources</TabsTrigger>
            {graphEnabled && (
              <TabsTrigger value="graph" className="text-xs h-6 py-0 px-1 truncate">Graph</TabsTrigger>
            )}
            {recipesEnabled && (
              <TabsTrigger value="recipes" className="text-xs h-6 py-0 px-1 truncate">Recipes</TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent value="home" className="flex-1 min-h-0 m-0">
          <HomeTab
            onSearch={() => {
              // Switch to a search tab or open search
              navigate("/workspace?panel=research");
            }}
            onImport={() => {
              // Open the Shamela import dialog — will be triggered via a ref or event
              window.dispatchEvent(new CustomEvent("shamela:open-import"));
            }}
            onOpenFile={() => {
              // Trigger file open — will be handled by the workspace
              window.dispatchEvent(new CustomEvent("workspace:open-file"));
            }}
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
              <LibraryDocumentTree
                projects={projects}
                docsMap={docsMap}
                activeDocumentId={activeDocumentId}
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

        <TabsContent value="browse" className="flex-1 min-h-0 m-0">
          <BrowseTab
            onNavigate={onNavigate}
            onSelectBook={(bookId) => {
              setActiveDocumentId(bookId);
              navigate(`/workspace/${bookId}`, { replace: true });
            }}
          />
        </TabsContent>

        <TabsContent value="search" className="flex-1 min-h-0 m-0">
          <SearchTab
            onNavigate={onNavigate}
            onSelectResult={(hit) => {
              setActiveDocumentId(hit.itemId);
              const page = hit.pageNumber != null && hit.pageNumber > 1 ? `?page=${hit.pageNumber}` : "";
              navigate(`/workspace/${hit.itemId}${page}`, { replace: true });
            }}
          />
        </TabsContent>

        <TabsContent value="sources" className="flex-1 min-h-0 m-0">
          <LibrarySourcesTab />
        </TabsContent>

        <TabsContent value="favorites" className="flex-1 min-h-0 m-0">
          <FavoritesTab
            onSelectBook={(bookId) => {
              onNavigate?.();
              setActiveDocumentId(bookId);
              navigate(`/workspace/${bookId}`, { replace: true });
            }}
          />
        </TabsContent>

        {graphEnabled && (
          <TabsContent value="graph" className="flex-1 min-h-0 m-0">
            <KnowledgeGraphTab />
          </TabsContent>
        )}

        {recipesEnabled && (
          <TabsContent value="recipes" className="flex-1 min-h-0 m-0">
            <RecipesTab />
          </TabsContent>
        )}
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
    </div>
  );
};
