import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Save, Sparkles, Quote, Loader2 } from "lucide-react";
import { callEdgeFunction } from "@/core/ai/aiAdapter";

interface BookEditorViewProps {
  sectionId?: string;
  chapterTitle: string;
  sectionTitle: string;
  initialContent: string;
  onSaveContent: (content: string) => Promise<void>;
}

export function BookEditorView({
  sectionId,
  chapterTitle,
  sectionTitle,
  initialContent,
  onSaveContent,
}: BookEditorViewProps) {
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  // Custom Footnote Modal State
  const [footnoteModalOpen, setFootnoteModalOpen] = useState(false);
  const [customFootnoteText, setCustomFootnoteText] = useState("");

  useEffect(() => {
    setContent(initialContent);
  }, [initialContent, sectionId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveContent(content);
      toast.success("فصل کا متن محفوظ کر لیا گیا۔");
    } catch (err) {
      console.error(err);
      toast.error("محفوظ کرنے میں ناکامی۔");
    } finally {
      setSaving(false);
    }
  };

  /**
   * Refine text via refine-text edge function.
   * Action contracts supported by refine-text: "add_harakat" | "spelling_check" | "formalize"
   */
  const handleRefineAi = async (action: "add_harakat" | "spelling_check" | "formalize") => {
    if (!content.trim()) return;
    setAiLoading(true);
    try {
      const { data, error } = await callEdgeFunction("refine-text", { text: content, action });
      if (error) throw new Error(error.message);
      const refinedText = (data as { text?: string } | null)?.text ?? "";
      if (refinedText) {
        setContent(refinedText);
        toast.success(`AI اصلاح (${action}) مکمل ہو گئی۔`);
      } else {
        toast.info("اصلاح شدہ متن برآمد نہیں ہوا۔");
      }
    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "AI اصلاح میں خرابی پیش آئی۔";
      toast.error(msg);
    } finally {
      setAiLoading(false);
    }
  };

  /**
   * Insert user's custom authentic footnote
   */
  const handleInsertFootnote = () => {
    if (!customFootnoteText.trim()) {
      toast.error("فُٹ نوٹ کا حوالہ درج کریں۔");
      return;
    }
    const fnNumber = (content.match(/\[\^\d+\]/g) || []).length + 1;
    const noteRef = `[^${fnNumber}]`;
    const noteEntry = `\n\n${noteRef}: ${customFootnoteText.trim()}`;
    setContent((prev) => prev + noteRef + noteEntry);
    setCustomFootnoteText("");
    setFootnoteModalOpen(false);
    toast.success(`فُٹ نوٹ #${fnNumber} شامل کر دیا گیا۔`);
  };

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden p-4">
      {/* Editor Header Toolbar */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{chapterTitle}</span>
            <span className="text-xs text-muted-foreground">/</span>
            <h2 className="text-sm font-semibold text-foreground">{sectionTitle}</h2>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">الفاظ کی تعداد: {wordCount}</p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => handleRefineAi("add_harakat")} disabled={aiLoading}>
            {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin ml-1" /> : <Sparkles className="h-3.5 w-3.5 ml-1 text-amber-500" />}
            اعراب و تشکلیل
          </Button>

          <Button size="sm" variant="outline" onClick={() => handleRefineAi("spelling_check")} disabled={aiLoading}>
            املاء تصحیح
          </Button>

          <Button size="sm" variant="outline" onClick={() => setFootnoteModalOpen(true)}>
            <Quote className="h-3.5 w-3.5 ml-1 text-primary" />
            فُٹ نوٹ +
          </Button>

          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save className="h-3.5 w-3.5 ml-1" />
            محفوظ کریں
          </Button>
        </div>
      </div>

      {/* Main Textarea Writing Canvas */}
      <Textarea
        dir="rtl"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="صفحہ بہ صفحہ تحریر کا آغاز کریں..."
        className="flex-1 min-h-[350px] p-4 text-base font-serif leading-relaxed resize-none rounded-lg border border-border focus:ring-1 focus:ring-primary"
      />

      {/* Custom Footnote Modal */}
      <Dialog open={footnoteModalOpen} onOpenChange={setFootnoteModalOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>فُٹ نوٹ شامل کریں</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>حوالہ / حاشیہ کی تفاصیل</Label>
              <Input
                placeholder="مثلاً: صحیح البخاری، کتاب الایمان، رقم الحديث: 8، دار طوق النجاة"
                value={customFootnoteText}
                onChange={(e) => setCustomFootnoteText(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFootnoteModalOpen(false)}>منسوخ</Button>
            <Button onClick={handleInsertFootnote}>شامل کریں</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
