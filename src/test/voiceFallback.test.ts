import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VoiceSynthesizeRequest, VoiceSynthesizeResult } from '../core/voice/types';

// Captures whatever registerVoiceHandlers() registers, so the synthesize handler
// can be invoked directly without a live Electron main process.
type IpcHandler = (event: unknown, req: VoiceSynthesizeRequest) => Promise<VoiceSynthesizeResult>;
const handlers = new Map<string, IpcHandler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: IpcHandler) => {
      handlers.set(channel, fn);
    },
  },
  app: { getPath: () => '/tmp/test-user-data' },
}));

const synthesizeWithEdgeTts = vi.fn<(text: string, lang: string, consent?: boolean) => Promise<Buffer>>();
const synthesizeWithPiper = vi.fn<(text: string, modelPath: string) => Promise<Buffer>>();
const getModelPath = vi.fn<(modelId: string) => string | null>();

vi.mock('../../electron/voice/edgeTts', () => ({
  synthesizeWithEdgeTts: (...args: [string, string, boolean?]) => synthesizeWithEdgeTts(...args),
}));
vi.mock('../../electron/voice/piper', () => ({
  synthesizeWithPiper: (...args: [string, string]) => synthesizeWithPiper(...args),
}));
vi.mock('../../electron/voice/modelManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../electron/voice/modelManager')>();
  return {
    ...actual,
    getModelPath: (modelId: string) => getModelPath(modelId),
    listModels: vi.fn(),
    downloadModel: vi.fn(),
    deleteModel: vi.fn(),
  };
});

const SYNTHESIZE_CHANNEL = 'voice:synthesize';

async function invokeSynthesize(req: VoiceSynthesizeRequest): Promise<VoiceSynthesizeResult> {
  const handler = handlers.get(SYNTHESIZE_CHANNEL);
  if (!handler) throw new Error('synthesize handler was never registered');
  return handler(null, req);
}

describe('TTS engine fallback (SPEC-M5 FR-6.6)', () => {
  beforeEach(async () => {
    handlers.clear();
    vi.clearAllMocks();
    // Piper voices count as downloaded unless a test says otherwise.
    getModelPath.mockImplementation((modelId) => `/models/${modelId}.onnx`);
    synthesizeWithPiper.mockResolvedValue(Buffer.from('PIPER-WAV-AUDIO'));
    const { registerVoiceHandlers } = await import('../../electron/ipc/voiceHandlers');
    registerVoiceHandlers();
  });

  it('refuses the online engine without consent, and sends nothing', async () => {
    await expect(
      invokeSynthesize({ text: 'سلام', lang: 'ur-PK', engineId: 'edge-tts' }),
    ).rejects.toThrow('صریح رضامندی درکار ہے');
    expect(synthesizeWithEdgeTts).not.toHaveBeenCalled();
  });

  it('treats a missing consent flag as a refusal, not as permission', async () => {
    await expect(
      invokeSynthesize({
        text: 'سلام',
        lang: 'ur-PK',
        engineId: 'edge-tts',
        onlineConsent: false,
      }),
    ).rejects.toThrow('صریح رضامندی درکار ہے');
    expect(synthesizeWithEdgeTts).not.toHaveBeenCalled();
  });

  it('reports edge-tts audio as MP3 from the online engine', async () => {
    synthesizeWithEdgeTts.mockResolvedValue(Buffer.from('EDGE-MP3-AUDIO'));
    const result = await invokeSynthesize({
      text: 'سلام',
      lang: 'ur-PK',
      engineId: 'edge-tts',
      onlineConsent: true,
    });
    expect(result.engineUsed).toBe('edge-tts');
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.fallbackFrom).toBeUndefined();
    expect(result.audio.byteLength).toBeGreaterThan(0);
  });

  it('falls back to Piper when edge-tts fails, and says why', async () => {
    synthesizeWithEdgeTts.mockRejectedValue(new Error('Edge TTS WebSocket error: 403'));
    const result = await invokeSynthesize({
      text: 'سلام',
      lang: 'ur-PK',
      engineId: 'edge-tts',
      onlineConsent: true,
    });
    expect(result.engineUsed).toBe('piper');
    expect(result.mimeType).toBe('audio/wav');
    expect(result.fallbackFrom).toBe('edge-tts');
    expect(result.fallbackReason).toContain('403');
    // Never empty audio.
    expect(result.audio.byteLength).toBeGreaterThan(0);
    expect(synthesizeWithPiper).toHaveBeenCalled();
  });

  it('picks the Piper voice for the language when no voiceId is given', async () => {
    synthesizeWithEdgeTts.mockRejectedValue(new Error('offline'));
    await invokeSynthesize({
      text: 'مرحبا',
      lang: 'ar',
      engineId: 'edge-tts',
      onlineConsent: true,
    });
    expect(synthesizeWithPiper).toHaveBeenCalledWith('مرحبا', '/models/piper-ar_JO-kareem.onnx');
  });

  it('reports both failures when edge-tts fails and no Piper voice is downloaded', async () => {
    synthesizeWithEdgeTts.mockRejectedValue(new Error('Edge TTS WebSocket error: 403'));
    getModelPath.mockReturnValue(null);
    await expect(
      invokeSynthesize({
        text: 'سلام',
        lang: 'ur-PK',
        engineId: 'edge-tts',
        onlineConsent: true,
      }),
    ).rejects.toThrow(/403[\s\S]*Piper/);
  });

  it('errors instead of returning empty audio when Piper produces nothing', async () => {
    synthesizeWithPiper.mockResolvedValue(Buffer.alloc(0));
    await expect(
      invokeSynthesize({ text: 'سلام', lang: 'ur-PK', engineId: 'piper' }),
    ).rejects.toThrow('Piper سے کوئی آڈیو نہیں ملا');
  });

  it('errors when the requested language has no downloaded Piper voice', async () => {
    getModelPath.mockReturnValue(null);
    await expect(
      invokeSynthesize({ text: 'hello', lang: 'fr', engineId: 'piper' }),
    ).rejects.toThrow('کوئی Piper ماڈل ڈاؤن لوڈ نہیں');
  });
});
