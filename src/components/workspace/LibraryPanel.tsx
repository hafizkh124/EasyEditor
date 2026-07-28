import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  FolderPlus, FilePlus, BookOpen, Search, Plus, Upload, Database, ChevronLeft,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useLanguage } from "@/contexts/LanguageContext";
import { useProjects } from "@/core/workspace/useProjects";
import { documentService } from "@/core/workspace/documentService";
import { useWorkspace } from "@/core/workspace/WorkspaceContext";
import { stripHarakat } from "@/utils/arabicUtils";
import { LibraryDocumentTree } from "./LibraryDocumentTree";
import { LibraryNewProjectDialog } from "./LibraryNewProjectDialog";
import type { Document, ProjectKind } from "@/core/workspace/types";

interface LibraryPanelProps {
  /** Inside the mobile drawer the icon-rail state makes no sense — stay open. */
  forceExpanded?: boolean;
  /** Called after the user opens something, so a drawer can close itself. */
  onNavigate?: () => void;
}

export const LibraryPanel: React.FC<LibraryPanelProps> = ({ forceExpanded = false, onNavigate }) => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { projects, loading: projectsLoading, createProject } = useProjects();
  const { activeDocumentId, setActiveDocumentId, libraryCollapsed: storedCollapsed, toggleLibrary } = useWorkspace();
  const libraryCollapsed = forceExpanded ? false : storedCollapsed;

  const [docsMap, setDocsMap] = useState<Record<string, Document[]>>({});
  const [allDocs, setAllDocs] = useState<(Document & { projectName: string; projectKind: ProjectKind })[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [docsLoading, setDocsLoading] = useState(false);

  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjTitle, setNewProjTitle] = useState("");
  const [newProjKind, setNewProjKind] = useState<ProjectKind>("general");
  const [creatingProj, setCreatingProj] = useState(false);

  // Load documents for all projects
  useEffect(() => {
    const loadDocs = async () => {
      setDocsLoading(true);
      const map: Record<string, Document[]> = {};
      const flatList: (Document & { projectName: string; projectKind: ProjectKind })[] = [];

      for (const p of projects) {
        try {
          const docs = await documentService.listDocuments(p.id);
          map[p.id] = docs;
          docs.forEach((d) => {
            flatList.push({ ...d, projectName: p.title, projectKind: p.kind });
          });
        } catch {
          map[p.id] = [];
        }
      }
      setDocsMap(map);
      setAllDocs(flatList);
      setDocsLoading(false);
    };

    if (projects.length > 0) {
      loadDocs();
    }
  }, [projects]);

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
    if (projectKind === "translation") {
      // Per FR-2.1.1: translation projects open TranslationWorkspace in full Canvas
      navigate("/translate-workspace");
      return;
    }
    setActiveDocumentId(doc.id);
    navigate(`/workspace/${doc.id}`, { replace: true });
  };

  const handleCreateProject = async () => {
    if (!newProjTitle.trim()) return;
    try {
      setCreatingProj(true);
      const proj = await createProject(newProjTitle.trim(), newProjKind);
      toast.success("Project created");
      setNewProjectOpen(false);
      setNewProjTitle("");

      const doc = await documentService.createDocument(proj.id, t("editor.untitled") || "Untitled Document");
      setActiveDocumentId(doc.id);
      navigate(`/workspace/${doc.id}`, { replace: true });
    } catch (err: any) {
      toast.error(err.message || "Failed to create project");
    } finally {
      setCreatingProj(false);
    }
  };

  const handleCreateDocument = async (projectId: string) => {
    try {
      const doc = await documentService.createDocument(projectId, t("editor.untitled") || "Untitled Document");
      onNavigate?.();
      setActiveDocumentId(doc.id);
      navigate(`/workspace/${doc.id}`, { replace: true });
    } catch (err: any) {
      toast.error(err.message || "Failed to create document");
    }
  };

  if (libraryCollapsed) {
    return (
      <div className="flex flex-col items-center py-3 px-1 border-e border-border h-full bg-sidebar shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8 mb-2" onClick={toggleLibrary} title="Expand Library">
          <BookOpen className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-sidebar border-e border-sidebar-border overflow-hidden select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm text-sidebar-foreground">Library</span>
        </div>

        <div className="flex items-center gap-1">
          {/* "+ New" Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-sidebar-foreground">
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuItem onClick={() => setNewProjectOpen(true)} className="gap-2 cursor-pointer">
                <FolderPlus className="h-4 w-4 text-primary" />
                <span>New Project</span>
              </DropdownMenuItem>
              {projects[0] && (
                <DropdownMenuItem onClick={() => handleCreateDocument(projects[0].id)} className="gap-2 cursor-pointer">
                  <FilePlus className="h-4 w-4 text-primary" />
                  <span>New Document</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/ocr")} className="gap-2 cursor-pointer text-xs">
                <Upload className="h-3.5 w-3.5" />
                <span>Ingest via OCR</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/transcribe")} className="gap-2 cursor-pointer text-xs">
                <Upload className="h-3.5 w-3.5" />
                <span>Ingest via Transcribe</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="ghost" size="icon" className="h-7 w-7 text-sidebar-foreground" onClick={toggleLibrary} title="Collapse Library">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Global Search across all projects */}
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

      {/* Tabs: Documents vs Sources */}
      <Tabs defaultValue="documents" className="flex-1 flex flex-col min-h-0">
        <div className="px-2 pt-2 border-b border-sidebar-border">
          <TabsList className="grid grid-cols-2 h-7 bg-muted/50 p-0.5">
            <TabsTrigger value="documents" className="text-xs h-6 py-0">Documents</TabsTrigger>
            <TabsTrigger value="sources" className="text-xs h-6 py-0">Sources</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="documents" className="flex-1 min-h-0 m-0">
          <ScrollArea className="h-full">
            <div className="p-2 space-y-3">
              <LibraryDocumentTree
                projects={projects}
                docsMap={docsMap}
                activeDocumentId={activeDocumentId}
                loading={projectsLoading || docsLoading}
                searchQuery={searchQuery}
                searchResults={searchResults}
                onSelectDocument={handleSelectDocument}
                onCreateDocument={handleCreateDocument}
                onCreateProject={() => setNewProjectOpen(true)}
              />
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="sources" className="flex-1 min-h-0 m-0">
          <ScrollArea className="h-full">
            <div className="p-3 text-xs text-muted-foreground text-center py-8 space-y-2">
              <Database className="h-6 w-6 mx-auto opacity-50 text-primary" />
              <p className="font-semibold text-foreground">Library Sources</p>
              <p className="text-[11px]">Uploaded books, PDFs, and web sources indexed in your library.</p>
            </div>
          </ScrollArea>
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
    </div>
  );
};
