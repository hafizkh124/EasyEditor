import { useEffect, useState } from "react";
import { BookMarked, ClipboardPaste, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { cleanGlossary, parseGlossaryText, type GlossaryEntry } from "@/lib/translate/glossary";
import { loadEarlierGlossaries, type EarlierGlossary } from "@/hooks/bookTranslations";

/**
 * The glossary of fixed terms for one translation (SYSTEM-2026 §6): typed a
 * row at a time, pasted as a list, or brought over from an earlier
 * translation so a series keeps the same renderings.
 */
export function GlossaryDialog({
  open,
  onOpenChange,
  glossary,
  onSave,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  glossary: readonly GlossaryEntry[];
  onSave: (entries: GlossaryEntry[]) => void;
  projectId: string | null;
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [rows, setRows] = useState<GlossaryEntry[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [earlier, setEarlier] = useState<EarlierGlossary[]>([]);

  useEffect(() => {
    if (!open) return;
    setRows(glossary.length ? glossary.map((e) => ({ ...e })) : [{ source: "", target: "" }]);
    setPasteOpen(false);
    setPasted("");
    if (!user) return;
    let alive = true;
    void loadEarlierGlossaries(user.id, projectId).then((list) => alive && setEarlier(list));
    return () => { alive = false; };
  }, [open, glossary, user, projectId]);

  const merge = (entries: readonly GlossaryEntry[]) =>
    setRows((current) => [...cleanGlossary(current), ...entries]);

  const update = (i: number, patch: Partial<GlossaryEntry>) =>
    setRows((current) => current.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = () => {
    onSave(cleanGlossary(rows));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <BookMarked className="h-5 w-5 text-primary" aria-hidden="true" />
            {t("translate.glossary_title", "اصطلاحات کی فہرست")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("translate.glossary_desc", "یہ اصطلاحات پوری کتاب میں ہمیشہ اسی طرح ترجمہ ہوں گی۔ جائزے میں جہاں پابندی نہ ہوئی وہاں نشان دکھے گا۔")}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-2 overflow-y-auto py-1">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-1 text-xs text-muted-foreground">
            <span>{t("translate.glossary_source", "اصل اصطلاح")}</span>
            <span>{t("translate.glossary_target", "ترجمہ")}</span>
            <span className="w-9" />
          </div>
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
              <Input
                value={row.source}
                onChange={(e) => update(i, { source: e.target.value })}
                dir="auto"
                aria-label={`${t("translate.glossary_source", "اصل اصطلاح")} ${i + 1}`}
                className="h-9 text-sm"
              />
              <Input
                value={row.target}
                onChange={(e) => update(i, { target: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && i === rows.length - 1) setRows((r) => [...r, { source: "", target: "" }]);
                }}
                dir="auto"
                aria-label={`${t("translate.glossary_target", "ترجمہ")} ${i + 1}`}
                className="h-9 text-sm"
              />
              <Button
                variant="ghost" size="icon" className="h-9 w-9"
                onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                aria-label={t("translate.glossary_remove", "اصطلاح ہٹائیں")}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setRows((r) => [...r, { source: "", target: "" }])}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("translate.glossary_add", "اصطلاح شامل کریں")}
          </Button>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setPasteOpen((o) => !o)} aria-expanded={pasteOpen}>
            <ClipboardPaste className="h-4 w-4" aria-hidden="true" />
            {t("translate.glossary_paste", "فہرست چسپاں کریں")}
          </Button>
          {earlier.length > 0 && (
            <Select
              value=""
              onValueChange={(id) => {
                const found = earlier.find((g) => g.projectId === id);
                if (found) merge(found.entries);
              }}
            >
              <SelectTrigger className="h-9 w-auto min-w-[12rem] text-xs" aria-label={t("translate.glossary_from_earlier", "پچھلے ترجمے سے لیں")}>
                <SelectValue placeholder={t("translate.glossary_from_earlier", "پچھلے ترجمے سے لیں")} />
              </SelectTrigger>
              <SelectContent>
                {earlier.map((g) => (
                  <SelectItem key={g.projectId} value={g.projectId}>
                    {g.title} ({g.entries.length})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {pasteOpen && (
          <div className="space-y-2">
            <Textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              dir="auto"
              placeholder={t("translate.glossary_paste_hint", "ہر سطر پر ایک اصطلاح: الصلاة = Salah")}
              aria-label={t("translate.glossary_paste", "فہرست چسپاں کریں")}
              className="min-h-[6rem] text-sm"
            />
            <Button
              size="sm" className="h-9"
              disabled={!parseGlossaryText(pasted).length}
              onClick={() => { merge(parseGlossaryText(pasted)); setPasted(""); setPasteOpen(false); }}
            >
              {t("translate.glossary_paste_add", "فہرست میں شامل کریں")}
            </Button>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel", "منسوخ")}</Button>
          <Button onClick={save}>{t("common.save", "محفوظ کریں")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
