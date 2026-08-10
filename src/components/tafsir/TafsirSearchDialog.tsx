import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { BookOpen, Copy, Loader2, Quote } from "lucide-react";
import { tafsirCall } from "@/lib/tafsir/tafsirService";
import { insertTafsir } from "./insertTafsirQuote";
import {
  parseAyah, parseTafsirList, parseQuranSearch, parseTafsirSearch, rowsFromTextBlocks,
  type TafsirRow,
} from "@/lib/tafsir/parseTafsir";
import { translateStored } from "@/lib/i18n";

const LICENSE_NOTE = "مرکز تفسیر (CC BY 4.0)";

interface ResultItem extends TafsirRow {
  key: string;
}

interface TafsirSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TafsirSearchDialog({ open, onOpenChange }: TafsirSearchDialogProps) {
  const [tab, setTab] = useState<string>("ayah");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ResultItem[]>([]);

  const [surah, setSurah] = useState("");
  const [ayah, setAyah] = useState("");
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState<Array<{ name: string; label: string }>>([]);
  const [source, setSource] = useState<string>("");

  const ensureSources = async () => {
    if (sources.length > 0) return;
    try {
      const res = await tafsirCall("list_tafsir_sources", {});
      const obj = JSON.parse(res.text);
      const items = Array.isArray(obj) ? obj : obj.items;
      if (Array.isArray(items)) {
        setSources(
          items
            .map((it) => ({ name: String(it.slug ?? ""), label: String(it.attribution ?? it.name ?? it.slug ?? "") }))
            .filter((s) => s.name),
        );
      }
    } catch (err) {
      console.error("[TafsirSearchDialog] ensureSources:", err);
    }
  };

  const runAyah = async () => {
    const s = Number(surah), a = Number(ayah);
    if (!Number.isFinite(s) || !Number.isFinite(a) || s < 1 || a < 1) {
      toast.error(translateStored("toast.tafsir.reference_required"));
      return;
    }
    await capture(async () => {
      const res = await tafsirCall("fetch_ayah", { surah: s, ayah: a });
      const row = parseAyah({ text: res.text, structured: res.structured });
      return [{ key: `ayah-${s}-${a}`, ...row }];
    });
  };

  const runTafsir = async () => {
    const s = Number(surah), a = Number(ayah);
    if (!Number.isFinite(s) || !Number.isFinite(a) || s < 1 || a < 1) {
      toast.error(translateStored("toast.tafsir.reference_invalid"));
      return;
    }
    await capture(async () => {
      const res = await tafsirCall("fetch_tafsir", { surah: s, ayah: a });
      const rows = parseTafsirList({ text: res.text, structured: res.structured });
      if (rows.length > 0) return rows.map((r, i) => ({ key: `tafsir-${s}-${a}-${i}`, ...r }));
      return rowsFromTextBlocks(res.text).map((r, i) => ({ key: `raw-${i}`, ...r, reference: `سورہ ${s}:${a}` }));
    });
  };

  const runSearch = async (inTafsir: boolean) => {
    const q = query.trim();
    if (!q) { toast.error(translateStored("toast.search.query_required")); return; }
    await capture(async () => {
      const res = inTafsir
        ? await tafsirCall("search_in_tafsir", { query: q, source: source || undefined, limit: 20 })
        : await tafsirCall("search_quran_text", { query: q, limit: 20 });
      const rows = inTafsir
        ? parseTafsirSearch({ text: res.text, structured: res.structured })
        : parseQuranSearch({ text: res.text, structured: res.structured });
      return rows.map((r, i) => ({ key: `${inTafsir ? "tin" : "qur"}-${i}`, ...r }));
    });
  };

  /** Runs a producer, sets results, clears on empty, guards loading. */
  const capture = async (producer: () => Promise<ResultItem[]>) => {
    setLoading(true);
    setResults([]);
    try {
      const items = await producer();
      setResults(items);
      if (items.length === 0) toast.info(translateStored("toast.search.no_results"));
    } catch (err) {
      console.error("[TafsirSearchDialog]", err);
      toast.error(err instanceof Error ? err.message : translateStored("toast.common.request_failed"));
    } finally {
      setLoading(false);
    }
  };

  const runCurrent = () => {
    if (tab === "ayah") return runAyah();
    if (tab === "tafsir") return runTafsir();
    return runSearch(tab === "tafsir-search");
  };

