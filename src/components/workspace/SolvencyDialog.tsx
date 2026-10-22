import React from "react";
import { Coins, AlertCircle, Layers } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

interface SolvencyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskLabel: string;
  totalChunks: number;
  totalCost: number;
  availableTokens: number;
  onConfirm: () => void;
  /** More lines for the summary, e.g. the time a run will take. */
  extraRows?: Array<{ label: string; value: string }>;
}

export const SolvencyDialog: React.FC<SolvencyDialogProps> = ({
  open,
  onOpenChange,
  taskLabel,
  totalChunks,
  totalCost,
  availableTokens,
  onConfirm,
  extraRows,
}) => {
  const { t } = useLanguage();
  const isSolvent = availableTokens >= totalCost;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Coins className="h-5 w-5 text-warning" />
            <span>{t("library.solvency_title", "Token cost and run confirmation")}</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("library.solvency_desc", "This long process will complete in multiple batches.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 text-xs">
          <div className="p-3 rounded-lg border border-border bg-card space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground flex items-center gap-1">
                <Layers className="h-3.5 w-3.5 text-primary" />
                {t("library.task_name_label", "Task name:")}
              </span>
              <span className="font-semibold text-foreground">{taskLabel}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">{t("library.total_batches", "Total batches:")}</span>
              <span className="font-medium">{t("library.chunks", "{count} chunks").replace("{count}", String(totalChunks))}</span>
            </div>
            {extraRows?.map((row) => (
              <div key={row.label} className="flex justify-between items-center">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-medium">{row.value}</span>
              </div>
            ))}
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">{t("library.required_cost", "Required token cost:")}</span>
              <span className="font-bold text-warning">{t("library.tokens", "{count} tokens").replace("{count}", String(totalCost))}</span>
            </div>
            <div className="flex justify-between items-center border-t border-border/50 pt-1.5">
              <span className="text-muted-foreground">{t("library.available_balance", "Available token balance:")}</span>
              <span className="font-medium">{t("library.tokens", "{count} tokens").replace("{count}", String(availableTokens))}</span>
            </div>
          </div>

          {!isSolvent && (
            <div className="p-2.5 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{t("library.solvency_insufficient", "You do not have enough tokens. Please upgrade your plan.")}</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button
            size="sm"
            disabled={!isSolvent}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {t("library.agree_continue", "Agree & continue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
