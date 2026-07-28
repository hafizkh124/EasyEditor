import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Search, Sparkles, Layers } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isRtlText } from "@/utils/textUtils";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { TranslationMatrixTable, type TranslationRow } from "./TranslationMatrixTable";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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


export const ExtractPanel = () => {
  const navigate = useNavigate();
  const workspaceCtx = useOptionalWorkspace();

  const [query, setQuery] = useState("quran:2:255");
  const [translators, setTranslators] = useState<TranslatorOption[]>([]);
  const [translatorsLoading, setTranslatorsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [arabic, setArabic] = useState<string | null>(null);
  const [results, setResults] = useState<TranslationRow[]>([]);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [, setNote] = useState<string | null>(null);
  const [, setSearched] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

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
        const defaultSlugs = new Set(["ur.junagarhi", "ur.jalandhari", "ur.taqiusmani", "ur.kanzuliman", "ur.maududi"]);
        setTranslators(
          data.map((t) => ({
            slug: t.slug,
            fullName: t.full_name,
            language: t.language,
            maslak: t.maslak,
            isSelected: defaultSlugs.has(t.slug),
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
    if (/^\d+:\d+$/.test(passageKey)) {
      passageKey = `quran:${passageKey}`;
    }
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

  const insertRowToEditor = (r: TranslationRow) => {
    const html = citationBlockquote(r.text, citationLine(r));
    if (workspaceCtx) {
      workspaceCtx.insertIntoCanvas(html);
      toast.success("Canvas میں داخل کر دیا گیا");
    } else {
      navigate("/editor", { state: { content: html, source: "extract" } });
    }
  };

  const insertMatrixToEditor = () => {
    if (results.length === 0) return;
    let html = "";
    if (arabic) html += citationBlockquote(arabic, query);
    results.forEach((r) => { html += citationBlockquote(r.text, citationLine(r)); });
    if (workspaceCtx) {
      workspaceCtx.insertIntoCanvas(html);
      toast.success("Canvas میں داخل کر دیا گیا");
    } else {
      navigate("/editor", { state: { content: html, source: "extract" } });
    }
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
    <div className="flex flex-col h-full overflow-y-auto p-4 space-y-4 bg-background" dir="rtl">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold tracking-tight text-foreground">
            استخراج و تقابلِ تراجم
          </h2>
        </div>
        <p className="text-xs text-muted-foreground">
          آیات و احادیث کا مختلف معتبر تراجم کے ساتھ بالمقابل موازنہ۔
        </p>
      </div>

      <Card className="border-border shadow-sm">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
            <Search className="h-3.5 w-3.5 text-primary" />
            کیوری و حوالہ درج کریں
          </CardTitle>
          <CardDescription className="text-[11px]">
            مثالیں: <code className="bg-muted px-1 py-0.5 rounded dir-ltr inline-block text-[10px]">quran:2:255</code> یا <code className="bg-muted px-1 py-0.5 rounded dir-ltr inline-block text-[10px]">hadith:bukhari:1</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-3">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="مثلاً quran:2:255"
              className="text-xs dir-ltr text-left h-8"
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <Button onClick={handleSearch} disabled={loading || translatorsLoading} size="sm" className="gap-1 shrink-0 h-8 text-xs">
              <Sparkles className="h-3.5 w-3.5" />
              {loading ? "تلاش..." : "برآمد کریں"}
            </Button>
          </div>

          {!isHadith && (
            <div className="space-y-1.5 pt-2 border-t border-border">
              <Label className="text-[11px] font-semibold text-foreground">مترجمین:</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-36 overflow-y-auto">
                {translators.map((t) => (
                  <div
                    key={t.slug}
                    onClick={() => toggleTranslator(t.slug)}
                    className={`flex items-center gap-1.5 p-1.5 rounded border text-[11px] cursor-pointer transition-colors ${
                      t.isSelected ? "border-primary/50 bg-primary/5" : "border-border bg-card"
                    }`}
                  >
                    <Checkbox checked={t.isSelected} onCheckedChange={() => toggleTranslator(t.slug)} />
                    <span className="font-medium truncate">{t.fullName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {arabic && (
        <Card className="border-primary/30 bg-primary/5 shadow-sm">
          <CardContent className="p-3 text-center">
            <p className="text-lg leading-relaxed text-foreground font-[serif]" dir="rtl">
              {arabic}
            </p>
          </CardContent>
        </Card>
      )}

      {results.length > 0 && (
        <TranslationMatrixTable
          results={results}
          unavailableNames={unavailableNames}
          copiedIndex={copiedIndex}
          onCopyRow={copyToClipboard}
          onInsertRow={insertRowToEditor}
          onCopyAll={copyEntireMatrix}
          onInsertAll={insertMatrixToEditor}
        />
      )}
    </div>
  );
};
