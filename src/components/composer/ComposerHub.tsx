import React from "react";
import { Paperclip, FolderOpen, ScrollText, Hash, Plug, Mic, Pencil } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { isConnectorOn, connectorsByCategory } from "~shared/agent/connectors";

/**
 * M11 Phase 3 — unified `+` hub for both agent and research composers.
 * Both branches embed this component; the capability-gated sections
 * (Sources, Skills, Connectors, Prompts, Assist Modes) are shown/hidden
 * via props.
 *
 * Extracted from AgentComposer.tsx lines 121-172 to avoid duplication
 * between the agent and research hub (ADR-0047).
 */
export interface ComposerHubProps {
  /** Whether to show the "Add files" row. */
  showSources?: boolean;
  /** Whether to show the "Skills (/)" row. */
  showSkills?: boolean;
  /** Whether to show the connector toggles. */
  showConnectors?: boolean;
  /** Whether to show the "Prompts" row. */
  showPrompts?: boolean;
  /** Whether to show the "Assist modes" row. */
  showAssistModes?: boolean;

  /** Agent connector state (global + project merged). */
  connectors?: Record<string, boolean>;
  /** Global connector state (from Settings). */
  connectorGlobal?: Record<string, boolean>;
  /** Per-project connector overrides. */
  connectorState?: Record<string, boolean>;
  /** Toggle a connector. */
  onToggleConnector?: (id: string, on: boolean) => void;

  /** Open file picker. */
  onAddFiles?: () => void;
  /** Open folder picker. */
  onChangeFolder?: () => void;
  /** Insert "/" to trigger playbook picker. */
  onOpenPlaybooks?: () => void;
  /** Insert "#" to trigger scope picker. */
  onOpenScope?: () => void;
  /** Open custom prompts. */
  onOpenPrompts?: () => void;
  /** Open assist mode selector. */
  onOpenAssistModes?: () => void;

  /** Close the hub. */
  onClose?: () => void;
}

export const ComposerHub: React.FC<ComposerHubProps> = ({
  showSources = true,
  showSkills = true,
  showConnectors = true,
  showPrompts = false,
  showAssistModes = false,
  connectors = {},
  connectorGlobal,
  connectorState,
  onToggleConnector,
  onAddFiles,
  onChangeFolder,
  onOpenPlaybooks,
  onOpenScope,
  onOpenPrompts,
  onOpenAssistModes,
  onClose,
}) => {
  const { t } = useLanguage();

  const handleAction = (fn?: () => void) => {
    return () => {
      onClose?.();
      fn?.();
    };
  };

  return (
    <div className="p-1 text-xs">
      {/* Sources & Files */}
      {showSources && (
        <>
          {onAddFiles && (
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start hover:bg-muted" onClick={handleAction(onAddFiles)}>
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {t("agent.hub_add_files", "Add recordings, scans, fonts…")}
            </button>
          )}
          {onChangeFolder && (
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start hover:bg-muted" onClick={handleAction(onChangeFolder)}>
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {t("agent.hub_change_folder", "Change project folder")}
            </button>
          )}
        </>
      )}

      {/* Skills (/) */}
      {showSkills && onOpenPlaybooks && (
        <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start hover:bg-muted" onClick={handleAction(onOpenPlaybooks)}>
          <ScrollText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {t("agent.hub_playbooks", "Playbooks  (/)")}
        </button>
      )}

      {/* Books & Sources (#) */}
      {showSources && onOpenScope && (
        <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start hover:bg-muted" onClick={handleAction(onOpenScope)}>
          <Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {t("agent.hub_scope", "Books & sources  (#)")}
        </button>
      )}

      {/* Prompts */}
      {showPrompts && onOpenPrompts && (
        <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start hover:bg-muted" onClick={handleAction(onOpenPrompts)}>
          <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {"Custom prompts"}
        </button>
      )}

      {/* Assist Modes */}
      {showAssistModes && onOpenAssistModes && (
        <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start hover:bg-muted" onClick={handleAction(onOpenAssistModes)}>
          <Mic className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {"Assist modes"}
        </button>
      )}

      {/* Connectors */}
      {showConnectors && (
        <>
          <div className="my-1 border-t border-border" />
          <p className="flex items-center gap-1.5 px-2 pb-1 pt-0.5 text-muted-foreground">
            <Plug className="h-3.5 w-3.5 shrink-0" />
            {t("agent.hub_connectors", "Source connectors")}
          </p>
          {connectorsByCategory().map((group) => (
            <div key={group.category}>
              <p className="px-2 pt-1 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground/70">
                {t(`connectors.category.${group.category}` as import("@/lib/i18n").TranslationKey)}
              </p>
              {group.connectors.map((c) => {
                const globallyOn = connectorGlobal?.[c.id] ?? !c.defaultOff;
                const on = connectorState?.[c.id] ?? isConnectorOn(connectors, c.id);
                return (
                  <label
                    key={c.id}
                    className={`flex items-center justify-between rounded px-2 py-1 ${globallyOn ? "cursor-pointer hover:bg-muted" : "cursor-not-allowed opacity-60"}`}
                    title={globallyOn ? undefined : t("connectors.enable_in_settings")}
                  >
                    <span>{c.label}</span>
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={on && globallyOn}
                      disabled={!globallyOn}
                      onChange={(e) => onToggleConnector?.(c.id, e.target.checked)}
                    />
                  </label>
                );
              })}
            </div>
          ))}
        </>
      )}
    </div>
  );
};
