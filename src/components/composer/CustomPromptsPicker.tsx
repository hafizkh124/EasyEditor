import React, { useEffect, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { customPromptService, type CustomPromptRow } from "@/lib/tasks/customPrompts";

export interface CustomPromptsPickerProps {
  /** Insert this prompt's instruction text into the composer, then close. */
  onInsert: (text: string) => void;
  onClose: () => void;
}

/**
 * M11 Phase 3 / M12 Phase H — the `+` hub's "Prompts" row (ADR-0047).
 *
 * `customPromptService` is a facade over the same `ai_tasks` rows the
 * editor's Task Library (TasksTab.tsx) authors — see the doc comment on
 * src/lib/tasks/customPrompts.ts. Rather than fork a second authoring UI,
 * this just lists what the user already wrote there and inserts the
 * instruction text into the agent composer at a click; "New prompt" is a
 * pointer to Settings → Task Library, the one place that writes these rows.
 */
export const CustomPromptsPicker: React.FC<CustomPromptsPickerProps> = ({ onInsert, onClose }) => {
  const { t } = useLanguage();
  const [rows, setRows] = useState<CustomPromptRow[] | null>(null);

  useEffect(() => {
    let live = true;
    customPromptService.list()
      .then((r) => { if (live) setRows(r); })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, []);

  return (
    <div className="p-1 text-xs" role="menu" aria-label={t("agent.hub_prompts", "Custom prompts")}>
      {rows === null ? (
        <div className="flex items-center justify-center gap-1.5 px-2 py-3 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("common.loading", "Loading…")}
        </div>
      ) : rows.length === 0 ? (
        <p className="px-2 py-2 text-muted-foreground">
          {t("agent.hub_prompts_empty", "No custom prompts yet — author one in Settings → Task Library.")}
        </p>
      ) : (
        rows.map((row) => (
          <button
            key={row.id}
            role="menuitem"
            className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-start hover:bg-muted"
            onClick={() => { onInsert(row.system_prompt); onClose(); }}
          >
            <span className="flex items-center gap-1.5 font-medium">
              <Pencil className="h-3 w-3 shrink-0 text-muted-foreground" />
              {row.label}
            </span>
            <span className="line-clamp-2 text-muted-foreground">{row.system_prompt}</span>
          </button>
        ))
      )}
    </div>
  );
};