  const handleInsert = async (item: ResultItem) => {
    const outcome = await insertTafsir({
      text: item.text, reference: item.reference, source: item.source, licenseNote: LICENSE_NOTE,
    });
    if (outcome === "inserted") toast.success(translateStored("toast.editor.inserted"));
    else if (outcome === "copied") toast.info(translateStored("toast.clipboard.copied"));
    else toast.error(translateStored("toast.editor.insert_failed"));
  };

  const handleCopy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(translateStored("toast.common.copied")); }
    catch { toast.error(translateStored("toast.common.copy_failed")); }
  };

  const showSurahAyah = tab === "ayah" || tab === "tafsir";
  const showSource = tab === "tafsir-search";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <BookOpen className="h-5 w-5 text-primary" /> قرآن اور تفسیر
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            مرکز تفسیر (Tafsir MCP) — ماخذ کے حوالے کے ساتھ آیت / تفسیر / تلاش
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex flex-col min-h-0">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="ayah">آیت</TabsTrigger>
            <TabsTrigger value="tafsir">تفسیر</TabsTrigger>
            <TabsTrigger value="search">قرآن تلاش</TabsTrigger>
            <TabsTrigger value="tafsir-search">تفسیر میں تلاش</TabsTrigger>
          </TabsList>

          <div className="flex gap-2 items-end py-3">
            {showSurahAyah ? (
              <div className="grid grid-cols-2 gap-2 flex-1">
                <div className="space-y-1">
                  <Label className="text-xs">سورہ</Label>
                  <Input inputMode="numeric" value={surah} onChange={(e) => setSurah(e.target.value)} placeholder="1" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">آیت</Label>
                  <Input inputMode="numeric" value={ayah} onChange={(e) => setAyah(e.target.value)} placeholder="1" />
                </div>
              </div>
            ) : (
              <div className="space-y-1 flex-1">
                <Label className="text-xs">تلاش کا متن</Label>
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="مثال: رحمة" />
              </div>
            )}
            {showSource && (
              <div className="space-y-1 min-w-[150px]">
                <Label className="text-xs">مصدر</Label>
                <Select value={source} onValueChange={setSource} onOpenChange={(o) => { if (o) void ensureSources(); }}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="پیش فرض" /></SelectTrigger>
                  <SelectContent dir="rtl">
                    {sources.map((s) => <SelectItem key={s.name} value={s.name}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button type="button" onClick={runCurrent} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "چلائیں"}
            </Button>
          </div>

          <TabsContent value="ayah" className="min-h-0 flex-1"><Hint>آیت کی سورہ اور آیت نمبر درج کر کے «چلائیں» دبائیں۔</Hint></TabsContent>
          <TabsContent value="tafsir" className="min-h-0 flex-1"><Hint>کسی آیت کی تفسیر متعدد ماخذ سے حاصل کریں۔</Hint></TabsContent>
          <TabsContent value="search" className="min-h-0 flex-1"><Hint>قرآنی متن میں تلاش (بغیر تشکیلیات کے)۔</Hint></TabsContent>
          <TabsContent value="tafsir-search" className="min-h-0 flex-1"><Hint>کسی خاص تفسیر میں متن تلاش۔</Hint></TabsContent>
        </Tabs>

        <ScrollArea className="max-h-[45vh] min-h-[120px] border-t border-border pt-3">
          {loading && <p className="text-xs text-muted-foreground text-center py-8">لوڈ ہو رہا ہے…</p>}
          {!loading && results.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">نتائج یہاں ظاہر ہوں گے۔</p>
          )}
          <div className="space-y-3">
            {results.map((item) => (
              <div key={item.key} className="p-3 rounded-lg border border-border bg-muted/60 space-y-2" dir="rtl">
                <div className="text-sm leading-relaxed whitespace-pre-wrap">{item.text}</div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  {item.reference && <span className="text-primary font-medium" dir="rtl">{item.reference}</span>}
                  {item.source && <span>{item.source}</span>}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs flex-1" onClick={() => handleInsert(item)}>
                    <Quote className="h-3.5 w-3.5" /> ایڈیٹر میں داخل
                  </Button>
                  <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => handleCopy(item.text)}>
                    <Copy className="h-3.5 w-3.5" /> کاپی
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground py-1">{children}</p>;
}
