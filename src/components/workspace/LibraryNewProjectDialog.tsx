import React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Create New Project</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="space-y-2">
          <Label htmlFor="lib-proj-title">Project Title</Label>
          <Input
            id="lib-proj-title"
            placeholder="e.g. Usul al-Fiqh Research"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lib-proj-kind">Project Kind</Label>
          <Select value={kind} onValueChange={(v) => onKindChange(v as ProjectKind)}>
            <SelectTrigger id="lib-proj-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="general">General Workspace</SelectItem>
              <SelectItem value="research">Research &amp; Fatawa</SelectItem>
              <SelectItem value="book">Book Composition</SelectItem>
              <SelectItem value="translation">Translation</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={onCreate} disabled={creating || !title.trim()}>
          {creating ? "Creating..." : "Create Project"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
