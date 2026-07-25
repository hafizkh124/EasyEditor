import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle, RefreshCw, AlertCircle, HardDrive } from "lucide-react";

export function LocalShamelaConnector() {
  const [mcpUrl, setMcpUrl] = useState("http://localhost:8000");
  const [testing, setTesting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [bookCount, setBookCount] = useState<number | null>(null);

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const res = await fetch(`${mcpUrl}/health`, { method: "GET" }).catch(() => null);
      if (res && res.ok) {
        const data = await res.json();
        setConnected(true);
        setBookCount(data.total_books ?? null);
        toast.success("مقامی مکتبہ شاملہ MCP سے کنکشن کامیاب رہا!");
      } else {
        setConnected(false);
        toast.error("مقامی MCP برج کاؤنٹر سے جواب حاصل نہیں ہوا۔ براہِ کرم چیک کریں کہ local bridge آن ہے۔");
      }
    } catch (err) {
      console.error(err);
      setConnected(false);
      toast.error("کنکشن کی جانچ کے دوران خرابی پیش آئی۔");
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card dir="rtl" className="border-border">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <HardDrive className="h-5 w-5 text-primary" />
          Connect Local Shamela 4 MCP (آف لائن مکتبہ شاملہ)
        </CardTitle>
        <CardDescription>
          ڈیسک ٹاپ صارفین کے لیے 40,000 کتب کا آف لائن Lucene/SQLite انڈیکس کنیکٹر (D:\shamela-mcp-1.2.0.mcpb)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Input
            value={mcpUrl}
            onChange={(e) => setMcpUrl(e.target.value)}
            placeholder="http://localhost:8000"
            className="text-xs ltr font-mono"
          />
          <Button size="sm" onClick={handleTestConnection} disabled={testing}>
            {testing ? <RefreshCw className="h-3.5 w-3.5 animate-spin ml-1" /> : "ٹیسٹ کنکشن"}
          </Button>
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/20">
          <div className="flex items-center gap-2 text-xs">
            {connected ? (
              <CheckCircle className="h-4 w-4 text-emerald-600" />
            ) : (
              <AlertCircle className="h-4 w-4 text-amber-500" />
            )}
            <span className="font-medium">
              {connected
                ? bookCount != null
                  ? `منسلک — ${bookCount.toLocaleString()} کتب دستیاب ہیں`
                  : "منسلک — (برج نے کتب کی تعداد نہیں بتائی)"
                : "غیر منسلک (Offline)"}
            </span>
          </div>
          <Badge variant={connected ? "default" : "outline"} className="text-[10px]">
            {connected ? "Active Local Tier-2" : "Disconnected"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
