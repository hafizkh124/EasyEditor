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

interface SolvencyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskLabel: string;
  totalChunks: number;
  totalCost: number;
  availableTokens: number;
  onConfirm: () => void;
}

export const SolvencyDialog: React.FC<SolvencyDialogProps> = ({
  open,
  onOpenChange,
  taskLabel,
  totalChunks,
  totalCost,
  availableTokens,
  onConfirm,
}) => {
  const isSolvent = availableTokens >= totalCost;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Coins className="h-5 w-5 text-amber-500" />
            <span>ٹوکن کی لاگت اور رن کی تصدیق</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            یہ طویل عمل متعدد اقساط (batches) میں مکمل ہو گا۔
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 text-xs">
          <div className="p-3 rounded-lg border border-border bg-card space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground flex items-center gap-1">
                <Layers className="h-3.5 w-3.5 text-primary" />
                ٹاسک کا نام:
              </span>
              <span className="font-semibold text-foreground">{taskLabel}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">کل اقساط (Batches):</span>
              <span className="font-medium">{totalChunks} چنکس</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">مطلوبہ ٹوکن لاگت:</span>
              <span className="font-bold text-amber-700 dark:text-amber-400">{totalCost} ٹوکنز</span>
            </div>
            <div className="flex justify-between items-center border-t border-border/50 pt-1.5">
              <span className="text-muted-foreground">دستیاب ٹوکن بیلنس:</span>
              <span className="font-medium">{availableTokens} ٹوکنز</span>
            </div>
          </div>

          {!isSolvent && (
            <div className="p-2.5 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-[11px] flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>آپ کے پاس مطلوبہ ٹوکنز موجود نہیں ہیں۔ براہِ کرم پلان اپگریڈ کریں۔</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            منسوخ
          </Button>
          <Button
            size="sm"
            disabled={!isSolvent}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            موافقت و جاری رکھیں
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
