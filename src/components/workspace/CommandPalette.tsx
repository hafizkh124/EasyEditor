import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Plus, Search, PanelRight, PanelLeft, Languages, Folder, FolderPlus, Settings2, Sparkles } from "lucide-react";
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
import { useSkills } from "@/lib/skills/useSkills";
import { matchesSkill } from "@/lib/skills/registry";
import { SKILLS_SETTINGS_PATH } from "@/lib/skills/useOpenSkillsSettings";
import type { Skill } from "@/lib/skills/types";
import type { Recipe } from "@/lib/recipes/recipeService";
import { RecipeRunDialog } from "./RecipeRunDialog";

export const CommandPalette: React.FC = () => {
  const navigate = useNavigate();
  const { t, language, setLanguage } = useLanguage();
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    setActiveDocumentId,
    toggleWorkbench,
    stageCollapsed,
    setStageCollapsed,
    setWorkbenchTab,
    openRailPanel,
    setWorkbenchOpen,
    runEditorTask,
    runDocumentTask,
    requestSkillPrompt,
    sendSelectionToWorkbench,
  } = useWorkspace();
  const { skills, forPlace } = useSkills();
  const [recipeToRun, setRecipeToRun] = useState<Recipe | null>(null);

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
      const created = await documentService.createDocument(projects[0].id, t("editor.untitled", "Untitled Document"));
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
      const title = window.prompt(t("library.cmd_project_prompt", "New project title:"));
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

  // Skills (SYSTEM-2026 §7): the same list as the `/` menus. Each one runs
  // where it belongs — editor skills on the open document's selection, chat
  // skills in the research chat — and is absent when that place is not open.
  const runSkill = (skill: Skill): (() => void) | null => {
    if (skill.recipe) return runDocumentTask ? () => setRecipeToRun(skill.recipe!) : null;
    if (skill.places.includes("editor") && skill.taskSlug && runEditorTask) return () => runEditorTask(skill.taskSlug!);
    const toChat = (go: () => void) => () => {
      setWorkbenchOpen(true);
      go();
    };
    if (skill.prompt) return toChat(() => requestSkillPrompt(skill.prompt!));
    if (skill.kind === "workflow" && skill.trigger) return toChat(() => sendSelectionToWorkbench(`/${skill.trigger} `));
    if (skill.places.includes("chat") && skill.promptText) return toChat(() => sendSelectionToWorkbench(skill.promptText!));
    return null;
  };
  // Registry order ("مجھ سے پوچھو" first), minus whatever is hidden.
  const visible = new Set([...forPlace("editor"), ...forPlace("chat")].map((skill) => skill.id));
  const skillItems = skills
    .filter((skill) => visible.has(skill.id))
    .filter((skill) => !cleanSearch || matchesSkill(skill, search, stripHarakat))
    .map((skill) => ({ skill, run: runSkill(skill) }))
    .filter((item): item is { skill: Skill; run: () => void } => item.run !== null);

  return (
    <>
    <CommandDialog open={commandPaletteOpen} onOpenChange={handleOpenChange}>
      <CommandInput
        placeholder={t("library.cmd_placeholder", "Search actions, projects or documents...")}
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>{t("library.cmd_no_results", "No results found.")}</CommandEmpty>

        {/* Documents */}
        <CommandGroup heading={t("library.cmd_documents", "Documents")}>
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
        <CommandGroup heading={t("library.cmd_projects", "Projects")}>
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
              <Folder className="h-4 w-4 text-warning shrink-0" />
              <span className="truncate font-medium">{p.title}</span>
              <span className="text-xs text-muted-foreground capitalize">({p.kind})</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        {/* Quick Actions */}
        <CommandGroup heading={t("library.cmd_actions", "Actions")}>
          <CommandItem onSelect={handleCreateNewDoc} className="cursor-pointer gap-2">
            <Plus className="h-4 w-4 text-success" />
            <span>{t("library.cmd_new_document", "New Document")}</span>
          </CommandItem>

          <CommandItem onSelect={handleCreateNewProject} className="cursor-pointer gap-2">
            <FolderPlus className="h-4 w-4 text-warning" />
            <span>{t("library.cmd_new_project", "New Project")}</span>
          </CommandItem>

          <CommandItem
            onSelect={() => {
              toggleWorkbench();
              handleOpenChange(false);
            }}
            className="cursor-pointer gap-2"
          >
            <PanelRight className="h-4 w-4 text-primary" />
            <span>{t("library.cmd_toggle_workbench", "Toggle Workbench")}</span>
          </CommandItem>

          {(["files", "library", "history", "settings"] as const).map((panel) => (
            <CommandItem
              key={panel}
              onSelect={() => {
                openRailPanel(panel);
                handleOpenChange(false);
              }}
              className="cursor-pointer gap-2"
            >
              <PanelLeft className="h-4 w-4 text-primary" />
              <span>{t(`rail.${panel}` as never, panel)}</span>
            </CommandItem>
          ))}

          <CommandItem
            onSelect={() => {
              setStageCollapsed(!stageCollapsed);
              handleOpenChange(false);
            }}
            className="cursor-pointer gap-2"
          >
            <PanelRight className="h-4 w-4 text-primary" />
            <span>{t("artifact.stage", "Artifact stage")}</span>
          </CommandItem>

          <CommandItem
            onSelect={() => {
              setWorkbenchTab("research");
              handleOpenChange(false);
            }}
            className="cursor-pointer gap-2"
          >
            <Search className="h-4 w-4 text-info" />
            <span>{t("library.cmd_open_research", "Open Research Tab")}</span>
          </CommandItem>

          <CommandItem
            onSelect={() => {
              setLanguage(language === "ur" ? "en" : "ur");
              handleOpenChange(false);
            }}
            className="cursor-pointer gap-2"
          >
            <Languages className="h-4 w-4 text-purple-500" />
            <span>{t("library.cmd_switch_language", "Switch Language / RTL")}</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("skills.hub.title", "مہارتیں")}>
          {skillItems.slice(0, cleanSearch ? 12 : 6).map(({ skill, run }) => {
            const Icon = skill.icon ?? Sparkles;
            return (
              <CommandItem
                key={skill.id}
                value={`skill ${skill.id} ${skill.label}`}
                onSelect={() => {
                  handleOpenChange(false);
                  run();
                }}
                className="cursor-pointer gap-2"
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{skill.label}</span>
              </CommandItem>
            );
          })}
          <CommandItem
            value="skill manage-skills مہارتیں سنبھالیں"
            onSelect={() => {
              handleOpenChange(false);
              navigate(SKILLS_SETTINGS_PATH);
            }}
            className="cursor-pointer gap-2"
          >
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            {t("skills.manage", "مہارتیں سنبھالیں")}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
    <RecipeRunDialog recipe={recipeToRun} onClose={() => setRecipeToRun(null)} />
    </>
  );
};
