import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Globe, ExternalLink, ShieldCheck } from "lucide-react";

interface ShamelaBridgeGuideModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Web counterpart to `ShamelaGuideModal.tsx`. That guide assumes the desktop
 * app's own auto-detection; this one walks through the one extra step web
 * needs — running `tools/shamela-bridge` locally — since there is no main
 * process on web to do that detection for the user.
 */
export function ShamelaBridgeGuideModal({ open, onOpenChange }: ShamelaBridgeGuideModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Globe className="h-5 w-5 text-primary" />
            ویب براؤزر کو مکتبہ شاملہ (4) سے جوڑنے کی رہنمائی
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            براؤزر میں اپنے کمپیوٹر کی شاملہ لائبریری استعمال کرنے کے لیے ایک چھوٹا سا مقامی پروگرام ("Local Bridge") چلانا ہوتا ہے — یہ صرف آپ کے اپنے کمپیوٹر پر چلتا ہے۔
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 text-sm">
          <div className="space-y-2 rounded-lg border border-border p-4 bg-muted/60">
            <div className="flex items-center gap-2 font-bold text-primary text-base">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">۱</span>
              مرحلہ ۱: Node.js انسٹال کریں (ایک بار)
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              اگر آپ کے کمپیوٹر پر Node.js پہلے سے موجود نہیں ہے تو اس کی آفیشل ویب سائٹ سے "LTS" ورژن ڈاؤن لوڈ کر کے انسٹال کریں۔
            </p>
            <div className="pt-1">
              <a
                href="https://nodejs.org/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Node.js ڈاؤن لوڈ کریں (nodejs.org)
              </a>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-border p-4 bg-muted/60">
            <div className="flex items-center gap-2 font-bold text-primary text-base">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">۲</span>
              مرحلہ ۲: Bridge چلائیں
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              پروجیکٹ کے <code className="px-1 py-0.5 rounded bg-background border border-border text-xs ltr">tools/shamela-bridge</code> فولڈر میں جا کر <code className="px-1 py-0.5 rounded bg-background border border-border text-xs ltr">start-bridge.bat</code> (ونڈوز) یا <code className="px-1 py-0.5 rounded bg-background border border-border text-xs ltr">start-bridge.sh</code> (Mac/Linux) پر ڈبل کلک کریں۔ ایک ٹرمینل ونڈو کھلے گی — اسے کھلا رہنے دیں، یہی مقامی Bridge سرور ہے۔
            </p>
          </div>

          <div className="space-y-2 rounded-lg border border-border p-4 bg-muted/60">
            <div className="flex items-center gap-2 font-bold text-primary text-base">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">۳</span>
              مرحلہ ۳: Settings میں "کنکشن جانچیں" دبائیں
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Bridge چلتے ہی، Settings کے "Shamela 4 — Local Bridge" کارڈ میں "کنکشن جانچیں" بٹن دبائیں۔ پہلی بار کنیکٹ ہونے پر ایپ خودکار طور پر ایک محفوظ رابطہ (pairing) قائم کر لے گی — دوبارہ کچھ کرنے کی ضرورت نہیں۔
            </p>
          </div>

          <div className="space-y-2 rounded-lg border border-border p-4 bg-muted/60">
            <div className="flex items-center gap-2 font-bold text-primary text-base">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">۴</span>
              مرحلہ ۴: Library کے "Browse" ٹیب سے کتب دیکھیں
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              منسلک ہونے کے بعد Workspace کی Library میں "Browse" ٹیب سے شاملہ کی کتب دیکھی اور پڑھی جا سکتی ہیں۔ Bridge ونڈو بند کرنے پر دوبارہ سے یہ سب کام کرنے کے لیے صرف اسے دوبارہ چلانا کافی ہے۔
            </p>
          </div>

          <div className="rounded-lg border border-border p-4 space-y-2 bg-emerald-500/5">
            <div className="flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-300 text-xs">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              سیکیورٹی اور پرائیویسی
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Bridge صرف آپ کے اپنے کمپیوٹر (127.0.0.1) پر سنتا ہے — انٹرنیٹ پر کہیں دستیاب نہیں۔ پہلی کامیاب کنکشن پر ایک خفیہ کوڈ (token) خودکار طور پر بن اور محفوظ ہو جاتا ہے، تاکہ صرف آپ کا اپنا براؤزر ہی اس سے بات کر سکے — کوئی اور مقامی پروگرام نہیں۔ کسی بھی وقت رابطہ دوبارہ قائم کرنا ہو تو <code className="px-1 py-0.5 rounded bg-background border border-border text-xs ltr">tools/shamela-bridge/.bridge-token.json</code> فائل حذف کر کے Bridge دوبارہ چلائیں۔
            </p>
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t border-border">
          <Button onClick={() => onOpenChange(false)} size="sm">
            سمجھ گیا (بند کریں)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
