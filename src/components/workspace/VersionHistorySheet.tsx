import React, { useState } from "react";
import { History, BookmarkPlus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { DocumentVersion } from "@/core/workspace/types";

interface VersionHistorySheetProps {
  versions: DocumentVersion[];
  /** Sheet slides in from the reading-end of the page. */
  side: "left" | "right";
  onRestoreVersion: (contentJson: Record<string, unknown>) => void;
  onCreateSnapshot: (label?: string) => Promise<unknown>;
}

export const VersionHistorySheet: React.FC<VersionHistorySheetProps> = ({
  versions, side, onRestoreVersion, onCreateSnapshot,
}) => {
  const [open, setOpen] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState("");

  const handleCreateSnapshot = async () => {
    const snap = await onCreateSnapshot(snapshotLabel.trim() || undefined);
    if (snap) {
      toast.success("Snapshot version created");
      setSnapshotLabel("");
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 px-2 hidden sm:flex">
          <History className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">Versions</span>
          {versions.length > 0 && (
            <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-bold text-primary">
              {versions.length}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side={side} className="w-80 sm:w-96">
        <SheetHeader>
          <SheetTitle className="text-base">Document Versions</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 py-4">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Snapshot label (optional)"
              value={snapshotLabel}
              onChange={(e) => setSnapshotLabel(e.target.value)}
              className="h-8 text-xs"
            />
            <Button size="sm" onClick={handleCreateSnapshot} className="h-8 gap-1 text-xs">
              <BookmarkPlus className="h-3.5 w-3.5" />
              Save
            </Button>
          </div>

          <div className="divide-y divide-border border rounded-md max-h-[70vh] overflow-y-auto">
            {versions.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground text-center">
                No saved versions yet. Save a snapshot anytime.
              </p>
            ) : (
              versions.map((v) => (
                <div key={v.id} className="p-3 text-xs flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">{v.label || "Snapshot"}</p>
                    <p className="text-muted-foreground text-[11px]">
                      {new Date(v.created_at).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px] gap-1 shrink-0"
                    onClick={() => {
                      onRestoreVersion(v.content_json);
                      setOpen(false);
                    }}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Restore
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
