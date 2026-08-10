import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Plus, Search, PanelRight, Languages, Folder, FolderPlus } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { useWorkspace } from "@/core/workspace/WorkspaceContext";
import { useAllDocuments } from "@/core/workspace/useAllDocuments";
import { documentService } from "@/core/workspace/documentService";
import { useLanguage } from "@/contexts/LanguageContext";
import { translateStored } from "@/lib/i18n";
import { stripHarakat } from "@/utils/arabicUtils";
import { toast } from "sonner";

export const CommandPalette: React.FC = () => {
  const navigate = useNavigate();
  const { t, language, setLanguage } = useLanguage();
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    setActiveDocumentId,
    toggleWorkbench,
    setWorkbenchTab,
  } = useWorkspace();

  const { projects, docsMap, allDocs, refresh: refreshAllDocs } = useAllDocuments();
  const [search, setSearch] = useState("");

  // Restore focus to Canvas ProseMirror editor on close
  const handleOpenChange = useCallback(
    (open: boolean) => {
      setCommandPaletteOpen(open);
      if (!open) {
        setTimeout(() => {
          const pm = document.querySelector<HTMLElement>(".ProseMirror");
          pm?.focus();
        }, 50);
      }
    },
    [setCommandPaletteOpen],
  );

  // Listen to Cmd+K / Ctrl+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        handleOpenChange(!commandPaletteOpen);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commandPaletteOpen, handleOpenChange]);

  const handleSelectDoc = (docId: string, projectKind?: string) => {
    setActiveDocumentId(docId);
    if (projectKind === "translation") {
      navigate(`/workspace/${docId}?view=translation`, { replace: true });
    } else {
      navigate(`/workspace/${docId}`, { replace: true });
    }
    handleOpenChange(false);
  };

  const handleCreateNewDoc = async () => {
    if (!projects[0]) return;
    try {
      const created = await documentService.createDocument(projects[0].id, t("editor.untitled") || "Untitled Document");
      refreshAllDocs();
      setActiveDocumentId(created.id);
      navigate(`/workspace/${created.id}`, { replace: true });
      handleOpenChange(false);
    } catch {
      toast.error(translateStored("toast.workspace.document_create_failed"));
    }
  };

  const handleCreateNewProject = async () => {
    try {
      const title = window.prompt("نئے پروجیکٹ کا عنوان:");
      if (!title?.trim()) return;
      await documentService.createProject(title.trim(), "general");
      refreshAllDocs();
      toast.success(translateStored("toast.workspace.project_created"));
      handleOpenChange(false);
    } catch {
      toast.error(translateStored("toast.workspace.project_create_failed"));
    }
  };

  const cleanSearch = stripHarakat(search.trim().toLowerCase());

  const filteredDocs = allDocs.filter((d) => {
    if (!cleanSearch) return true;
    const titleMatch = stripHarakat(d.title.toLowerCase()).includes(cleanSearch);
    const textMatch = d.plain_text ? stripHarakat(d.plain_text.toLowerCase()).includes(cleanSearch) : false;
    return titleMatch || textMatch;
  });

  const filteredProjects = projects.filter((p) => {
    if (!cleanSearch) return true;
    return stripHarakat(p.title.toLowerCase()).includes(cleanSearch);
  });

  return (
    <CommandDialog open={commandPaletteOpen} onOpenChange={handleOpenChange}>
      <CommandInput
        placeholder="ایکشن، پروجیکٹ یا دستاویز تلاش کریں..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>کوئی نتیجہ نہیں ملا۔</CommandEmpty>

        {/* Documents */}
        <CommandGroup heading="دستاویزات (Documents)">
          {filteredDocs.slice(0, 8).map((d) => (
            <CommandItem
              key={d.id}
              onSelect={() => handleSelectDoc(d.id, d.projectKind)}
              className="flex items-center justify-between cursor-pointer"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 text-primary shrink-0" />
                <span className="truncate font-medium">{d.title}</span>
                <span className="text-xs text-muted-foreground truncate">({d.projectName})</span>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        {/* Projects */}
        <CommandGroup heading="پروجیکٹس (Projects)">
          {filteredProjects.slice(0, 5).map((p) => (
            <CommandItem
              key={p.id}
              onSelect={() => {
                const firstDoc = docsMap[p.id]?.[0];
                if (firstDoc) {
                  handleSelectDoc(firstDoc.id, p.kind);
                } else {
                  toast.info(translateStored("toast.workspace.project_empty"));
                  handleOpenChange(false);
                }
              }}
              className="flex items-center gap-2 cursor-pointer"
            >
              <Folder className="h-4 w-4 text-amber-500 shrink-0" />
              <span className="truncate font-medium">{p.title}</span>
              <span className="text-xs text-muted-foreground capitalize">({p.kind})</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        {/* Quick Actions */}
        <CommandGroup heading="ایکشنز (Actions)">
          <CommandItem onSelect={handleCreateNewDoc} className="cursor-pointer gap-2">
            <Plus className="h-4 w-4 text-emerald-500" />
            <span>نئی دستاویز بنائیں (New Document)</span>
          </CommandItem>

          <CommandItem onSelect={handleCreateNewProject} className="cursor-pointer gap-2">
            <FolderPlus className="h-4 w-4 text-amber-500" />
            <span>نیا پروجیکٹ بنائیں (New Project)</span>
          </CommandItem>

          <CommandItem
            onSelect={() => {
              toggleWorkbench();
              handleOpenChange(false);
            }}
            className="cursor-pointer gap-2"
          >
            <PanelRight className="h-4 w-4 text-primary" />
            <span>ورک بینچ کھولیں/بند کریں (Toggle Workbench)</span>
          </CommandItem>

          <CommandItem
            onSelect={() => {
              setWorkbenchTab("research");
              handleOpenChange(false);
            }}
            className="cursor-pointer gap-2"
          >
            <Search className="h-4 w-4 text-blue-500" />
            <span>تحقیقاتی ٹیب کھولیں (Open Research Tab)</span>
          </CommandItem>

          <CommandItem
            onSelect={() => {
              setLanguage(language === "ur" ? "en" : "ur");
              handleOpenChange(false);
            }}
            className="cursor-pointer gap-2"
          >
            <Languages className="h-4 w-4 text-purple-500" />
            <span>زبان بدلیں (Switch Language / RTL)</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};
