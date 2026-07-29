import React, { useState, useEffect } from 'react';
import { Key, CheckCircle, AlertTriangle, Trash2, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export const ByokKeyPanel: React.FC = () => {
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<{ hasKey: boolean; lastFour: string | null }>({
    hasKey: false,
    lastFour: null,
  });
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchStatus = async () => {
    if (window.electronAPI?.byok) {
      try {
        const st = await window.electronAPI.byok.getKeyStatus();
        setStatus(st);
      } catch (err) {
        console.error('Failed to get key status:', err);
      }
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleSaveAndTest = async () => {
    if (!keyInput.trim()) return;
    setLoading(true);
    setFeedback(null);

    try {
      if (!window.electronAPI?.byok) {
        throw new Error('Electron API available only in Desktop mode');
      }

      // 1. Test key first
      setTesting(true);
      const testRes = await window.electronAPI.byok.testKey(keyInput.trim());
      setTesting(false);

      if (!testRes.success) {
        setFeedback({ type: 'error', message: testRes.message });
        setLoading(false);
        return;
      }

      // 2. Save encrypted key
      await window.electronAPI.byok.saveKey(keyInput.trim());
      setFeedback({ type: 'success', message: 'Gemini Key محفوظ اور تصدیق ہو چکی ہے!' });
      setKeyInput('');
      fetchStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedback({ type: 'error', message: msg });
    } finally {
      setLoading(false);
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!window.electronAPI?.byok) return;
    setLoading(true);
    setFeedback(null);
    try {
      await window.electronAPI.byok.deleteKey();
      setFeedback({ type: 'success', message: 'Gemini Key ختم کر دی گئی ہے' });
      fetchStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedback({ type: 'error', message: msg });
    } finally {
      setLoading(false);
    }
  };

  if (!window.electronAPI?.isDesktop) {
    return null;
  }

  return (
    <Card className="w-full border-primary/20 shadow-sm">
      <CardHeader dir="rtl">
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5 text-primary" />
          <CardTitle className="text-xl font-bold">Gemini API Key (BYOK)</CardTitle>
        </div>
        <CardDescription>
          اپنی Gemini API Key درج کریں۔ آپ کی کلید آپ کے کمپیوٹر پر محفوظ رہے گی اور AI درخواستیں براہِ راست آپ کے کھاتے سے کی جائیں گی۔
        </CardDescription>
      </CardHeader>
      <CardContent dir="rtl" className="space-y-4">
        {/* Status Indicator */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border">
          <span className="text-sm font-medium">حالت:</span>
          {status.hasKey ? (
            <div className="flex items-center gap-2 text-emerald-600 font-semibold text-sm">
              <CheckCircle className="h-4 w-4" />
              <span>کلید فعال (آخری 4 حروف: {status.lastFour})</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-amber-600 font-semibold text-sm">
              <AlertTriangle className="h-4 w-4" />
              <span>کوئی کلید موجود نہیں</span>
            </div>
          )}
        </div>

        {feedback && (
          <Alert variant={feedback.type === 'error' ? 'destructive' : 'default'} className="my-2">
            <AlertTitle>{feedback.type === 'error' ? 'غلطی' : 'کامران'}</AlertTitle>
            <AlertDescription>{feedback.message}</AlertDescription>
          </Alert>
        )}

        {/* Input Form */}
        <div className="space-y-2">
          <label className="text-sm font-medium">نئی Gemini Key درج کریں:</label>
          <div className="relative">
            <Input
              type={showKey ? 'text' : 'password'}
              placeholder="AIzaSy..."
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              className="pl-10 text-left font-mono"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          {status.hasKey && (
            <Button variant="outline" size="sm" onClick={handleDelete} disabled={loading} className="text-destructive border-destructive/30 hover:bg-destructive/10">
              <Trash2 className="h-4 w-4 ml-2" />
              کلید حذف کریں
            </Button>
          )}
          <Button onClick={handleSaveAndTest} disabled={loading || !keyInput.trim()} size="sm">
            {testing ? 'جانچ جاری ہے...' : loading ? 'محفوظ ہو رہا ہے...' : 'محفوظ اور تصدیق کریں'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
