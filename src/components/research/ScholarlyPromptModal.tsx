import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SCHOLARLY_PROMPTS, type ScholarlyPromptDef } from "@/lib/prompts/promptsRegistry";
import { BookOpen, Scale, Scroll, Languages, UserCheck, Sparkles, PenTool, AlertTriangle, ShieldCheck } from "lucide-react";

interface ScholarlyPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPrompt: (promptText: string, prompt: ScholarlyPromptDef) => void;
}

const CATEGORY_LABELS: Record<string, { labelUr: string; icon: typeof BookOpen }> = {
  fiqh: { labelUr: "فقہ و فتاویٰ", icon: Scale },
  hadith: { labelUr: "حدیث و رجال", icon: Scroll },
  tafsir: { labelUr: "تفسیر و قرآن", icon: BookOpen },
  authoring: { labelUr: "تصنیف و مضمون", icon: PenTool },
  lexicon: { labelUr: "لغت و اعراب", icon: Languages },
  general: { labelUr: "عام ریسرچ و سوانح", icon: UserCheck },
};

export function ScholarlyPromptModal({ isOpen, onClose, onSelectPrompt }: ScholarlyPromptModalProps) {
  const [selectedPrompt, setSelectedPrompt] = useState<ScholarlyPromptDef | null>(SCHOLARLY_PROMPTS[0]);
  const [argValues, setArgValues] = useState<Record<string, string>>({});
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const filteredPrompts = SCHOLARLY_PROMPTS.filter((p) => {
    if (activeCategory === "all") return true;
    return p.category === activeCategory;
  });

  const handleArgChange = (name: string, val: string) => {
    setArgValues((prev) => ({ ...prev, [name]: val }));
  };

  const handleGeneratePrompt = () => {
    if (!selectedPrompt) return;
    let text = selectedPrompt.systemInstructionTemplate;
    selectedPrompt.arguments.forEach((arg) => {
      const val = argValues[arg.name] || "";
      text = text.replace(new RegExp(`{{${arg.name}}}`, "g"), val);
    });
    onSelectPrompt(text, selectedPrompt);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden" dir="rtl">
        <DialogHeader className="p-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <DialogTitle className="text-lg font-bold">14 علمی پرامپٹس فریم ورک (Scholarly Workflows)</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            فقہی تحقیق، تخریجِ حدیث، تقابلِ تفاسیر، موازنہ تراجم، علم الرجال اور مضمون نگاری کے سائنسی سانچے (Templates)۔
          </DialogDescription>
        </DialogHeader>

        {/* Category Filters */}
        <div className="flex items-center gap-1.5 p-3 border-b border-border bg-card overflow-x-auto">
          <Button
            variant={activeCategory === "all" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs rounded-full"
            onClick={() => setActiveCategory("all")}
          >
            تمام (14)
          </Button>
          {Object.entries(CATEGORY_LABELS).map(([catKey, catMeta]) => {
            const CatIcon = catMeta.icon;
            return (
              <Button
                key={catKey}
                variant={activeCategory === catKey ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs rounded-full gap-1"
                onClick={() => setActiveCategory(catKey)}
              >
                <CatIcon className="h-3 w-3" />
                {catMeta.labelUr}
              </Button>
            );
          })}
        </div>

        {/* Body Split Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 flex-1 overflow-hidden">
          {/* Prompts List Sidebar */}
          <ScrollArea className="md:col-span-5 border-l border-border p-2 space-y-1 max-h-[50vh] md:max-h-[60vh]">
            {filteredPrompts.map((p) => {
              const isSelected = selectedPrompt?.id === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelectedPrompt(p);
                    setArgValues({});
                  }}
                  className={`w-full text-right p-2.5 rounded-lg border transition-all text-xs mb-1.5 flex flex-col gap-1 ${
                    isSelected
                      ? "border-primary bg-primary/10 font-semibold"
                      : "border-border/60 hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-foreground">{p.titleUr}</span>
                    <Badge variant="secondary" className="text-[9px] px-1 py-0 font-sans dir-ltr">
                      {p.titleAr}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                    {p.descriptionUr}
                  </p>
                  {!p.corpusReady && (
                    <span className="text-[9px] text-amber-700 dark:text-amber-500 flex items-center gap-0.5">
                      <AlertTriangle className="h-2.5 w-2.5" /> ذخیرہ زیرِ تعمیر — نتائج غیر مصدقہ
                    </span>
                  )}
                </button>
              );
            })}
          </ScrollArea>

          {/* Selected Prompt Form */}
          <div className="md:col-span-7 p-4 flex flex-col justify-between overflow-y-auto max-h-[50vh] md:max-h-[60vh] bg-card">
            {selectedPrompt ? (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-base font-bold text-foreground">{selectedPrompt.titleUr}</h4>
                    <span className="text-xs text-muted-foreground dir-ltr">({selectedPrompt.titleAr})</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{selectedPrompt.descriptionUr}</p>
                  {selectedPrompt.grounded && (
                    <p className="text-[10px] text-primary mt-1 flex items-center gap-1">
                      <ShieldCheck className="h-3 w-3" /> یہ پرامپٹ گراؤنڈڈ اسلامی موڈ (مصدر سے حوالہ) پر چلے گا۔
                    </p>
                  )}
                  {!selectedPrompt.corpusReady && (
                    <p className="text-[10px] text-amber-700 dark:text-amber-500 mt-1 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> اس فن کا حوالہ ذخیرہ ابھی مکمل نہیں؛ حوالہ جات کی خود تصدیق ضروری ہے۔
                    </p>
                  )}
                </div>

                {/* Form Arguments */}
                <div className="space-y-3 pt-2">
                  {selectedPrompt.arguments.map((arg) => (
                    <div key={arg.name} className="space-y-1.5">
                      <Label className="text-xs font-semibold">
                        {arg.labelUr} {arg.required && <span className="text-destructive">*</span>}
                      </Label>
                      <Input
                        value={argValues[arg.name] || ""}
                        onChange={(e) => handleArgChange(arg.name, e.target.value)}
                        placeholder={arg.placeholderUr}
                        className="text-xs h-9"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                براہِ کرم دائیں جانب سے کسی پرامپٹ کا انتخاب کریں۔
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="p-3 border-t border-border bg-muted/20 flex items-center justify-between sm:justify-between">
          <Button variant="ghost" size="sm" onClick={onClose} className="text-xs">
            منسوخ کریں
          </Button>
          <Button
            size="sm"
            onClick={handleGeneratePrompt}
            disabled={!selectedPrompt}
            className="text-xs gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5" />
            پرامپٹ شامل کریں (Apply Prompt)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
