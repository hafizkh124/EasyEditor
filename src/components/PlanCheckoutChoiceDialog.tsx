import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CreditCard, Building2, Zap, Clock, Loader2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planName: string;
  cardPrice: string;
  manualPrice: string;
  cardEnabled: boolean;
  cardLoading?: boolean;
  onPayByCard: () => void;
  onManual: () => void;
}

export default function PlanCheckoutChoiceDialog({
  open,
  onOpenChange,
  planName,
  cardPrice,
  manualPrice,
  cardEnabled,
  cardLoading,
  onPayByCard,
  onManual,
}: Props) {
  const { language, direction } = useLanguage();
  const ur = language === "ur";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" dir={direction}>
        <DialogHeader>
          <DialogTitle>
            {ur ? "ادائیگی کا طریقہ منتخب کریں" : "Choose payment method"} — {planName}
          </DialogTitle>
          <DialogDescription>
            {ur
              ? "کارڈ سے ادائیگی فوری اکاؤنٹ فعال کرتی ہے، جبکہ مینول ٹرانسفر میں 1–2 دن لگتے ہیں۔"
              : "Card payments activate your account instantly. Manual bank transfers take 1–2 days."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Pay by card */}
          {cardEnabled && (
            <button
              type="button"
              disabled={cardLoading}
              onClick={onPayByCard}
              className="w-full text-start rounded-xl border-2 border-primary/40 bg-primary/5 hover:border-primary hover:bg-primary/10 transition-colors p-4 disabled:opacity-60"
            >
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/15 p-2.5">
                  {cardLoading
                    ? <Loader2 className="h-5 w-5 text-primary animate-spin" />
                    : <CreditCard className="h-5 w-5 text-primary" />}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-foreground">
                      {ur ? "کارڈ سے ادائیگی" : "Pay by card"}
                    </div>
                    <div className="font-bold text-primary">{cardPrice}</div>
                  </div>
                  <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                    <Zap className="h-3 w-3" />
                    {ur ? "فوری اکاؤنٹ فعال" : "Instant activation"}
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {ur
                      ? "Visa, Mastercard، اور دیگر بین الاقوامی کارڈز — محفوظ Paddle چیک‌آؤٹ"
                      : "Visa, Mastercard & international cards via secure Paddle checkout"}
                  </p>
                </div>
              </div>
            </button>
          )}

          {/* Manual bank transfer */}
          <button
            type="button"
            onClick={onManual}
            className="w-full text-start rounded-xl border border-border bg-card hover:border-foreground/30 hover:bg-accent/40 transition-colors p-4"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-muted p-2.5">
                <Building2 className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-foreground">
                    {ur ? "مینول بینک ٹرانسفر" : "Manual bank transfer"}
                  </div>
                  <div className="font-bold text-foreground">{manualPrice}</div>
                </div>
                <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                  <Clock className="h-3 w-3" />
                  {ur ? "ایکٹیویشن میں 1–2 دن" : "1–2 days to activate"}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {ur
                    ? "JazzCash، EasyPaisa، یا بینک ٹرانسفر — منظوری کے بعد فعال"
                    : "JazzCash, EasyPaisa, or bank transfer — activated after admin approval"}
                </p>
              </div>
            </div>
          </button>

          <Button variant="ghost" className="w-full" onClick={() => onOpenChange(false)}>
            {ur ? "منسوخ کریں" : "Cancel"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
