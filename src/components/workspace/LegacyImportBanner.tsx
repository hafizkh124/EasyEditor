import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, PackageOpen } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { isCapabilityAvailable } from "@/core/capabilities/registry";
import { countPendingLegacyData, migrateLegacyWorkspaces } from "@/core/workspace/legacyMigration";

/**
 * Offers to import Book Studio / Translation Projects data into the workspace.
 *
 * Those two surfaces predate the three-pillar workspace and are no longer
 * reachable from any menu, so a user with data in them currently has no way to
 * open it. This is that way: it appears only when there is something to move,
 * and disappears for good once the move is done.
 *
 * Deliberately an explicit action rather than something that runs on load —
 * it writes to the user's projects, and that should be a choice they make.
 */
export const LegacyImportBanner = () => {
  const { t } = useLanguage();
  const [pending, setPending] = useState<{ books: number; translations: number } | null>(null);
  const [running, setRunning] = useState(false);

  // Both legacy surfaces are hosted-only; a desktop build has nothing to move.
  const relevant = isCapabilityAvailable("book-workspace") || isCapabilityAvailable("translate-workspace");

  useEffect(() => {
    if (!relevant) return;
    let cancelled = false;
    countPendingLegacyData()
      .then((counts) => { if (!cancelled) setPending(counts); })
      // A failed count is not worth a message: the banner simply stays hidden,
      // and the legacy rows are still there to find next time.
      .catch(() => { if (!cancelled) setPending(null); });
    return () => { cancelled = true; };
  }, [relevant]);

  const total = (pending?.books ?? 0) + (pending?.translations ?? 0);
  if (!relevant || total === 0) return null;

  const runImport = async () => {
    setRunning(true);
    try {
      const summary = await migrateLegacyWorkspaces();
      const moved = summary.bookProjects + summary.translationProjects;

      if (summary.failures.length > 0) {
        toast.error(
          t("library.legacy_import_partial", "Imported {done}, {failed} could not be read.")
            .replace("{done}", String(moved))
            .replace("{failed}", String(summary.failures.length)),
        );
      } else {
        toast.success(
          t("library.legacy_import_done", "Imported {count} project(s).").replace("{count}", String(moved)),
        );
      }

      setPending(await countPendingLegacyData());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("library.legacy_import_failed", "Import failed."));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="m-2 rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <PackageOpen className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium text-foreground">
            {t("library.legacy_import_title", "Older projects found")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("library.legacy_import_desc", "{count} project(s) from the older Book Studio and Translation Projects can be imported into your workspace.")
              .replace("{count}", String(total))}
          </p>
        </div>
      </div>
      <Button size="sm" className="w-full h-8 text-xs gap-1.5" disabled={running} onClick={runImport}>
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackageOpen className="h-3.5 w-3.5" />}
        {running
          ? t("library.legacy_import_running", "Importing…")
          : t("library.legacy_import_action", "Import into workspace")}
      </Button>
    </div>
  );
};

export default LegacyImportBanner;
