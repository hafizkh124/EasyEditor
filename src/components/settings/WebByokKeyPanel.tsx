import React, { useState, useEffect, useCallback } from "react";
import { Key, CheckCircle, ExternalLink, Trash2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { callEdgeFunction } from "@/core/ai/aiAdapter";
import { useLanguage } from "@/contexts/LanguageContext";
import { logger } from "@/lib/logger";

const log = logger.child("WebByokKeyPanel");

type ProviderId = "gemini" | "groq" | "openrouter";

interface WebProviderInfo {
  id: ProviderId;
  label: string;
  placeholder: string;
  getKeyUrl: string;
}

// Display-only — the server (_shared/providerRegistry.ts) is the source of
// truth for what actually gets called; this is just labels/links/hints.
const WEB_PROVIDERS: WebProviderInfo[] = [
  { id: "gemini", label: "Google Gemini", placeholder: "AIzaSy…", getKeyUrl: "https://aistudio.google.com/apikey" },
  { id: "groq", label: "Groq", placeholder: "gsk_…", getKeyUrl: "https://console.groq.com/keys" },
  { id: "openrouter", label: "OpenRouter", placeholder: "sk-or-v1-…", getKeyUrl: "https://openrouter.ai/keys" },
];

interface KeyStatus { hasKey: boolean; lastFour: string | null }
type StatusMap = Record<ProviderId, KeyStatus>;

const EMPTY_STATUS: StatusMap = {
  gemini: { hasKey: false, lastFour: null },
  groq: { hasKey: false, lastFour: null },
  openrouter: { hasKey: false, lastFour: null },
};

/**
 * M10 Phase 2.5.3 — the web BYOK panel. A deliberately simpler UI than
 * desktop's ByokKeyPanel.tsx: one provider at a time (a dropdown), one key
 * field, Save/Test/Delete — no per-role (agent-loop/text/critic) split and
 * no eval-verification gate, per the user's own scoped-down choice for this
 * first web version. The server (agent-model) picks whichever provider row
 * was saved/updated most recently as "the" active one.
 */
export const WebByokKeyPanel: React.FC = () => {
  const { t } = useLanguage();
  const [provider, setProvider] = useState<ProviderId>("gemini");
  const [statuses, setStatuses] = useState<StatusMap>(EMPTY_STATUS);
  const [draft, setDraft] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { data, error } = await callEdgeFunction("byok-keys", { action: "status" });
      if (error) throw new Error(error.message);
      setStatuses({ ...EMPTY_STATUS, ...(data as Partial<StatusMap>) });
    } catch (err) {
      log.error("failed to load key status", { err });
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const info = WEB_PROVIDERS.find((p) => p.id === provider)!;
  const status = statuses[provider];

  const saveAndTest = async () => {
    const key = draft.trim();
    if (!key) return;
    setBusy(true);
    setFeedback(null);
    try {
      const test = await callEdgeFunction("byok-keys", { action: "test", provider, key });
      if (test.error) throw new Error(test.error.message);
      const testBody = test.data as { success: boolean; message: string };
      if (!testBody.success) {
        setFeedback({ type: "error", message: testBody.message });
        return;
      }
      const save = await callEdgeFunction("byok-keys", { action: "save", provider, key });
      if (save.error) throw new Error(save.error.message);
      setFeedback({ type: "success", message: t("byok.web.saved", "{label} key محفوظ اور تصدیق ہو گئی۔").replace("{label}", info.label) });
      setDraft("");
      await refresh();
    } catch (err) {
      setFeedback({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const { error } = await callEdgeFunction("byok-keys", { action: "delete", provider });
      if (error) throw new Error(error.message);
      await refresh();
    } catch (err) {
      setFeedback({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return null;

  return (
    <Card className="w-full border-primary/20 shadow-sm">
      <CardHeader dir="rtl">
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5 text-primary" />
          <CardTitle className="text-xl font-bold">{t("byok.web.title", "AI ماڈل کی اپنی کلید (BYOK)")}</CardTitle>
        </div>
        <CardDescription>
          {t(
            "byok.web.description",
            "اپنی مفت Gemini/Groq/OpenRouter کلید یہاں محفوظ کریں تاکہ ایجنٹ آپ کی اپنی کلید سے چلے — کوئی ٹوکن خرچ نہیں ہوگا۔ کلید ہمارے سرور پر انکرپٹ ہو کر محفوظ رہتی ہے، براؤزر کو کبھی واپس نہیں بھیجی جاتی۔",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent dir="rtl" className="space-y-4">
        {feedback && (
          <Alert variant={feedback.type === "error" ? "destructive" : "default"}>
            <AlertTitle>{feedback.type === "error" ? t("byok.web.error", "غلطی") : t("byok.web.success", "کامیاب")}</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">{feedback.message}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-2">
          <Select value={provider} onValueChange={(v) => { setProvider(v as ProviderId); setFeedback(null); setDraft(""); }}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEB_PROVIDERS.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {status.hasKey ? (
            <span className="flex items-center gap-1 text-xs text-emerald-600">
              <CheckCircle className="h-3.5 w-3.5" />
              {t("byok.web.saved_as", "محفوظ — …{last4}").replace("{last4}", status.lastFour ?? "")}
            </span>
          ) : (
            <a
              href={info.getKeyUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />{t("byok.web.get_key", "کلید حاصل کریں")}
            </a>
          )}
        </div>

        <div className="relative">
          <Input
            type={showKey ? "text" : "password"}
            placeholder={info.placeholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="ps-10 text-left font-mono"
          />
          <button
            type="button"
            onClick={() => setShowKey((s) => !s)}
            className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={t("byok.web.show_key", "کلید دکھائیں")}
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {status.hasKey && (
            <Button variant="outline" size="sm" onClick={remove} disabled={busy}
              className="text-destructive border-destructive/30 hover:bg-destructive/10">
              <Trash2 className="h-4 w-4 ml-1" />{t("byok.web.delete", "حذف")}
            </Button>
          )}
          <Button size="sm" onClick={saveAndTest} disabled={busy || !draft.trim()}>
            {busy ? t("byok.web.checking", "جانچ…") : t("byok.web.save_and_test", "محفوظ و تصدیق")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
