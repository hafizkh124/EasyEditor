import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Sparkles, Loader2, Search, CheckCircle, AlertTriangle } from "lucide-react";
import { streamResearchQuery } from "@/lib/research/streamers";
import { translateStored, translateStoredFormat } from "@/lib/i18n";

interface KhittatBahthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplyPlan: (plan: { title: string; abstract: string; chapters: string[] }) => void;
}

export function KhittatBahthModal({ open, onOpenChange, onApplyPlan }: KhittatBahthModalProps) {
  const [topic, setTopic] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [streamedText, setStreamedText] = useState("");

  const handleRunAnalysis = async () => {
    if (!topic.trim()) {
      toast.error(translateStored("toast.book.topic_required"));
      return;
    }
    setAnalyzing(true);
    setStreamedText("");

    // The prior-work check (عدم سبق الدراسة) is the whole point of this
    // workflow, so it is asked for explicitly — together with a hard
    // instruction not to invent titles/authors when nothing is known.
    const promptText =
      `خطة البحث والتأليف: أدرس الموضوع التالي: "${topic.trim()}".\n\n` +
      `1. عدم سبق الدراسة: اذكر ما تعرفه من كتب أو رسائل أو مقالات سابقة في هذا الموضوع. ` +
      `وإن لم تكن على علم بشيء منها فصرّح بذلك صراحةً، ولا تختلق عنواناً ولا مؤلفاً ولا ناشراً البتة.\n` +
      `2. موضع الجدّة: بيّن ما الذي يضيفه هذا البحث.\n` +
      `3. التأصيل العلمي والأهمية.\n` +
      `4. خطة بحث مقترحة مقسمة إلى أبواب وفصول، كل باب أو فصل في سطر مستقل ` +
      `(مثل: "الباب الأول: ..." أو "الفصل الأول: ...").`;

    await streamResearchQuery({
      query: promptText,
      sources: [],
      strictMode: false,
      chatHistory: [],
      mode: "general",
      onDelta: (chunk) => {
        setStreamedText((prev) => prev + chunk);
      },
      onDone: () => {
        setAnalyzing(false);
        toast.success(translateStored("toast.book.plan_ready"));
      },
      onError: (err) => {
        setAnalyzing(false);
        toast.error(translateStoredFormat("toast.common.error_detail", { error: String(err) }));
      },
    });
  };

  // Helper: Extract structured chapter outlines from real streamed text
  const extractChaptersFromText = (text: string): string[] => {
    if (!text) return [];
    const lines = text.split("\n");
    const extracted: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        /^(?:الباب|الفصل|مبحث|باب|فصل|\d+\.|#+)\s+/i.test(trimmed) ||
        (trimmed.length > 5 && trimmed.length < 80 && (trimmed.includes("الباب") || trimmed.includes("الفصل")))
      ) {
        extracted.push(trimmed.replace(/^[#*\-\d.\s]+/, ""));
      }
    }
    // No placeholder outline: if nothing could be extracted, return nothing.
    // Inventing a generic "الباب الأول/الثاني/الخاتمة" skeleton would present
    // boilerplate to the author as if the model had planned THEIR topic.
    return [...new Set(extracted)];
  };

  const handleApply = () => {
    if (!streamedText.trim()) return;
    const chapters = extractChaptersFromText(streamedText);
    const text = streamedText.trim();
    onApplyPlan({
      title: topic.trim(),
      // Only mark it truncated when it actually was.
      abstract: text.length > 300 ? `${text.slice(0, 300)}…` : text,
      chapters,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            خطة البحث والتأليف (تحلیل و خاکہ ساز)
          </DialogTitle>
          <DialogDescription>
            تصنیف کے لیے موضوع درج کریں تاکہ علمی جائزہ اور خودکار خاکہ تیار کیا جا سکے۔
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 flex-1 overflow-y-auto">
          <div className="space-y-1.5">
            <Label>موضوعِ تصنیف / مجوزہ عنوان</Label>
            <div className="flex gap-2">
              <Input
                placeholder="مثلاً: فتاویٰ جدیدہ میں مقاصدِ شریعت کا تطبیقی مطالعہ"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
              <Button onClick={handleRunAnalysis} disabled={analyzing}>
                {analyzing ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Search className="h-4 w-4 ml-1" />}
                جائزہ لیں
              </Button>
            </div>
          </div>

          {/* Streamed Research Analysis Canvas */}
          {(analyzing || streamedText) && (
            <div className="space-y-2 p-4 rounded-lg border border-border bg-card">
              <Label className="text-xs font-semibold text-primary block">علمی تحلیل و خطة البحث المقترحة:</Label>
              <div
                dir="rtl"
                className="text-xs leading-relaxed font-serif whitespace-pre-wrap max-h-60 overflow-y-auto p-3 rounded bg-muted/60 border border-border/50 text-foreground"
              >
                {streamedText || "علمی جائزہ اور خاکہ تیار کیا جا رہا ہے..."}
              </div>

              {!analyzing && streamedText && (
                <>
                  <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-2.5">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-500" />
                    <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                      یہ AI کا ابتدائی تجزیہ ہے، مکمل علمی سروے نہیں۔ «عدمِ سبقِ دراسہ» کی حتمی تصدیق
                      مکتبات و فہارس میں خود کریں؛ اگر کوئی کتاب یا مقالہ ذکر ہوا ہو تو اس کا حوالہ بھی خود جانچ لیں۔
                    </p>
                  </div>

                  {(() => {
                    const chapters = extractChaptersFromText(streamedText);
                    return chapters.length > 0 ? (
                      <div className="space-y-1">
                        <Label className="text-xs font-semibold block">
                          نکالے گئے ابواب ({chapters.length}) — «خاکہ لاگو کریں» پر یہی شامل ہوں گے:
                        </Label>
                        {chapters.map((ch, i) => (
                          <div key={i} className="p-1.5 rounded bg-muted text-xs border border-border">
                            {ch}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        جواب سے ابواب کی الگ فہرست نہیں نکل سکی — خاکہ لاگو کرنے پر صرف عنوان و خلاصہ شامل ہوگا،
                        ابواب آپ خود شامل کر سکتے ہیں۔
                      </p>
                    );
                  })()}
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>منسوخ</Button>
          {streamedText && (
            <Button onClick={handleApply} disabled={analyzing}>
              <CheckCircle className="h-4 w-4 ml-1" />
              خاکہ پروجیکٹ میں منتقل کریں
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
