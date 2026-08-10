import React, { useEffect, useState, useCallback } from 'react';
import { isDesktop } from '../../utils/environment';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { VoiceCloningDialog } from '../voice/VoiceCloningDialog';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import { translateStored, translateStoredFormat } from "@/lib/i18n";

const log = logger.child('VoiceClone');

interface SidecarState {
  installed: boolean;
  version?: string;
  modelsAvailable: string[];
}

export const AdvancedVoicesPanel: React.FC = () => {
  const [sidecar, setSidecar] = useState<SidecarState>({ installed: false, modelsAvailable: [] });
  const [loading, setLoading] = useState(false);
  const [cloningOpen, setCloningOpen] = useState(false);

  useEffect(() => {
    if (isDesktop() && window.electronAPI?.voice?.getSidecarStatus) {
      window.electronAPI.voice.getSidecarStatus().then(setSidecar).catch(console.error);
    }
  }, []);

  const handleInstall = async () => {
    if (!isDesktop() || !window.electronAPI?.voice?.installSidecar) return;
    setLoading(true);
    try {
      await window.electronAPI.voice.installSidecar();
      const status = await window.electronAPI.voice.getSidecarStatus();
      setSidecar(status);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCloneComplete = useCallback(async (blob: Blob) => {
    if (isDesktop() && window.electronAPI?.voice?.saveCloneSample) {
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const filename = `clone-${Date.now()}.webm`;
        const savedPath = await window.electronAPI.voice.saveCloneSample(arrayBuffer, filename);
        toast.success(translateStoredFormat("toast.voice.sample_saved", { filename }));
        log.info('voice sample saved', { saved: Boolean(savedPath) });
      } catch (err) {
        toast.error(translateStored("toast.voice.sample_save_failed"));
        console.error('[VoiceClone] Save failed', err);
      }
    } else {
      toast.success(translateStored("toast.voice.registration_done"));
    }
  }, []);

  if (!isDesktop()) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-xl font-bold">اعلیٰ درجے کی آوازیں (Advanced Voices)</CardTitle>
          <CardDescription>
            اعلیٰ درجے کے PyTorch صوتی انجنز صرف EasyEditor Desktop ایپ پر دستیاب ہیں۔
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-xl font-bold flex items-center justify-between">
          <span>اعلیٰ درجے کی آوازیں (Advanced Voices Add-on)</span>
          {sidecar.installed ? (
            <Badge variant="default" className="bg-green-600">فعال (Active)</Badge>
          ) : (
            <Badge variant="secondary">غیر انسٹال شدہ (Optional Add-on)</Badge>
          )}
        </CardTitle>
        <CardDescription dir="rtl">
          PyTorch پر مبنی اعلیٰ ماڈلز (Orpheus-Urdu, Habibi, Cohere Transcribe)۔ یہ ایک اختیاری Add-on ہے اور بنیادی ایپ اس کے بغیر مکمل کام کرتی ہے۔
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!sidecar.installed ? (
          <div className="p-4 border rounded-lg bg-muted space-y-3 dir-rtl">
            <p className="text-sm font-medium">Python Sidecar ماحول موجود نہیں ہے۔</p>
            <p className="text-xs text-muted-foreground">
              ماڈلز ڈاؤن لوڈ اور سیٹ اپ کرنے کے لیے بٹن دبائیں۔ یہ عمل چند منٹ لے سکتا ہے۔
            </p>
            <Button onClick={handleInstall} disabled={loading}>
              {loading ? 'سیٹ اپ ہو رہا ہے...' : 'Python Sidecar سیٹ اپ کریں'}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-3 border rounded-lg space-y-1">
              <p className="text-sm font-semibold">دستیاب پریمیم ماڈلز:</p>
              <ul className="text-xs space-y-1 text-muted-foreground list-disc list-inside">
                <li>Orpheus-Urdu (اردو پریمیم)</li>
                <li>Habibi Arabic (عربی لہجے)</li>
                <li>Cohere Transcribe Arabic (اعلیٰ عربی ٹرانسکرپشن)</li>
              </ul>
            </div>

            <div className="pt-2">
              <Button variant="outline" onClick={() => setCloningOpen(true)}>
                اپنی آواز کا اندراج (Live Voice Enrollment)
              </Button>
            </div>
          </div>
        )}

        <VoiceCloningDialog
          open={cloningOpen}
          onClose={() => setCloningOpen(false)}
          onCloneComplete={handleCloneComplete}
        />
      </CardContent>
    </Card>
  );
};
