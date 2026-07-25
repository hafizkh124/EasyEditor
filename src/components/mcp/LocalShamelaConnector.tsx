import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle, RefreshCw, AlertCircle, HardDrive, HelpCircle, FileText } from "lucide-react";
import { useLocalShamela } from "@/hooks/useLocalShamela";
import { ShamelaGuideModal } from "./ShamelaGuideModal";

export function LocalShamelaConnector() {
  const {
    mcpUrl,
    setMcpUrl,
    connected,
    downloadedBooks,
    notes,
    testing,
    testConnection,
  } = useLocalShamela();

  const [guideOpen, setGuideOpen] = useState(false);

  const handleTestConnection = async () => {
    const res = await testConnection();
    if (res && res.status === "ok") {
      const count = res.downloaded_books ?? 0;
      toast.success(`مقامی مکتبہ شاملہ MCP سے کنکشن کامیاب رہا! (${count.toLocaleString()} کتب دستیاب ہیں)`);
    } else {
      toast.error("مقامی MCP برج سرور سے جواب حاصل نہیں ہوا۔ براہِ کرم چیک کریں کہ local bridge آن ہے۔");
    }
  };

  return (
    <>
      <Card dir="rtl" className="border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-primary" />
              Connect Local Shamela 4 MCP (آف لائن مکتبہ شاملہ)
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setGuideOpen(true)}
              className="text-xs gap-1.5 h-8 border-primary/40 text-primary hover:bg-primary/5"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              انسٹالیشن گائیڈ (ہدایات)
            </Button>
          </div>
          <CardDescription className="text-xs mt-1">
            ڈیسک ٹاپ صارفین کے لیے 40,000 کتب کا آف لائن Lucene/SQLite انڈیکس کنیکٹر (D:\shamela-mcp-1.2.0)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Input
              value={mcpUrl}
              onChange={(e) => setMcpUrl(e.target.value)}
              placeholder="http://127.0.0.1:8000"
              className="text-xs ltr font-mono"
            />
            <Button size="sm" onClick={handleTestConnection} disabled={testing} className="gap-1.5 shrink-0">
              {testing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
              {testing ? "جانچ جاری ہے..." : "ٹیسٹ کنکشن"}
            </Button>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/20">
            <div className="flex items-center gap-2 text-xs">
              {connected ? (
                <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
              )}
              <span className="font-medium">
                {connected
                  ? downloadedBooks != null
                    ? `منسلک — ${downloadedBooks.toLocaleString()} کتب دستیاب ہیں (ڈاؤن لوڈ شدہ)`
                    : "منسلک — (برج سرور فعال ہے)"
                  : "غیر منسلک (Offline)"}
              </span>
            </div>
            <Badge variant={connected ? "default" : "outline"} className="text-[10px]">
              {connected ? "Active Local Tier-2" : "Disconnected"}
            </Badge>
          </div>

          {/* Diagnostic notes if present */}
          {connected && notes.length > 0 && (
            <div className="text-[11px] text-muted-foreground p-2.5 rounded border border-border/60 bg-muted/40 space-y-1">
              <span className="font-semibold text-foreground flex items-center gap-1">
                <FileText className="h-3.5 w-3.5 text-primary" />
                سرور کی تشخیصی رپورٹس:
              </span>
              <ul className="list-disc list-inside space-y-0.5" dir="rtl">
                {notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Interactive Step-by-Step Guide Modal */}
      <ShamelaGuideModal open={guideOpen} onOpenChange={setGuideOpen} />
    </>
  );
}
