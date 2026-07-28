import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Plus, Search, PanelRight, Languages } from "lucide-react";
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
import { useProjects } from "@/core/workspace/useProjects";
import { documentService } from "@/core/workspace/documentService";
import { useLanguage } from "@/contexts/LanguageContext";
import { stripHarakat } from "@/utils/arabicUtils";
import type { Document } from "@/core/workspace/types";

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

  const { projects } = useProjects();
  const [docs, setDocs] = useState<(Document & { projectName: string })[]>([]);
  const [search, setSearch] = useState("");

  // Listen to Cmd+K / Ctrl+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  // Load documents when dialog opens
  useEffect(() => {
    if (!commandPaletteOpen || projects.length === 0) return;
    const fetchDocs = async () => {
      const all: (Document & { projectName: string })[] = [];
      for (const p of projects) {
        try {
          const list = await documentService.listDocuments(p.id);
          list.forEach((d) => all.push({ ...d, projectName: p.title }));
        } catch {
          /* ignore */
        }
      }
      setDocs(all);
    };
    fetchDocs();
  }, [commandPaletteOpen, projects]);

  const handleSelectDoc = (docId: string) => {
    setActiveDocumentId(docId);
    navigate(`/workspace/${docId}`, { replace: true });
    setCommandPaletteOpen(false);
  };

  const handleCreateNewDoc = async () => {
    if (!projects[0]) return;
    try {
      const created = await documentService.createDocument(projects[0].id, t("editor.untitled") || "Untitled Document");
      setActiveDocumentId(created.id);
      navigate(`/workspace/${created.id}`, { replace: true });
      setCommandPaletteOpen(false);
    } catch {
      /* ignore */
    }
  };

  const cleanSearch = stripHarakat(search.trim().toLowerCase());

  const filteredDocs = docs.filter((d) => {
    if (!cleanSearch) return true;
    const titleMatch = stripHarakat(d.title.toLowerCase()).includes(cleanSearch);
    const textMatch = d.plain_text ? stripHarakat(d.plain_text.toLowerCase()).includes(cleanSearch) : false;
    return titleMatch || textMatch;
  });

  return (
    <CommandDialog open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
      <CommandInput
        placeholder="ایکشن یا دستاویز تلاش کریں..."
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
              onSelect={() => handleSelectDoc(d.id)}
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

        {/* Quick Actions */}
        <CommandGroup heading="ایکشنز (Actions)">
          <CommandItem onSelect={handleCreateNewDoc} className="cursor-pointer gap-2">
            <Plus className="h-4 w-4 text-emerald-500" />
            <span>نئی دستاویز بنائیں (New Document)</span>
          </CommandItem>

          <CommandItem
            onSelect={() => {
              toggleWorkbench();
              setCommandPaletteOpen(false);
            }}
            className="cursor-pointer gap-2"
          >
            <PanelRight className="h-4 w-4 text-primary" />
            <span>ورک بینچ کھولیں/بند کریں (Toggle Workbench)</span>
          </CommandItem>

          <CommandItem
            onSelect={() => {
              setWorkbenchTab("research");
              setCommandPaletteOpen(false);
            }}
            className="cursor-pointer gap-2"
          >
            <Search className="h-4 w-4 text-blue-500" />
            <span>تحقیقاتی ٹیب کھولیں (Open Research Tab)</span>
          </CommandItem>

          <CommandItem
            onSelect={() => {
              setLanguage(language === "ur" ? "en" : "ur");
              setCommandPaletteOpen(false);
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
