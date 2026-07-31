import { useState } from "react";
import { ShamelaConnectPanel } from "@/components/shamela/ShamelaConnectPanel";
import { ShamelaImportDialog } from "@/components/shamela/ShamelaImportDialog";

export function LocalShamelaConnector() {
  const [importOpen, setImportOpen] = useState(false);
  const [importTab, setImportTab] = useState<"browse" | "search">("browse");
  // Taken from the connect panel's own detection rather than a second lookup,
  // so the browser can only open against a library that just verified.
  const [masterDbPath, setMasterDbPath] = useState<string | null>(null);

  return (
    <>
      <ShamelaConnectPanel
        onBrowseBooks={(path, tab) => {
          setMasterDbPath(path);
          setImportTab(tab);
          setImportOpen(true);
        }}
      />

      {masterDbPath && (
        <ShamelaImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          masterDbPath={masterDbPath}
          initialTab={importTab}
        />
      )}
    </>
  );
}
