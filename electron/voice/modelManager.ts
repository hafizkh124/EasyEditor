import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { VoiceModelInfo, ModelDownloadProgress } from '@/core/voice/types';

export interface CatalogModelEntry {
  id: string;
  name: string;
  engine: 'whisper' | 'piper';
  langs: string[];
  sizeBytes: number;
  url: string;
  filename: string;
}

export const MODEL_CATALOG: CatalogModelEntry[] = [
  {
    id: 'whisper-small',
    name: 'Whisper Small',
    engine: 'whisper',
    langs: ['ur', 'ar', 'en'],
    sizeBytes: 466 * 1024 * 1024,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    filename: 'ggml-small.bin',
  },
  {
    id: 'whisper-large-v3-turbo',
    name: 'Whisper Large v3 Turbo',
    engine: 'whisper',
    langs: ['ur', 'ar', 'en'],
    sizeBytes: 1600 * 1024 * 1024,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin',
    filename: 'ggml-large-v3-turbo.bin',
  },
  {
    id: 'piper-ur_PK-male-medium',
    name: 'Piper Urdu Male Medium',
    engine: 'piper',
    langs: ['ur-PK', 'ur'],
    sizeBytes: 60 * 1024 * 1024,
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/ur/ur_PK/male/medium/ur_PK-male-medium.onnx',
    filename: 'ur_PK-male-medium.onnx',
  },
  {
    id: 'piper-ar_JO-kareem',
    name: 'Piper Arabic Kareem Medium',
    engine: 'piper',
    langs: ['ar'],
    sizeBytes: 60 * 1024 * 1024,
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx',
    filename: 'ar_JO-kareem-medium.onnx',
  },
];

export function getModelsDir(): string {
  return path.join(app.getPath('userData'), 'models');
}

export function getModelPath(modelId: string): string | null {
  const entry = MODEL_CATALOG.find((m) => m.id === modelId);
  if (!entry) return null;
  const targetPath = path.join(getModelsDir(), entry.filename);
  if (fs.existsSync(targetPath)) {
    return targetPath;
  }
  return null;
}

export async function listModels(): Promise<VoiceModelInfo[]> {
  const dir = getModelsDir();
  return MODEL_CATALOG.map((entry) => {
    const filePath = path.join(dir, entry.filename);
    const downloaded = fs.existsSync(filePath);
    return {
      id: entry.id,
      name: entry.name,
      engine: entry.engine,
      langs: entry.langs,
      sizeBytes: entry.sizeBytes,
      downloaded,
      path: downloaded ? filePath : undefined,
    };
  });
}

export async function downloadModel(
  modelId: string,
  onProgress?: (progress: ModelDownloadProgress) => void,
): Promise<string> {
  const entry = MODEL_CATALOG.find((m) => m.id === modelId);
  if (!entry) {
    throw new Error(`Model not found in catalog: ${modelId}`);
  }
  const dir = getModelsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const targetPath = path.join(dir, entry.filename);

  if (fs.existsSync(targetPath)) {
    if (onProgress) {
      onProgress({ modelId, downloadedBytes: entry.sizeBytes, totalBytes: entry.sizeBytes, percent: 100 });
    }
    return targetPath;
  }

  const tempPath = targetPath + '.download';
  const response = await fetch(entry.url);

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText} for ${entry.url}`);
  }

  const contentLength = response.headers.get('content-length');
  const totalBytes = contentLength ? parseInt(contentLength, 10) : entry.sizeBytes;
  const reader = response.body!.getReader();
  const writer = fs.createWriteStream(tempPath);
  let downloadedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(Buffer.from(value));
      downloadedBytes += value.length;
      if (onProgress) {
        onProgress({
          modelId,
          downloadedBytes,
          totalBytes,
          percent: Math.round((downloadedBytes / totalBytes) * 100),
        });
      }
    }
  } finally {
    writer.close();
  }

  fs.renameSync(tempPath, targetPath);

  if (onProgress) {
    onProgress({ modelId, downloadedBytes: totalBytes, totalBytes, percent: 100 });
  }

  return targetPath;
}

export async function deleteModel(modelId: string): Promise<void> {
  const modelPath = getModelPath(modelId);
  if (modelPath && fs.existsSync(modelPath)) {
    await fs.promises.unlink(modelPath);
  }
}
