import type { RefObject } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Crown, Loader2 } from "lucide-react";
import type { Translator, TranslationKey } from "@/lib/i18n";
import { PaymentAccountsPanel } from "./PaymentAccountsPanel";
import type { PricingPlan } from "./PlanCard";

interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: PricingPlan;
  direction: "ltr" | "rtl";
  language: string;
  t: Translator;

  txId: string;
  onTxIdChange: (value: string) => void;
  receiptFile: File | null;
  onReceiptChange: (file: File | null) => void;
  fileInputRef: RefObject<HTMLInputElement>;

  submitting: boolean;
  onSubmit: () => void;
}

/**
 * Manual payment capture: the user transfers to one of the accounts, then hands
 * back a reference number and a receipt image for verification.
 */
export const UpgradeDialog = ({
  open, onOpenChange, plan, direction, language, t,
  txId, onTxIdChange, receiptFile, onReceiptChange, fileInputRef,
  submitting, onSubmit,
}: UpgradeDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-md" dir={direction}>
      <DialogHeader>
        <DialogTitle>
          {t("pricing.payment_dialog_title")} — {t(plan.nameKey as TranslationKey)}
        </DialogTitle>
        <DialogDescription>{t("pricing.payment_dialog_desc")}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2">
        <PaymentAccountsPanel t={t} />

        <p className="text-sm font-semibold text-primary">
          {t(plan.priceAmountKey as TranslationKey)}
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="txId">{t("pricing.transaction_id_label")}</Label>
          <Input
            id="txId"
            placeholder={t("pricing.transaction_id_placeholder")}
            value={txId}
            onChange={(e) => onTxIdChange(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="receipt">
            {t("pricing.receipt_label", language === "ur"
              ? "Receipt کی تصویر (JPG/PNG, ≤5MB)"
              : "Receipt image (JPG/PNG, ≤5MB)")}
          </Label>
          <Input
            id="receipt"
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            onChange={(e) => onReceiptChange(e.target.files?.[0] ?? null)}
          />
          {receiptFile && (
            <p className="text-xs text-muted-foreground">
              {receiptFile.name} · {(receiptFile.size / 1024).toFixed(0)} KB
            </p>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {t("pricing.verification_note", language === "ur"
            ? "ہمارا سسٹم آپ کی receipt کی تصدیق کرے گا۔ صحیح ہونے پر اکاؤنٹ فوری فعال ہو جائے گا، ورنہ ہماری ٹیم اسے manually review کرے گی۔"
            : "Our system verifies your receipt. If valid, your account activates instantly — otherwise our team will review it manually.")}
        </p>

        <Button
          onClick={onSubmit}
          disabled={submitting || !txId.trim() || !receiptFile}
          className="w-full"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin me-2" /> : <Crown className="h-4 w-4 me-2" />}
          {t("pricing.verify_activate", language === "ur" ? "تصدیق کے لیے بھیجیں" : "Verify & activate")}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
);
