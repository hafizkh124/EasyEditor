import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FolderPlus, FilePlus, BookOpen, Layers, Languages, FileText, ChevronRight, Clock } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/contexts/LanguageContext";
import { useSeo } from "@/hooks/useSeo";
import { useProjects } from "@/core/workspace/useProjects";
import { documentService } from "@/core/workspace/documentService";
import type { Document, ProjectKind } from "@/core/workspace/types";

const kindIcons: Record<ProjectKind, typeof BookOpen> = {
  research: BookOpen,
  book: FileText,
  translation: Languages,
  general: Layers,
};

const Library = () => {
  useSeo({ title: "Library — Easy Editor", description: "Manage projects and documents in your scholarly workspace.", path: "/library", noindex: true });
  const { direction } = useLanguage();
  const navigate = useNavigate();
  const { projects, loading, createProject } = useProjects();

  const [docsMap, setDocsMap] = useState<Record<string, Document[]>>({});
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjTitle, setNewProjTitle] = useState("");
  const [newProjKind, setNewProjKind] = useState<ProjectKind>("general");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const loadDocs = async () => {
      const map: Record<string, Document[]> = {};
      for (const p of projects) {
        try {
          const docs = await documentService.listDocuments(p.id);
          map[p.id] = docs;
        } catch {
          map[p.id] = [];
        }
      }
      setDocsMap(map);
    };
    if (projects.length > 0) {
      loadDocs();
    }
  }, [projects]);

  const handleCreateProject = async () => {
    if (!newProjTitle.trim()) return;
    try {
      setCreating(true);
      const proj = await createProject(newProjTitle.trim(), newProjKind);
      toast.success("Project created");
      setNewProjectOpen(false);
      setNewProjTitle("");

      // Automatically create initial document in new project
      const doc = await documentService.createDocument(proj.id, "Untitled Document");
      navigate(`/editor/${doc.id}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to create project");
    } finally {
      setCreating(false);
    }
  };

  const handleCreateDocument = async (projectId: string) => {
    try {
      const doc = await documentService.createDocument(projectId, "Untitled Document");
      navigate(`/editor/${doc.id}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to create document");
    }
  };

  return (
    <AppLayout>
      <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6" dir={direction}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Workspace Library</h1>
            <p className="text-sm text-muted-foreground">Manage your research projects and documents</p>
          </div>
          <Button onClick={() => setNewProjectOpen(true)} className="gap-2">
            <FolderPlus className="h-4 w-4" />
            New Project
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : projects.length === 0 ? (
          <Card className="text-center py-12 px-4">
            <CardHeader>
              <CardTitle className="text-lg">No Projects Yet</CardTitle>
              <CardDescription>Create your first project to organize documents and research.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => setNewProjectOpen(true)} className="gap-2">
                <FolderPlus className="h-4 w-4" />
                Create First Project
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6">
            {projects.map((p) => {
              const Icon = kindIcons[p.kind] || Layers;
              const docs = docsMap[p.id] || [];

              return (
                <Card key={p.id} className="overflow-hidden border border-border/80 shadow-sm">
                  <CardHeader className="bg-muted/30 pb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-primary/10 text-primary">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div>
                          <CardTitle className="text-base font-semibold">{p.title}</CardTitle>
                          <CardDescription className="text-xs">
                            Created {new Date(p.created_at).toLocaleDateString()}
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="capitalize text-xs">
                          {p.kind}
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 gap-1 text-xs"
                          onClick={() => handleCreateDocument(p.id)}
                        >
                          <FilePlus className="h-3.5 w-3.5" />
                          New Doc
                        </Button>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="p-0 divide-y divide-border">
                    {docs.length === 0 ? (
                      <div className="p-4 text-center text-xs text-muted-foreground">
                        No documents in this project yet.{" "}
                        <button
                          onClick={() => handleCreateDocument(p.id)}
                          className="text-primary underline hover:text-primary/80 font-medium"
                        >
                          Create one now
                        </button>
                      </div>
                    ) : (
                      docs.map((doc) => (
                        <div
                          key={doc.id}
                          onClick={() => navigate(`/editor/${doc.id}`)}
                          className="flex items-center justify-between p-4 hover:bg-muted/50 cursor-pointer transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div className="truncate">
                              <p className="text-sm font-medium text-foreground truncate">{doc.title}</p>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                                <span>{doc.word_count} words</span>
                                <span>•</span>
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {new Date(doc.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-60" />
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* New Project Dialog */}
        <Dialog open={newProjectOpen} onOpenChange={setNewProjectOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create New Project</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="proj-title">Project Title</Label>
                <Input
                  id="proj-title"
                  placeholder="e.g. Usul al-Fiqh Research"
                  value={newProjTitle}
                  onChange={(e) => setNewProjTitle(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="proj-kind">Project Kind</Label>
                <Select value={newProjKind} onValueChange={(v) => setNewProjKind(v as ProjectKind)}>
                  <SelectTrigger id="proj-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General Workspace</SelectItem>
                    <SelectItem value="research">Research & Fatawa</SelectItem>
                    <SelectItem value="book">Book Composition</SelectItem>
                    <SelectItem value="translation">Translation</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNewProjectOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateProject} disabled={creating || !newProjTitle.trim()}>
                {creating ? "Creating..." : "Create Project"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
};

export default Library;
