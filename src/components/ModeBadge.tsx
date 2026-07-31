import { HardDrive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { isDesktop } from "@/core/backend";

/**
 * Persistent "your work lives here" indicator (SPEC-M5 FR-2.4).
 *
 * Risk R9: the app now has two homes — a local SQLite workspace and the cloud
 * one — and nothing syncs between them by design. A user who cannot tell which
 * one they are in will eventually look for a document in the wrong place and
 * conclude it was lost. So the badge is always on screen in desktop mode
 * rather than tucked into a settings page.
 *
 * The cloud build renders nothing: for web users there is no second home to
 * distinguish it from, and a permanent "کلاؤڈ" chip would be noise.
 */
export function ModeBadge() {
  if (!isDesktop()) return null;

  return (
    <Badge
      variant="outline"
      className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px] font-medium"
      title="آپ کا کام اسی کمپیوٹر پر محفوظ ہے — کلاؤڈ پر نہیں"
    >
      <HardDrive className="h-3 w-3" />
      مقامی
    </Badge>
  );
}

export default ModeBadge;
