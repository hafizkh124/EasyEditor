import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanZoom } from "./PanZoom";
import { ArtifactBody } from "./ArtifactBody";
import type { ArtifactState } from "../agentArtifactState";

/** Plan §5.4 — a full-viewport view of one artifact, pan/zoom for big trees. */
export const ArtifactFullscreen: React.FC<{
  artifact: ArtifactState | null;
  onClose: () => void;
}> = ({ artifact, onClose }) => (
  <Dialog open={Boolean(artifact)} onOpenChange={(o) => { if (!o) onClose(); }}>
    <DialogContent className="h-[92vh] max-w-[96vw] p-0 gap-0">
      {artifact && (
        <>
          <DialogHeader className="border-b border-border px-4 py-2">
            <DialogTitle className="text-sm">{artifact.title}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            <PanZoom>
              <div className="p-4">
                <ArtifactBody artifact={artifact} />
              </div>
            </PanZoom>
          </div>
        </>
      )}
    </DialogContent>
  </Dialog>
);
