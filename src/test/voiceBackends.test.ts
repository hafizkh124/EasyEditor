// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MODEL_CATALOG } from '../../electron/voice/modelManager';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test-user-data',
  },
}));

describe('Voice Model Catalog', () => {
  it('contains piper Urdu and Arabic models', () => {
    const piperModels = MODEL_CATALOG.filter((m) => m.engine === 'piper');
    expect(piperModels.length).toBeGreaterThanOrEqual(2);
    const urduModel = piperModels.find((m) => m.langs.includes('ur'));
    expect(urduModel).toBeDefined();
    expect(urduModel!.filename).toMatch(/\.onnx$/);
    const arabicModel = piperModels.find((m) => m.langs.includes('ar'));
    expect(arabicModel).toBeDefined();
    expect(arabicModel!.filename).toMatch(/\.onnx$/);
  });

  it('contains whisper models', () => {
    const whisperModels = MODEL_CATALOG.filter((m) => m.engine === 'whisper');
    expect(whisperModels.length).toBeGreaterThanOrEqual(2);
    expect(whisperModels.every((m) => m.filename.endsWith('.bin'))).toBe(true);
  });

  it('every model has a valid URL', () => {
    for (const model of MODEL_CATALOG) {
      expect(model.url).toMatch(/^https:\/\//);
    }
  });

  it('every model has positive sizeBytes', () => {
    for (const model of MODEL_CATALOG) {
      expect(model.sizeBytes).toBeGreaterThan(0);
    }
  });
});

describe('ModelManager (mocked electron)', () => {
  it('getModelsDir returns a non-empty path', async () => {
    const { getModelsDir } = await import('../../electron/voice/modelManager');
    const dir = getModelsDir();
    expect(dir).toBeTruthy();
    expect(typeof dir).toBe('string');
  });

  it('listModels returns all catalog entries with downloaded=false', async () => {
    const { listModels } = await import('../../electron/voice/modelManager');
    const models = await listModels();
    expect(models.length).toBe(MODEL_CATALOG.length);
    expect(models.every((m) => m.downloaded === false)).toBe(true);
    expect(models.every((m) => m.id && m.name && m.engine)).toBe(true);
  });

  it('getModelPath returns null for unknown model', async () => {
    const { getModelPath } = await import('../../electron/voice/modelManager');
    expect(getModelPath('non-existent-model')).toBeNull();
  });

  it('deleteModel does not throw for non-existent model', async () => {
    const { deleteModel } = await import('../../electron/voice/modelManager');
    await expect(deleteModel('non-existent-model')).resolves.toBeUndefined();
  });
});

describe('EdgeTts voice resolution', () => {
  it('maps Urdu to ur-PK-AsadNeural', async () => {
    const { EdgeTts } = await import('../../electron/voice/edgeTts');
    const instance = new EdgeTts();
    const voice = (instance as any).resolveVoice('ur');
    expect(voice).toBe('ur-PK-AsadNeural');
  });

  it('maps Arabic to ar-SA-HamedNeural', async () => {
    const { EdgeTts } = await import('../../electron/voice/edgeTts');
    const instance = new EdgeTts();
    const voice = (instance as any).resolveVoice('ar');
    expect(voice).toBe('ar-SA-HamedNeural');
  });

  it('maps English to en-US-AriaNeural', async () => {
    const { EdgeTts } = await import('../../electron/voice/edgeTts');
    const instance = new EdgeTts();
    const voice = (instance as any).resolveVoice('en');
    expect(voice).toBe('en-US-AriaNeural');
  });

  it('falls back to en-US-AriaNeural for unknown lang', async () => {
    const { EdgeTts } = await import('../../electron/voice/edgeTts');
    const instance = new EdgeTts();
    const voice = (instance as any).resolveVoice('fr');
    expect(voice).toBe('en-US-AriaNeural');
  });

  it('throws when consent is false', async () => {
    const { EdgeTts } = await import('../../electron/voice/edgeTts');
    const instance = new EdgeTts(false);
    await expect(instance.synthesize('hello', 'en')).rejects.toThrow('User consent is required');
  });
});

describe('PiperTts', () => {
  it('throws when voiceModelPath is empty', async () => {
    const { PiperTts } = await import('../../electron/voice/piper');
    const instance = new PiperTts();
    await expect(instance.synthesize('hello', '')).rejects.toThrow('voiceModelPath is required');
  });
});

describe('WhisperStt', () => {
  it('throws when modelPath is empty', async () => {
    const { WhisperStt } = await import('../../electron/voice/whisper');
    const instance = new WhisperStt();
    await expect(instance.transcribe('/audio.wav', 'ur', '')).rejects.toThrow('کوئی Whisper ماڈل منتخب نہیں ہے');
  });

  it('throws when the model file is missing', async () => {
    const { WhisperStt } = await import('../../electron/voice/whisper');
    const instance = new WhisperStt();
    await expect(
      instance.transcribe('/nonexistent/audio.wav', 'ur', '/nonexistent/model.bin'),
    ).rejects.toThrow('Whisper ماڈل نہیں ملا');
  });

  it('throws when audio file does not exist', async () => {
    const { WhisperStt } = await import('../../electron/voice/whisper');
    const modelPath = path.join(os.tmpdir(), 'easyeditor-test-whisper-model.bin');
    fs.writeFileSync(modelPath, '');
    try {
      const instance = new WhisperStt();
      await expect(
        instance.transcribe('/nonexistent/audio.wav', 'ur', modelPath),
      ).rejects.toThrow('آڈیو فائل نہیں ملی');
    } finally {
      fs.rmSync(modelPath, { force: true });
    }
  });
});
