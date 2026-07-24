import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Search, Copy, Check, Sparkles, BookOpen, Layers, Info, FileEdit } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isRtlText } from "@/utils/textUtils";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Same blockquote-with-citation shape RichEditor's "Insert Resource" uses, so
 *  content dropped in from /extract looks identical to citations inserted
 *  from inside the editor. */
function citationBlockquote(text: string, citation: string): string {
  const rtl = isRtlText(text);
  return (
    `<blockquote dir="${rtl ? "rtl" : "ltr"}"><p>${escapeHtml(text)}</p>` +
    (citation ? `<p><em>[${escapeHtml(citation)}]</em></p>` : "") +
    `</blockquote><p></p>`
  );
}

interface TranslatorOption {
  slug: string;
  fullName: string;
  language: string;
  maslak: string | null;
  isSelected: boolean;
}

interface TranslationRow {
  translator_slug: string;
  full_name: string;
  language: string;
  maslak: string | null;
  text: string;
  source_url?: string | null;
}

export default function ExtractPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("quran:2:255");
  const [translators, setTranslators] = useState<TranslatorOption[]>([]);
  const [translatorsLoading, setTranslatorsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [arabic, setArabic] = useState<string | null>(null);
  const [results, setResults] = useState<TranslationRow[]>([]);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Load the real translator registry from the DB (no hardcoded list).
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("translators")
        .select("slug, full_name, language, maslak, sort_order")
        .eq("is_enabled", true)
        .eq("corpus_type", "quran")
        .order("sort_order", { ascending: true });
      if (error) {
        console.error("Failed to load translators:", error);
        toast.error("مترجمین کی فہرست حاصل نہیں ہو سکی۔");
      } else if (data) {
        setTranslators(
          data.map((t, idx) => ({
            slug: t.slug,
            fullName: t.full_name,
            language: t.language,
            maslak: t.maslak,
            // Default: pre-select the first few so the matrix isn't overwhelming.
            isSelected: idx < 5,
          })),
        );
      }
      setTranslatorsLoading(false);
    })();
  }, []);

  const toggleTranslator = (slug: string) => {
    setTranslators((prev) =>
      prev.map((t) => (t.slug === slug ? { ...t, isSelected: !t.isSelected } : t)),
    );
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    setNote(null);

    const activeSlugs = translators.filter((t) => t.isSelected).map((t) => t.slug);
    let passageKey = query.trim();
    // Auto-format "2:255" -> "quran:2:255"
    if (/^\d+:\d+$/.test(passageKey)) {
      passageKey = `quran:${passageKey}`;
    }
    // Hadith passages come back as Arabic + Urdu + English automatically, so the
    // Quran translator selection doesn't apply — don't send it.
    const isHadithKey = /^hadith:/i.test(passageKey);

    try {
      const { data, error } = await supabase.functions.invoke("extract-translations", {
        body: {
          passage_key: passageKey,
          slugs: isHadithKey || activeSlugs.length === 0 ? undefined : activeSlugs,
        },
      });

      if (error) {
        console.error("Error fetching translations:", error);
        toast.error("تراجم حاصل کرنے میں دشواری پیش آئی۔");
        setArabic(null);
        setResults([]);
        setUnavailable([]);
      } else {
        setArabic(data?.arabic ?? null);
        setResults((data?.translations ?? []) as TranslationRow[]);
        setUnavailable((data?.unavailable ?? []) as string[]);
        setNote(data?.note ?? null);
        const n = data?.translations?.length ?? 0;
        if (n > 0) toast.success(`${n} تراجم برآمد ہوئے۔`);
        else if (!data?.note) toast.info("اس حوالے کے تراجم دستیاب نہیں ہوئے۔");
      }
    } catch (err) {
      console.error(err);
      toast.error("ایک غیر متوقع خرابی پیش آئی۔");
      setArabic(null);
      setResults([]);
      setUnavailable([]);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    toast.success("ترجمہ کاپی ہو گیا!");
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const copyEntireMatrix = () => {
    if (results.length === 0) return;
    let markdown = `### تقابلِ تراجم: ${query}\n\n`;
    if (arabic) markdown += `> ${arabic}\n\n`;
    results.forEach((r) => {
      markdown += `**${r.full_name}${r.maslak ? ` (${r.maslak})` : ""}**:\n> ${r.text}\n\n`;
    });
    navigator.clipboard.writeText(markdown);
    toast.success("مکمل موازنہ جدول کاپی ہو گیا!");
  };

  const citationLine = (r: TranslationRow): string => {
    const parts = [r.full_name];
    if (r.maslak) parts.push(r.maslak);
    let line = parts.join(" — ");
    if (r.source_url) line += ` (${r.source_url})`;
    return line;
  };

  /** Insert a single translation row as a citation blockquote and open the
   *  editor with it — same handoff pattern Translate.tsx uses for /editor. */
  const insertRowToEditor = (r: TranslationRow) => {
    const html = citationBlockquote(r.text, citationLine(r));
    navigate("/editor", { state: { content: html, source: "extract" } });
  };

  /** Insert the whole visible matrix — the Arabic passage plus every fetched
   *  translation, each as its own citation blockquote — into a fresh editor doc. */
  const insertMatrixToEditor = () => {
    if (results.length === 0) return;
    let html = "";
    if (arabic) html += citationBlockquote(arabic, query);
    results.forEach((r) => { html += citationBlockquote(r.text, citationLine(r)); });
    navigate("/editor", { state: { content: html, source: "extract" } });
  };

  const isHadith = /^\s*hadith:/i.test(query);

  const SLUG_LABELS: Record<string, string> = {
    "hadith.ur": "اردو ترجمہ",
    "hadith.en": "English",
    "hadith.ar": "عربی متن",
  };
  const unavailableNames = unavailable
    .map((slug) => translators.find((t) => t.slug === slug)?.fullName ?? SLUG_LABELS[slug] ?? slug)
    .filter(Boolean);

  return (
    <AppLayout>
      <div className="container max-w-5xl mx-auto py-6 px-4 space-y-6" dir="rtl">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Layers className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              استخراج و تقابلِ تراجم (Translation Comparison Matrix)
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            قرآنی آیات کا مختلف معتبر مترجمین کے تراجم کے ساتھ بالمقابل موازنہ — تمام تراجم معتبر مصدر (alquran.cloud) سے، بلا کسی خودساختہ متن کے۔
          </p>
        </div>

        {/* Search & Selector Card */}
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Search className="h-4 w-4 text-primary" />
              کیوری و حوالہ درج کریں
            </CardTitle>
            <CardDescription className="text-xs">
              مثالیں: <code className="bg-muted px-1.5 py-0.5 rounded dir-ltr inline-block">quran:2:255</code> یا <code className="bg-muted px-1.5 py-0.5 rounded dir-ltr inline-block">2:255</code> یا <code className="bg-muted px-1.5 py-0.5 rounded dir-ltr inline-block">hadith:bukhari:1</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="مثلاً quran:2:255"
                className="text-sm dir-ltr text-left"
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <Button onClick={handleSearch} disabled={loading || translatorsLoading} className="gap-2 shrink-0">
                <Sparkles className="h-4 w-4" />
                {loading ? "تلاش جاری..." : "تراجم برآمد کریں"}
              </Button>
            </div>

            {/* Hadith: translations come back as Arabic + Urdu + English automatically */}
            {isHadith ? (
              <div className="flex items-start gap-2 pt-2 border-t border-border text-xs text-muted-foreground">
                <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <span>حدیث کے لیے عربی متن، اردو اور انگریزی ترجمہ (HadithAPI سے) خودکار لائے جائیں گے۔ سپورٹڈ مجموعے: بخاری، مسلم، ترمذی، ابو داؤد، ابن ماجہ، نسائی، مشکاۃ، مسند احمد۔</span>
              </div>
            ) : (
            /* Translators Checklist (Quran) */
            <div className="space-y-2 pt-2 border-t border-border">
              <Label className="text-xs font-semibold text-foreground">مطلوبہ مترجمین کا انتخاب کریں:</Label>
              {translatorsLoading ? (
                <p className="text-xs text-muted-foreground">مترجمین کی فہرست لوڈ ہو رہی ہے...</p>
              ) : translators.length === 0 ? (
                <p className="text-xs text-muted-foreground">کوئی مترجم دستیاب نہیں (translators رجسٹری خالی ہے)۔</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {translators.map((t) => (
                    <div
                      key={t.slug}
                      onClick={() => toggleTranslator(t.slug)}
                      className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                        t.isSelected ? "border-primary/50 bg-primary/5" : "border-border bg-card hover:bg-muted/50"
                      }`}
                    >
                      <Checkbox checked={t.isSelected} onCheckedChange={() => toggleTranslator(t.slug)} />
                      <div className="flex flex-col">
                        <span className="font-semibold text-foreground">{t.fullName}</span>
                        {t.maslak && <span className="text-[10px] text-muted-foreground">{t.maslak}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}
          </CardContent>
        </Card>

        {/* Arabic passage */}
        {arabic && (
          <Card className="border-primary/30 bg-primary/5 shadow-sm">
            <CardContent className="py-4">
              <p className="text-2xl leading-loose text-foreground text-center font-[serif]" dir="rtl">
                {arabic}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Note (e.g. hadith not yet supported) */}
        {note && (
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{note}</span>
          </div>
        )}

        {/* Results Matrix Table */}
        {results.length > 0 && (
          <Card className="border-border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  موازنہ جدول ({results.length} تراجم)
                </CardTitle>
                <CardDescription className="text-xs">
                  حوالہ: <span className="dir-ltr inline-block font-mono text-primary">{query}</span>
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={copyEntireMatrix} className="gap-1.5 text-xs">
                  <Copy className="h-3.5 w-3.5" />
                  مکمل جدول کاپی کریں
                </Button>
                <Button size="sm" onClick={insertMatrixToEditor} className="gap-1.5 text-xs">
                  <FileEdit className="h-3.5 w-3.5" />
                  ایڈیٹر میں کھولیں
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md border border-border overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="w-[200px] text-right font-bold">مترجم (Translator)</TableHead>
                      <TableHead className="w-[140px] text-right font-bold">اسلوب / مکتبِ فکر</TableHead>
                      <TableHead className="text-right font-bold">ترجمہ (Translation)</TableHead>
                      <TableHead className="w-[110px] text-center font-bold">ایکشن</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r, idx) => (
                      <TableRow key={r.translator_slug}>
                        <TableCell className="font-semibold text-foreground text-xs">{r.full_name}</TableCell>
                        <TableCell>
                          {r.maslak && (
                            <Badge variant="outline" className="text-[10px]">
                              {r.maslak}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell
                          className="text-sm leading-relaxed text-foreground"
                          dir={r.language === "en" ? "ltr" : "rtl"}
                        >
                          {r.text}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="کاپی کریں"
                              onClick={() => copyToClipboard(r.text, idx)}
                            >
                              {copiedIndex === idx ? (
                                <Check className="h-4 w-4 text-emerald-500" />
                              ) : (
                                <Copy className="h-4 w-4 text-muted-foreground" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="ایڈیٹر میں شامل کریں"
                              onClick={() => insertRowToEditor(r)}
                            >
                              <FileEdit className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {unavailableNames.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  اس حوالے کے لیے دستیاب نہ ہونے والے مترجمین: {unavailableNames.join("، ")}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Honest empty state (no fabricated content) */}
        {searched && !loading && results.length === 0 && !note && (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            اس حوالے کے تراجم دستیاب نہیں ہوئے۔ براہِ کرم حوالہ (مثلاً <span className="dir-ltr inline-block font-mono">quran:2:255</span>) اور منتخب مترجمین دیکھ کر دوبارہ کوشش کریں۔
          </div>
        )}
      </div>
    </AppLayout>
  );
}
