import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import type { ScholarlyPromptDef } from "@/lib/prompts/promptsRegistry";
import { fillPromptTemplate } from "@/lib/skills/fillPrompt";

/**
 * Fills in one prompt skill picked from the chat's `/` menu — a scholarly
 * prompt or "مجھ سے پوچھو" — and hands the finished instruction back to the
 * composer, where the scholar reviews it and sends.
 */

export function SkillPromptDialog({
  prompt,
  onClose,
  onApply,
}: {
  prompt: ScholarlyPromptDef | null;
  onClose: () => void;
  onApply: (text: string, prompt: ScholarlyPromptDef) => void;
}) {
  const { t, direction } = useLanguage();
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => setValues({}), [prompt?.id]);

  const missing = prompt?.arguments.some((arg) => arg.required && !(values[arg.name] ?? "").trim()) ?? true;

  const apply = () => {
    if (!prompt || missing) return;
    onApply(fillPromptTemplate(prompt, values), prompt);
    onClose();
  };

  return (
    <Dialog open={prompt !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" dir={direction}>
        {prompt && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              apply();
            }}
            className="space-y-4"
          >
            <DialogHeader className="text-start">
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                {prompt.titleUr}
              </DialogTitle>
              <DialogDescription>{prompt.descriptionUr}</DialogDescription>
            </DialogHeader>
            {prompt.arguments.map((arg, i) => (
              <div key={arg.name} className="space-y-1.5">
                <Label htmlFor={`skill-arg-${arg.name}`}>
                  {arg.labelUr} {arg.required && <span className="text-destructive">*</span>}
                </Label>
                <Input
                  id={`skill-arg-${arg.name}`}
                  autoFocus={i === 0}
                  value={values[arg.name] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [arg.name]: e.target.value }))}
                  placeholder={arg.placeholderUr}
                />
              </div>
            ))}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel", "منسوخ")}</Button>
              <Button type="submit" disabled={missing}>{t("skills.use", "استعمال کریں")}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
