import React from "react";
import { BookOpen, FileText, FolderPlus, Languages, Layers, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./EmptyState";
import { useLanguage } from "@/contexts/LanguageContext";
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
  const { t } = useLanguage();
  // Search spans every project and names the project each hit came from — the
  // scholar usually remembers the sentence, not where they filed it (FR-2.5).
  if (searchQuery.trim().length > 0) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground px-2 py-1">
          {t("library.search_found", "Found {count} document(s)").replace("{count}", String(searchResults.length))}
        </p>
        {searchResults.length === 0 ? (
          <p className="text-xs text-muted-foreground p-3 text-center">
            {t("library.search_no_matches", "No documents found matching \"{query}\"").replace("{query}", searchQuery)}
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
              <p className="text-xs text-muted-foreground truncate">{d.projectName}</p>
            </button>
          ))
        )}
      </div>
    );
  }

  if (loading) {
    return <div className="py-8 text-center text-xs text-muted-foreground animate-pulse">{t("library.loading_library", "Loading Library...")}</div>;
  }

  if (projects.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title={t("library.no_projects_yet", "No Projects Yet")}
        description={t("library.no_projects_hint", "Create your first project to organize documents and research.")}
        action={
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onCreateProject}>
            <FolderPlus className="h-3.5 w-3.5" /> {t("library.create_project", "Create Project")}
          </Button>
        }
      />
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
                className="h-5 w-5 min-h-touch min-w-touch md:h-5 md:w-5 md:min-h-0 md:min-w-0 text-muted-foreground hover:text-foreground"
                onClick={() => onCreateDocument(p.id)}
                title={t("library.new_document_in_project", "New document in project")}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="ms-3 ps-2 border-s border-sidebar-border space-y-0.5">
              {docs.length === 0 ? (
                <button
                  type="button"
                  onClick={() => onCreateDocument(p.id)}
                  className="w-full flex items-center gap-1.5 text-start px-2 py-1.5 rounded text-xs text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
                >
                  <Plus className="h-3 w-3 shrink-0" />
                  {t("library.no_documents_hint", "No documents yet — tap to create one")}
                </button>
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
                      <span className="text-xs text-muted-foreground shrink-0 ms-1">{t("library.word_count_short", "{count}w").replace("{count}", String(doc.word_count))}</span>
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
