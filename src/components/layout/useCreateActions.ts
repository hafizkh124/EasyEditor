import { useNavigate } from "react-router-dom";
import { FilePlus2, MessageSquarePlus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { availableCapabilities } from "@/core/capabilities/registry";

/**
 * The "+" create menu's items (SYSTEM-2026 §2): the app's three core jobs
 * first — audio to text, image/PDF to text, book translation — then a new
 * chat and a new document.
 *
 * The jobs come from the `create-menu` capability surface, so a tool that
 * cannot run on this runtime is absent here exactly as it is everywhere else.
 */

export type CreateActionGroup = "job" | "new";

export interface CreateAction {
  id: string;
  icon: LucideIcon;
  label: string;
  group: CreateActionGroup;
  run: () => void;
}

export function useCreateActions(): CreateAction[] {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const jobs: CreateAction[] = availableCapabilities("create-menu").map((capability) => ({
    id: capability.id,
    icon: capability.icon,
    label: t(capability.createLabelKey ?? capability.labelKey, capability.createFallbackLabel ?? capability.fallbackLabel),
    group: "job",
    run: () => navigate(capability.route!),
  }));

  return [
    ...jobs,
    {
      id: "new-chat",
      icon: MessageSquarePlus,
      label: t("create.new_chat", "نئی چیٹ"),
      group: "new",
      run: () => navigate("/workspace?panel=research"),
    },
    {
      id: "new-document",
      icon: FilePlus2,
      label: t("create.new_document", "نیا دستاویز"),
      group: "new",
      run: () => navigate("/workspace", { state: { intent: "new-document" } }),
    },
  ];
}
