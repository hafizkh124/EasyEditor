import React from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { isDesktop } from "@/core/backend";
import { useShamelaAvailability } from "@/hooks/useShamelaAvailability";
import { useJkhssnAvailability } from "@/hooks/useJkhssnAvailability";
import { cn } from "@/lib/utils";

/**
 * Plan §3.2 — the workspace's bottom status bar. The original milestone spec
 * asked for it and it does not exist today: connector state is buried in
 * Settings, and the live word count is only a local variable in WorkspaceLayout.
 *
 * Two clusters: local corpora on the `start` edge (green = connected, amber =
 * stale, grey = installable), the open document on the `end` edge (word count,
 * font, direction, save state). Hidden on mobile — the bottom sheet bar owns
 * that space there.
 */

type DotState = "on" | "stale" | "off";

const DOT_CLS: Record<DotState, string> = {
  on: "bg-emerald-500",
  stale: "bg-amber-500",
  off: "bg-muted-foreground/40",
};

const Connector: React.FC<{ label: string; state: DotState; onClick?: () => void; connectHint?: string }> = ({
  label,
  state,
  onClick,
  connectHint,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={!onClick}
    title={state === "off" && connectHint ? connectHint : label}
    className={cn(
      "flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs transition-colors",
      onClick ? "hover:bg-accent hover:text-accent-foreground" : "cursor-default",
    )}
  >
    <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", DOT_CLS[state])} />
    <span className="truncate max-w-[10rem]">{label}</span>
    {state === "off" && connectHint && <span className="text-primary">· {connectHint}</span>}
  </button>
);

export interface WorkspaceStatusBarProps {
  wordCount?: number | null;
  fontLabel?: string | null;
  direction?: "rtl" | "ltr" | null;
  saveStatus?: "idle" | "saving" | "saved" | "error" | null;
}

export const WorkspaceStatusBar: React.FC<WorkspaceStatusBarProps> = ({
  wordCount,
  fontLabel,
  direction,
  saveStatus,
}) => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const desktop = isDesktop();
  const shamela = useShamelaAvailability();
  const jkhssn = useJkhssnAvailability();

  const openConnectors = () => navigate("/settings#connectors");

  const saveText =
    saveStatus === "saving"
      ? t("workspace.save_saving", "محفوظ ہو رہا ہے…")
      : saveStatus === "error"
        ? t("workspace.save_error", "محفوظ نہیں ہوا")
        : saveStatus === "saved"
          ? t("workspace.save_saved", "محفوظ")
          : null;

  return (
    <div className="hidden md:flex h-7 shrink-0 items-center justify-between gap-3 border-t border-border bg-muted px-2 text-xs text-muted-foreground select-none">
      <div className="flex items-center gap-1 min-w-0">
        {desktop && (
          <>
            <Connector
              label={t("connectors.shamela.label", "مکتبہ شاملہ")}
              state={shamela.available ? "on" : "off"}
              onClick={openConnectors}
              connectHint={shamela.available ? undefined : t("workspace.connect", "جوڑیں")}
            />
            <Connector
              label={t("jkhssn.title", "جوامع الكلم")}
              state={jkhssn.available ? "on" : jkhssn.indexStale ? "stale" : "off"}
              onClick={openConnectors}
              connectHint={jkhssn.available ? undefined : t("workspace.connect", "جوڑیں")}
            />
          </>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0 tabular-nums">
        {saveText && <span>{saveText}</span>}
        {typeof wordCount === "number" && (
          <span>{t("workspace.word_count", "الفاظ {n}").replace("{n}", wordCount.toLocaleString())}</span>
        )}
        {fontLabel && <span className="max-w-[8rem] truncate">{fontLabel}</span>}
        {direction && <span className="uppercase">{direction}</span>}
      </div>
    </div>
  );
};
