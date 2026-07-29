import React, { useEffect, useState, useCallback } from 'react';
import { getAvailableEngines, getPreferredEngine, setPreferredEngine } from '../../core/voice/registry';
import { isDesktop } from '../../utils/environment';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Progress } from '../ui/progress';
import { VoiceModelInfo, ModelDownloadProgress } from '../../core/voice/types';

export const VoiceEnginePanel: React.FC = () => {
  const [urEngine, setUrEngine] = useState<string>('piper');
  const [arEngine, setArEngine] = useState<string>('piper');
  const [models, setModels] = useState<VoiceModelInfo[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});

  useEffect(() => {
    setUrEngine(getPreferredEngine('ur-PK'));
    setArEngine(getPreferredEngine('ar'));

    if (isDesktop() && window.electronAPI?.voice) {
      window.electronAPI.voice.getModels().then(setModels).catch(console.error);
    }
  }, []);

  useEffect(() => {
    if (!isDesktop() || !window.electronAPI?.voice?.onDownloadProgress) return;
    const unsub = window.electronAPI.voice.onDownloadProgress((p: ModelDownloadProgress) => {
      setDownloadProgress((prev) => ({ ...prev, [p.modelId]: p.percent }));
    });
    return unsub;
  }, []);

  const handleDownload = useCallback(async (modelId: string) => {
    if (!isDesktop() || !window.electronAPI?.voice) return;
    setDownloadingId(modelId);
    setDownloadProgress((prev) => ({ ...prev, [modelId]: 0 }));
    try {
      await window.electronAPI.voice.downloadModel(modelId);
      const updated = await window.electronAPI.voice.getModels();
      setModels(updated);
      setDownloadProgress((prev) => ({ ...prev, [modelId]: 100 }));
    } catch (err) {
      console.error('Download failed', err);
    } finally {
      setDownloadingId(null);
    }
  }, []);

  const handleUrChange = (val: string) => {
    setUrEngine(val);
    setPreferredEngine('ur-PK', val);
  };

  const handleArChange = (val: string) => {
    setArEngine(val);
    setPreferredEngine('ar', val);
  };

  const handleDelete = async (modelId: string) => {
    if (!isDesktop() || !window.electronAPI?.voice) return;
    try {
      await window.electronAPI.voice.deleteModel(modelId);
      const updated = await window.electronAPI.voice.getModels();
      setModels(updated);
    } catch (err) {
      console.error('Delete failed', err);
    }
  };

  const available = getAvailableEngines();

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-xl font-bold">مقامی وائس اسٹوڈیو (Local Voice Studio)</CardTitle>
        <CardDescription>
          صوتی انجن، ترجیحات اور ماڈلز کو یہاں سے ترتیب دیں۔
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">اردو صوتی انجن (Urdu Voice Engine)</label>
            <Select value={urEngine} onValueChange={handleUrChange}>
              <SelectTrigger>
                <SelectValue placeholder="انجن منتخب کریں" />
              </SelectTrigger>
              <SelectContent>
                {available.tts.map((id) => (
                  <SelectItem key={id} value={id}>
                    {id === 'piper' ? 'Piper (آف لائن / مقامی)' : id === 'edge-tts' ? 'Edge TTS (آن لائن)' : id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">عربی صوتی انجن (Arabic Voice Engine)</label>
            <Select value={arEngine} onValueChange={handleArChange}>
              <SelectTrigger>
                <SelectValue placeholder="انجن منتخب کریں" />
              </SelectTrigger>
              <SelectContent>
                {available.tts.map((id) => (
                  <SelectItem key={id} value={id}>
                    {id === 'piper' ? 'Piper (آف لائن / مقامی)' : id === 'edge-tts' ? 'Edge TTS (آن لائن)' : id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isDesktop() && (
          <div className="space-y-4 pt-4 border-t">
            <h4 className="text-md font-semibold">مقامی ماڈل مینیجر (Model Manager)</h4>
            <div className="space-y-3">
              {models.map((model) => {
                const progress = downloadProgress[model.id];
                const isDownloading = downloadingId === model.id;
                return (
                  <div key={model.id} className="p-3 border rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{model.name}</p>
                        <p className="text-xs text-muted-foreground">
                          زبانیں: {model.langs.join(', ')} | سائز: {(model.sizeBytes / (1024 * 1024)).toFixed(1)} MB
                        </p>
                      </div>
                      <div>
                        {model.downloaded ? (
                          <Button variant="outline" size="sm" onClick={() => handleDelete(model.id)}>
                            حذف کریں
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={isDownloading}
                            onClick={() => handleDownload(model.id)}
                          >
                            {isDownloading ? 'ڈاؤن لوڈ ہو رہا ہے...' : 'ڈاؤن لوڈ'}
                          </Button>
                        )}
                      </div>
                    </div>
                    {isDownloading && typeof progress === 'number' && (
                      <Progress value={progress} className="h-2" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
