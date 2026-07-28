import React from "react";
import { BookOpen, FileText, FolderPlus, Languages, Layers, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Document, Project, ProjectKind } from "@/core/workspace/types";

const kindIcons: Record<ProjectKind, typeof BookOpen> = {
  research: BookOpen,
  book: FileText,
  translation: Languages,
  general: Layers,
};

export type SearchHit = Document & { projectName: string; projectKind?: ProjectKind };

interface LibraryDocumentTreeProps {
  projects: Project[];
  docsMap: Record<string, Document[]>;
  activeDocumentId: string | null;
  loading: boolean;
  searchQuery: string;
  searchResults: SearchHit[];
  onSelectDocument: (doc: Document, projectKind?: ProjectKind) => void;
  onCreateDocument: (projectId: string) => void;
  onCreateProject: () => void;
}

export const LibraryDocumentTree: React.FC<LibraryDocumentTreeProps> = ({
  projects, docsMap, activeDocumentId, loading, searchQuery, searchResults,
  onSelectDocument, onCreateDocument, onCreateProject,
}) => {
  // Search spans every project and names the project each hit came from — the
  // scholar usually remembers the sentence, not where they filed it (FR-2.5).
  if (searchQuery.trim().length > 0) {
    return (
      <div className="space-y-1">
        <p className="text-[11px] font-medium text-muted-foreground px-2 py-1">
          Found {searchResults.length} document(s)
        </p>
        {searchResults.length === 0 ? (
          <p className="text-xs text-muted-foreground p-3 text-center">
            No documents found matching "{searchQuery}"
          </p>
        ) : (
          searchResults.map((d) => (
            <button
              key={d.id}
              onClick={() => onSelectDocument(d, d.projectKind)}
              className={`w-full text-start p-2 rounded-md hover:bg-sidebar-accent/60 transition-colors ${
                activeDocumentId === d.id ? "bg-sidebar-accent font-medium text-primary" : "text-sidebar-foreground"
              }`}
            >
              <p className="text-xs font-semibold truncate">{d.title}</p>
              <p className="text-[10px] text-muted-foreground truncate">{d.projectName}</p>
            </button>
          ))
        )}
      </div>
    );
  }

  if (loading) {
    return <div className="py-8 text-center text-xs text-muted-foreground animate-pulse">Loading Library...</div>;
  }

  if (projects.length === 0) {
    return (
      <div className="py-8 text-center space-y-2">
        <p className="text-xs text-muted-foreground">No projects yet</p>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onCreateProject}>
          <FolderPlus className="h-3.5 w-3.5" /> Create Project
        </Button>
      </div>
    );
  }

  return (
    <>
      {projects.map((p) => {
        const Icon = kindIcons[p.kind] || Layers;
        const docs = docsMap[p.id] || [];

        return (
          <div key={p.id} className="space-y-0.5">
            <div className="flex items-center justify-between px-2 py-1.5 rounded-md bg-sidebar-accent/30 text-sidebar-foreground">
              <div className="flex items-center gap-2 min-w-0">
                <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="text-xs font-semibold truncate">{p.title}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-foreground"
                onClick={() => onCreateDocument(p.id)}
                title="New document in project"
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>

            <div className="ms-3 ps-2 border-s border-sidebar-border space-y-0.5">
              {docs.length === 0 ? (
                <p className="text-[11px] text-muted-foreground px-2 py-1">No documents</p>
              ) : (
                docs.map((doc) => {
                  const isActive = activeDocumentId === doc.id;
                  return (
                    <button
                      key={doc.id}
                      onClick={() => onSelectDocument(doc, p.kind)}
                      className={`w-full flex items-center justify-between text-start px-2 py-1.5 rounded text-xs transition-colors ${
                        isActive
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                      }`}
                    >
                      <span className="truncate">{doc.title}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0 ms-1">{doc.word_count}w</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </>
  );
};
