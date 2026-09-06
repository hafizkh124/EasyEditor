import React, { useState, useEffect, useCallback } from 'react';
import { Key, CheckCircle, AlertTriangle, Trash2, Eye, EyeOff, ExternalLink, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { logger } from '@/lib/logger';

const log = logger.child('ByokKeyPanel');

interface ProviderInfo {
  id: string;
  label: string;
  kind: string;
  freeTier: boolean;
  getKeyUrl: string;
  keyEnvVar: string;
  toolModel: string;
  privacyNote: string | null;
  keyPattern: string;
}
interface KeyStatus { hasKey: boolean; lastFour: string | null; fromEnv?: boolean }

const EVAL_CMD = (id: string) =>
  `${id.toUpperCase()}_API_KEY=… EVAL_PROVIDER=${id} AGENT_EVAL_LIVE=1 npx vitest run src/test/agentEval.live.test.ts`;

export const ByokKeyPanel: React.FC = () => {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [active, setActive] = useState<string>('gemini');
  const [verified, setVerified] = useState<string[]>(['gemini']);
  const [statuses, setStatuses] = useState<Record<string, KeyStatus>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [clipboardHint, setClipboardHint] = useState<string | null>(null);

  const api = typeof window !== 'undefined' ? window.electronAPI?.byok : undefined;

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const list = await api.listProviders();
      const state = await api.providerState();
      setProviders(list);
      setActive(state.active);
      setVerified(state.verified);
      const st: Record<string, KeyStatus> = {};
      await Promise.all(list.map(async (p) => { st[p.id] = await api.getKeyStatus(p.id); }));
      setStatuses(st);
    } catch (err) {
      log.error('failed to load provider config', { err });
    }
  }, [api]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Clipboard auto-detect: on focus, if the clipboard holds something shaped
  // like a provider key we don't have yet, offer to paste it.
  useEffect(() => {
    if (!api || providers.length === 0) return;
    const check = async () => {
      try {
        const text = (await navigator.clipboard.readText()).trim();
        if (!text) return;
        const match = providers.find((p) => new RegExp(p.keyPattern).test(text) && !statuses[p.id]?.hasKey);
        if (match && drafts[match.id] !== text) {
          setDrafts((d) => ({ ...d, [match.id]: text }));
          setClipboardHint(`کلپ بورڈ سے ${match.label} کی key بھر دی گئی — تصدیق کر کے محفوظ کریں۔`);
        }
      } catch { /* clipboard blocked — ignore */ }
    };
    window.addEventListener('focus', check);
    void check();
    return () => window.removeEventListener('focus', check);
  }, [api, providers, statuses, drafts]);

  if (typeof window === 'undefined' || !window.electronAPI?.isDesktop || !api) return null;

  const saveAndTest = async (id: string) => {
    const key = (drafts[id] ?? '').trim();
    if (!key) return;
    setBusy(id); setFeedback(null); setClipboardHint(null);
    try {
      const test = await api.testKey(key, id);
      if (!test.success) { setFeedback({ type: 'error', message: test.message }); return; }
      await api.saveKey(key, id);
      setFeedback({ type: 'success', message: `${providers.find((p) => p.id === id)?.label} key محفوظ اور تصدیق ہو گئی۔` });
      setDrafts((d) => ({ ...d, [id]: '' }));
      await refresh();
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally { setBusy(null); }
  };

  const remove = async (id: string) => {
    setBusy(id); setFeedback(null);
    try {
      await api.deleteKey(id);
      await refresh();
    } finally { setBusy(null); }
  };

  const selectActive = async (id: string) => {
    setFeedback(null);
    try {
      await api.setActiveProvider(id);
      await refresh();
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const toggleVerified = async (id: string, next: boolean) => {
    try {
      await api.markProviderVerified(id, next);
      await refresh();
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <Card className="w-full border-primary/20 shadow-sm">
      <CardHeader dir="rtl">
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5 text-primary" />
          <CardTitle className="text-xl font-bold">AI ماڈل پرووائیڈر (BYOK)</CardTitle>
        </div>
        <CardDescription>
          ہر کلید آپ کے کمپیوٹر پر انکرپٹ ہو کر محفوظ رہتی ہے۔ ایجنٹ اُسی پرووائیڈر پر چلتا ہے جو یہاں منتخب ہو۔
          Gemini کے سوا کوئی بھی پرووائیڈر تب تک منتخب نہیں ہو سکتا جب تک وہ اِس مشین پر ایجنٹ eval پاس نہ کر لے۔
        </CardDescription>
      </CardHeader>
      <CardContent dir="rtl" className="space-y-4">
        {feedback && (
          <Alert variant={feedback.type === 'error' ? 'destructive' : 'default'}>
            <AlertTitle>{feedback.type === 'error' ? 'غلطی' : 'کامیاب'}</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">{feedback.message}</AlertDescription>
          </Alert>
        )}
        {clipboardHint && (
          <Alert>
            <Sparkles className="h-4 w-4" />
            <AlertDescription>{clipboardHint}</AlertDescription>
          </Alert>
        )}

        {providers.map((p) => {
          const st = statuses[p.id] ?? { hasKey: false, lastFour: null };
          const isActive = active === p.id;
          const isVerified = verified.includes(p.id);
          return (
            <div key={p.id} className={`rounded-lg border p-3 space-y-3 ${isActive ? 'border-primary bg-primary/5' : 'bg-muted/60'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="active-provider"
                    checked={isActive}
                    onChange={() => selectActive(p.id)}
                    aria-label={`${p.label} کو فعال کریں`}
                  />
                  <span className="font-semibold text-sm">{p.label}</span>
                  {p.freeTier && <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">مفت tier</span>}
                  {isVerified ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-600"><ShieldCheck className="h-3.5 w-3.5" />تصدیق شدہ</span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-amber-600"><AlertTriangle className="h-3.5 w-3.5" />غیر تصدیق شدہ</span>
                  )}
                </div>
                {st.hasKey ? (
                  <span className="flex items-center gap-1 text-xs text-emerald-600">
                    <CheckCircle className="h-3.5 w-3.5" />
                    {st.fromEnv ? 'env سے' : `…${st.lastFour}`}
                  </span>
                ) : (
                  <a
                    href={p.getKeyUrl}
                    onClick={(e) => { e.preventDefault(); void window.electronAPI?.openExternal(p.getKeyUrl); }}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />کلید حاصل کریں
                  </a>
                )}
              </div>

              {p.privacyNote && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded p-2 leading-relaxed">{p.privacyNote}</p>
              )}

              <div className="relative">
                <Input
                  type={showKey[p.id] ? 'text' : 'password'}
                  placeholder={p.id === 'gemini' ? 'AIzaSy…' : p.id === 'groq' ? 'gsk_…' : 'sk-or-v1-…'}
                  value={drafts[p.id] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                  className="ps-10 text-left font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => ({ ...s, [p.id]: !s[p.id] }))}
                  className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="کلید دکھائیں"
                >
                  {showKey[p.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {st.hasKey && !st.fromEnv && (
                    <Button variant="outline" size="sm" onClick={() => remove(p.id)} disabled={busy === p.id}
                      className="text-destructive border-destructive/30 hover:bg-destructive/10">
                      <Trash2 className="h-4 w-4 ml-1" />حذف
                    </Button>
                  )}
                  <Button size="sm" onClick={() => saveAndTest(p.id)} disabled={busy === p.id || !(drafts[p.id] ?? '').trim()}>
                    {busy === p.id ? 'جانچ…' : 'محفوظ و تصدیق'}
                  </Button>
                </div>
                {p.id !== 'gemini' && (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input type="checkbox" checked={isVerified} onChange={(e) => toggleVerified(p.id, e.target.checked)} />
                    eval پاس ہو گیا — تصدیق شدہ کے طور پر نشان زد کریں
                  </label>
                )}
              </div>

              {p.id !== 'gemini' && !isVerified && (
                <p className="text-xs text-muted-foreground">
                  منتخب کرنے سے پہلے یہ چلائیں، اور 9/9 پاس دیکھیں:
                  <code className="block mt-1 bg-muted rounded p-1.5 text-left font-mono text-xs overflow-x-auto" dir="ltr">{EVAL_CMD(p.id)}</code>
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};
