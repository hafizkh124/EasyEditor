import React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ProjectKind } from "@/core/workspace/types";

interface LibraryNewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onTitleChange: (title: string) => void;
  kind: ProjectKind;
  onKindChange: (kind: ProjectKind) => void;
  creating: boolean;
  onCreate: () => void;
}

export const LibraryNewProjectDialog: React.FC<LibraryNewProjectDialogProps> = ({
  open, onOpenChange, title, onTitleChange, kind, onKindChange, creating, onCreate,
}) => {
  const { t } = useLanguage();
  return (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{t("library.create_new_project", "Create New Project")}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="space-y-2">
          <Label htmlFor="lib-proj-title">{t("library.project_title", "Project Title")}</Label>
          <Input
            id="lib-proj-title"
            placeholder={t("library.project_title_placeholder", "e.g. Usul al-Fiqh Research")}
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lib-proj-kind">{t("library.project_kind", "Project Kind")}</Label>
          <Select value={kind} onValueChange={(v) => onKindChange(v as ProjectKind)}>
            <SelectTrigger id="lib-proj-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="general">{t("library.kind_general", "General Workspace")}</SelectItem>
              <SelectItem value="research">{t("library.kind_research", "Research & Fatawa")}</SelectItem>
              <SelectItem value="book">{t("library.kind_book", "Book Composition")}</SelectItem>
              <SelectItem value="translation">{t("library.kind_translation", "Translation")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel", "Cancel")}</Button>
        <Button onClick={onCreate} disabled={creating || !title.trim()}>
          {creating ? t("common.creating", "Creating...") : t("library.create_project", "Create Project")}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  );
};
