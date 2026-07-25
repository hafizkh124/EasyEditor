import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HardDrive, Download, AlertTriangle, ExternalLink, ShieldCheck } from "lucide-react";

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
          {/* Important Browser Notice Banner */}
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3.5 flex gap-3 items-start text-xs">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold text-amber-900 dark:text-amber-300 block">
                براؤزر مطابقت کی اہم اطلاع (Browser Compatibility Notice)
              </span>
              <p className="text-muted-foreground leading-relaxed">
                مقامی شاملہ سرچ **Google Chrome, Microsoft Edge** اور **Brave** براؤزرز پر ۱۰۰٪ بہترین کام کرتی ہے۔ Safari اور Firefox کے سیکیورٹی قوانین کی وجہ سے مقامی کنکشن متاثر ہو سکتا ہے۔
              </p>
            </div>
          </div>

          {/* Step 1 */}
          <div className="space-y-2 rounded-lg border border-border p-4 bg-muted/20">
            <div className="flex items-center gap-2 font-bold text-primary text-base">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
                ۱
              </span>
              مرحلہ ۱: مکتبہ شاملہ (4) کی کمپیوٹر میں موجودگی
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              آپ کے ونڈوز کمپیوٹر میں مکتبہ شاملہ (Shamela 4) کا انسٹال ہونا اور اس میں کتب ڈاؤن لوڈ ہونا لازمی ہے۔ اگر آپ کے پاس مکتبہ شاملہ پہلے سے انسٹال نہیں ہے تو اس کی آفیشل ویب سائٹ سے ڈاؤن لوڈ کریں۔
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
          <div className="space-y-2 rounded-lg border border-border p-4 bg-muted/20">
            <div className="flex items-center gap-2 font-bold text-primary text-base">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
                ۲
              </span>
              مرحلہ ۲: Al-Ulama Shamela Bridge پیکیج ڈاؤن لوڈ کرنا
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              ایزی ایڈیٹر کو آپ کی ڈسک پر موجود شاملہ 4 انڈیکس پڑھنے کے لیے ایک چھوٹے لوکل برج (Bridge Helper) کی ضرورت ہوتی ہے۔
            </p>
            <div className="p-3 rounded-md border border-border/80 bg-background space-y-2">
              <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Download className="h-4 w-4 text-emerald-600" />
                برج پیکیج میں شامل ہے:
              </p>
              <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1">
                <li><code className="font-mono bg-muted px-1 py-0.5 rounded text-[11px]">start-bridge.bat</code> — ونڈوز ڈبل کلک فائل</li>
                <li><code className="font-mono bg-muted px-1 py-0.5 rounded text-[11px]">start-bridge.sh</code> — میک/لینکس سکرپٹ</li>
                <li>Pre-built Helper Jar (مکتبہ شاملہ کے ساتھ موجود JRE پر خودکار طور پر چلتی ہے)</li>
              </ul>
            </div>
          </div>

          {/* Step 3 */}
          <div className="space-y-2 rounded-lg border border-border p-4 bg-muted/20">
            <div className="flex items-center gap-2 font-bold text-primary text-base">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
                ۳
              </span>
              مرحلہ ۳: لوکل برج سرور کو چالو کرنا (Start Server)
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              ڈاؤن لوڈ کی گئی زیپ فائل کو ان زپ (Unzip) کریں اور <code className="font-mono bg-muted px-1 py-0.5 rounded">start-bridge.bat</code> پر ڈبل کلک کریں۔ ایک بلیک کمانڈ ونڈو کھلے گی جس میں یہ پیغام ظاہر ہوگا:
            </p>
            <div className="p-2.5 rounded border border-border bg-slate-950 text-slate-100 font-mono text-[11px] ltr text-left">
              [Bridge] Listening on: http://127.0.0.1:8000
            </div>
            <p className="text-[11px] text-muted-foreground">
              (نوٹ: جب تک آپ ایڈیٹر میں لوکل شاملہ سرچ استعمال کر رہے ہوں، اس ونڈو کو کھلی رکھیں۔)
            </p>
          </div>

          {/* Step 4 */}
          <div className="space-y-2 rounded-lg border border-border p-4 bg-muted/20">
            <div className="flex items-center gap-2 font-bold text-primary text-base">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
                ۴
              </span>
              مرحلہ ۴: ایزی ایڈیٹر میں کنیکٹ کرنا
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              ایزی ایڈیٹر کی <strong>سیٹنگز (Settings)</strong> میں کنیکٹر پینل پر آئیں:
            </p>
            <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-1">
              <li>URL والے خانے میں <code className="font-mono bg-muted px-1 py-0.5 rounded">http://127.0.0.1:8000</code> درج کریں۔</li>
              <li><strong>"ٹیسٹ کنکشن"</strong> بٹن دبائیں۔</li>
              <li>کنکشن کامیاب ہونے پر آپ کے ڈسک پر موجود کتب کی تعداد اور "Active Local Tier-2" کا سبز بیج ظاہر ہو جائے گا۔</li>
            </ol>
          </div>

          {/* Security & Troubleshooting */}
          <div className="rounded-lg border border-border p-4 space-y-2 bg-emerald-500/5">
            <div className="flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-300 text-xs">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              سیکیورٹی اور پرائیویسی کی ضمانت
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              لوکل برج سرور صرف آپ کے اپنے کمپیوٹر (<code className="font-mono">127.0.0.1</code>) پر چلتا ہے اور اس کا کوئی بھی ڈیٹا یا کتب انٹرنیٹ پر اپ لوڈ نہیں ہوتی۔ تمام تلافی مکمل طور پر آف لائن اور آپ کی ڈیوائس پر ہی انجام پاتی ہے۔
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
