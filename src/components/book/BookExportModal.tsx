import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { translateStored, translateStoredFormat } from "@/lib/i18n";

interface BookExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookTitle: string;
  fullContent: string;
}

export function BookExportModal({ open, onOpenChange, bookTitle, fullContent }: BookExportModalProps) {
  const [format, setFormat] = useState<"html" | "txt" | "print">("html");

  const handleExport = () => {
    if (!fullContent.trim()) {
      toast.error(translateStored("toast.book.empty"));
      return;
    }

    if (format === "print") {
      const printWindow = window.open("", "_blank");
      if (printWindow) {
        printWindow.document.write(`
          <html dir="rtl">
            <head>
              <title>${bookTitle}</title>
              <style>
                body { font-family: 'Amiri', 'Traditional Arabic', serif; padding: 40px; line-height: 1.8; }
                h1 { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #ccc; padding-bottom: 10px; }
                p { margin-bottom: 14px; text-align: justify; }
                .footnote { font-size: 0.85em; color: #555; border-top: 1px solid #ddd; margin-top: 30px; padding-top: 10px; }
              </style>
            </head>
            <body>
              <h1>${bookTitle}</h1>
              <div>${fullContent.replace(/\n\n+/g, "</p><p>")}</div>
            </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.print();
      }
    } else {
      const mime = format === "html" ? "text/html;charset=utf-8" : "text/plain;charset=utf-8";
      const blob = new Blob([fullContent], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${bookTitle.replace(/\s+/g, "_")}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(translateStoredFormat("toast.book.export_saved", { format: format.toUpperCase() }));
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            فائنل کتاب ایکسپورٹ (Export Final Book)
          </DialogTitle>
          <DialogDescription>
            تنسقِ ابواب، اقوال اور فُٹ نوٹس کے ساتھ فائنل ایکسپورٹ فائل تیار کریں۔
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold">ایکسپورٹ فارمیٹ چنیں</label>
            <Select value={format} onValueChange={(v) => setFormat(v as "html" | "txt" | "print")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="html">HTML Web Book (مع تمام فارمٹنگ و فونٹس)</SelectItem>
                <SelectItem value="txt">سادہ ٹیکس / Word درامد (Plain Text)</SelectItem>
                <SelectItem value="print">پرنٹ / PDF ڈائریکٹ ایکسپورٹ</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>منسوخ</Button>
          <Button onClick={handleExport}>
            <Download className="h-4 w-4 ml-1" />
            ایکسپورٹ کریں
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
