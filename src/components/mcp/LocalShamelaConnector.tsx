import { useState } from "react";
import { ShamelaConnectPanel } from "@/components/shamela/ShamelaConnectPanel";
import { ShamelaImportDialog } from "@/components/shamela/ShamelaImportDialog";
import { useLocalShamela } from "@/hooks/useLocalShamela";

export function LocalShamelaConnector() {
  const { connected, nativePath, masterDbPath } = useLocalShamela();
  const [importOpen, setImportOpen] = useState(false);

  return (
    <>
      <ShamelaConnectPanel />

      {connected && masterDbPath && (
        <div className="mt-2">
          <ShamelaImportDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            masterDbPath={masterDbPath}
          />
        </div>
      )}
    </>
  );
}
