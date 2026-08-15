import { useState } from "react";
import { ShamelaConnectPanel } from "@/components/shamela/ShamelaConnectPanel";
import { ShamelaBridgeConnectPanel } from "@/components/shamela/ShamelaBridgeConnectPanel";
import { ShamelaImportDialog } from "@/components/shamela/ShamelaImportDialog";
import { isDesktop } from "@/core/backend";

/**
 * Desktop gets the native connector (Electron IPC, master.db import dialog).
 * Web gets the bridge connector instead — `ShamelaConnectPanel` only ever
 * checks `window.electronAPI.shamela` and errors on web, so it can't reach
 * `tools/shamela-bridge`. The bridge has no `masterDbPath`/import-dialog
 * concept (see `shamelaClient.ts`); browsing happens through the Library's
 * own Browse tab once connected, not a dialog launched from here.
 */
export function LocalShamelaConnector() {
  const [importOpen, setImportOpen] = useState(false);
  const [importTab, setImportTab] = useState<"browse" | "search">("browse");
  // Taken from the connect panel's own detection rather than a second lookup,
  // so the browser can only open against a library that just verified.
  const [masterDbPath, setMasterDbPath] = useState<string | null>(null);

  if (!isDesktop()) {
    return <ShamelaBridgeConnectPanel />;
  }

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
