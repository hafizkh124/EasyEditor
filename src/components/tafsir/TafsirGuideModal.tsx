import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BookMarked, ShieldCheck, ExternalLink, Sparkles } from "lucide-react";

interface TafsirGuideModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TafsirGuideModal({ open, onOpenChange }: TafsirGuideModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <BookMarked className="h-5 w-5 text-primary" />
            Tafsir MCP — ایزی ایڈیٹر میں قرآن اور تفسیر تک رسائی
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            مرکز تفسیر کے کھلے MCP سرور کے ذریعے 28 تفاسیر (طبری، ابنِ کثیر، سعدی، قرطبی وغیرہ) اور علومِ قرآن۔
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 text-sm">
          <div className="space-y-2 rounded-lg border border-border p-4 bg-muted/20">
            <div className="flex items-center gap-2 font-bold text-primary text-base">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">۱</span>
              موڈ منتخب کریں
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              <strong>آن لائن (ریموٹ)</strong> — بغیر کسی انسٹال کے، براہِ راست سرور سے (انٹرنیٹ درکار)۔
              <br />
              <strong>مقامی (آف لائن)</strong> — ترجیحا جب آپ کے کمپیوٹر پر <code>uvx</code> موجود ہو؛ ڈیٹا آف لائن رہتا ہے۔
            </p>
          </div>

          <div className="space-y-2 rounded-lg border border-border p-4 bg-muted/20">
            <div className="flex items-center gap-2 font-bold text-primary text-base">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">۲</span>
              «منسلک ہوں» دبائیں
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              کارڈ پر <strong>"Tafsir MCP سے منسلک ہوں"</strong> دبائیں۔ ایپ سرور سے ہاتھ ملائے گی اور دستیاب اوزار دکھائے گی۔
            </p>
          </div>

          <div className="space-y-2 rounded-lg border border-border p-4 bg-muted/20">
            <div className="flex items-center gap-2 font-bold text-primary text-base">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">۳</span>
              قرآن / تفسیر تلاش کریں
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              «قرآن اور تفسیر تلاش کریں» سے آیت، تفسیر یا متن تلاش کریں۔ ہر نتیجے پر ماخذ (تفسیر کا نام اور انتساب) ظاہر ہوتا ہے۔
              <Sparkles className="inline h-3.5 w-3.5 ms-1 text-primary" />
            </p>
          </div>

          <div className="space-y-2 rounded-lg border border-border p-4 bg-muted/20">
            <div className="flex items-center gap-2 font-bold text-primary text-base">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">۴</span>
              ایڈیٹر میں داخل کریں
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              «ایڈیٹر میں داخل کریں» منتخب متن کو ماخذ کے حوالے کے ساتھ اردو/عربی حرف کے بلاقیٹ میں داخل کرتا ہے۔ اگر ایڈیٹر کھلا نہ ہو تو متن کلپ بورڈ پر چلا جاتا ہے۔
            </p>
          </div>

          <div className="rounded-lg border border-border p-4 space-y-2 bg-emerald-500/5">
            <div className="flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-300 text-xs">
              <ShieldCheck className="h-4 w-4 text-emerald-600" /> انتساب و لائسنس
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              تمام متن <strong>مرکز تفسیر (CC BY 4.0)</strong> کے تحت ہے — ہر نقل کے ساتھ ماخذ خودکار طور پر درج ہوتا ہے۔ مقامی موڈ میں کوئی نیٹ ورک رابطہ نہیں ہوتا۔
            </p>
          </div>
        </div>

        <div className="flex justify-between items-center pt-4 border-t border-border">
          <a href="https://tafsirmcp.netlify.app/" target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium">
            <ExternalLink className="h-3.5 w-3.5" /> مرکز تفسیر / Tafsir MCP
          </a>
          <Button onClick={() => onOpenChange(false)} size="sm">سمجھ گیا (بند کریں)</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}