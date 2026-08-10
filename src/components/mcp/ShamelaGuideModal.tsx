import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HardDrive, ExternalLink, ShieldCheck } from "lucide-react";

interface ShamelaGuideModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShamelaGuideModal({ open, onOpenChange }: ShamelaGuideModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <HardDrive className="h-5 w-5 text-primary" />
            ایزی ایڈیٹر کو مکتبہ شاملہ (4) سے جوڑنے کی مکمل رہنمائی
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            اپنے کمپیوٹر پر موجود مکتبہ شاملہ 4 کی ۴۰,۰۰۰ کتب کو ایزی ایڈیٹر کے ساتھ منسلک کرنے کا آسان اور سٹیپ بائے سٹیپ طریقہ
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 text-sm">
          {/* Step 1 */}
          <div className="space-y-2 rounded-lg border border-border p-4 bg-muted/60">
            <div className="flex items-center gap-2 font-bold text-primary text-base">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
                ۱
              </span>
              مرحلہ ۱: مکتبہ شاملہ (4) کی کمپیوٹر میں موجودگی
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              آپ کے کمپیوٹر میں مکتبہ شاملہ (Shamela 4) کا انسٹال ہونا اور اس میں کتب ڈاؤن لوڈ ہونا لازمی ہے۔ اگر آپ کے پاس مکتبہ شاملہ پہلے سے انسٹال نہیں ہے تو اس کی آفیشل ویب سائٹ سے ڈاؤن لوڈ کریں۔
            </p>
            <div className="pt-1">
              <a
                href="https://shamela.ws"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                مکتبہ شاملہ کی آفیشل ویب سائٹ (shamela.ws) پر جائیں
              </a>
            </div>
          </div>

          {/* Step 2 */}
          <div className="space-y-2 rounded-lg border border-border p-4 bg-muted/60">
            <div className="flex items-center gap-2 font-bold text-primary text-base">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
                ۲
              </span>
              سیٹنگز میں "شاملہ سے منسلک ہوں" بٹن دبائیں
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              ڈیسک ٹاپ ایپلیکیشن خود بخود آپ کے کمپیوٹر پر شاملہ 4 کی موجودگی کو ڈیٹیکٹ کرے گی۔ سیٹنگز میں جائیں اور <strong>"شاملہ سے منسلک ہوں"</strong> بٹن دبائیں۔ ایپ خودکار طور پر شاملہ کے Lucene انڈیکس اور SQLite کیٹلاگ کو دریافت کر لے گی۔
            </p>
          </div>

          {/* Step 3 */}
          <div className="space-y-2 rounded-lg border border-border p-4 bg-muted/60">
            <div className="flex items-center gap-2 font-bold text-primary text-base">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
                ۳
              </span>
              تشخیصی چیک لسٹ کا جائزہ لیں
            </div>
            <p className="text-xs text-memory-foreground leading-relaxed">
              کنکشن کے بعد تشخیصی چیک لسٹ ظاہر ہوگی جس میں Java Runtime، Lucene JARs، master.db اور Store Index کی موجودگی چیک کی جائے گی۔ تمام اشیاء سبز ہونی چاہئیں۔
            </p>
          </div>

          {/* Step 4 */}
          <div className="space-y-2 rounded-lg border border-border p-4 bg-muted/60">
            <div className="flex items-center gap-2 font-bold text-primary text-base">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
                ۴
              </span>
              کتب کو براؤز اور امپورٹ کریں
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              منسلک ہونے کے بعد آپ شاملہ ۴ کی ۴۰,۰۰۰+ کتب کو زمرہ جات کے لحاظ سے براؤز کر سکتے ہیں یا کسی مخصوص کتاب / مصنف کو تلاش کر سکتے ہیں۔ مطلوبہ کتابوں کو منتخب کریں اور "امپورٹ" بٹن دبائیں۔
            </p>
          </div>

          {/* Security */}
          <div className="rounded-lg border border-border p-4 space-y-2 bg-emerald-500/5">
            <div className="flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-300 text-xs">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              سیکیورٹی اور پرائیویسی کی ضمانت
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              تمام آپریشنز مکمل طور پر آف لائن اور آپ کی ڈیوائس پر ہی انجام پاتے ہیں۔ کسی بھی قسم کا ڈیٹا انٹرنیٹ پر منتقل نہیں ہوتا۔
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
