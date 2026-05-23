import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAdminPayments } from "@/hooks/useAdminPayments";
import type { UserRow } from "./types";

interface RecordPaymentDialogProps {
  user: UserRow | null;
  onClose: () => void;
}

const RecordPaymentDialog = ({ user, onClose }: RecordPaymentDialogProps) => {
  const { t } = useLanguage();
  const { recordPayment, saving } = useAdminPayments();

  const [amount, setAmount] = useState("");
  const [paymentType, setPaymentType] = useState("subscription");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [reference, setReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");

  const reset = () => {
    setAmount("");
    setPaymentType("subscription");
    setPaymentMethod("");
    setReference("");
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setNotes("");
  };

  const handleSave = async () => {
    if (!user || !amount || Number(amount) <= 0) return;

    const success = await recordPayment({
      user_id: user.user_id,
      amount_pkr: Number(amount),
      payment_type: paymentType,
      payment_method: paymentMethod || undefined,
      payment_reference: reference || undefined,
      tier_at_payment: user.tier,
      notes: notes || undefined,
      payment_date: paymentDate,
    });

    if (success) {
      reset();
      onClose();
    }
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Dialog open={!!user} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("admin.record_payment_title")}</DialogTitle>
          <DialogDescription>
            {t("admin.record_payment_desc")}
            {user && (
              <span className="block mt-1 font-medium text-foreground">
                {user.display_name || t("admin.unnamed")}
                {user.email && <span className="text-muted-foreground"> ({user.email})</span>}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-sm">{t("admin.amount_pkr")} *</Label>
            <Input
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-sm">{t("admin.payment_type")}</Label>
              <Select value={paymentType} onValueChange={setPaymentType}>
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="subscription">{t("admin.payment_type_subscription")}</SelectItem>
                  <SelectItem value="renewal">{t("admin.payment_type_renewal")}</SelectItem>
                  <SelectItem value="upgrade">{t("admin.payment_type_upgrade")}</SelectItem>
                  <SelectItem value="topup">{t("admin.payment_type_topup")}</SelectItem>
                  <SelectItem value="other">{t("admin.payment_type_other")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-sm">{t("admin.payment_method")}</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer">{t("admin.payment_method_bank")}</SelectItem>
                  <SelectItem value="jazzcash">{t("admin.payment_method_jazzcash")}</SelectItem>
                  <SelectItem value="easypaisa">{t("admin.payment_method_easypaisa")}</SelectItem>
                  <SelectItem value="cash">{t("admin.payment_method_cash")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-sm">{t("admin.payment_ref")}</Label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="TXN..."
              />
            </div>

            <div className="space-y-1">
              <Label className="text-sm">{t("admin.payment_date")}</Label>
              <Input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-sm">{t("admin.payment_notes")}</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={saving}>
            {t("admin.cancel") || "Cancel"}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !amount || Number(amount) <= 0}
          >
            {saving && <Loader2 className="h-4 w-4 me-1 animate-spin" />}
            {t("admin.record_payment")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RecordPaymentDialog;
