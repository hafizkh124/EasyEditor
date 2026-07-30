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

const UR_VOICE = '/models/piper-ur_PK-male-medium.onnx';
const AR_VOICE = '/models/piper-ar_JO-kareem.onnx';

describe('Segmented synthesis (SPEC-M5 FR-6.5)', () => {
  beforeEach(async () => {
    handlers.clear();
    vi.clearAllMocks();
    getModelPath.mockImplementation((modelId) => `/models/${modelId}.onnx`);
    synthesizeWithPiper.mockResolvedValue(Buffer.from('AUDIO'));
    const { registerVoiceHandlers } = await import('../../electron/ipc/voiceHandlers');
    registerVoiceHandlers();
  });

  // The decisive test named in the SPEC-M5 acceptance checklist.
  it('speaks an Arabic quotation inside Urdu prose with the Arabic voice', async () => {
    await invokeSynthesize({
      text: 'یہ حدیث ہے «إنما الأعمال بالنيات» اور اس کا مطلب واضح ہے۔',
      lang: 'ur-PK',
      engineId: 'piper',
    });

    const byVoice = (voice: string) =>
      synthesizeWithPiper.mock.calls.filter((c) => c[1] === voice).map((c) => c[0]);

    const arabicSpoken = byVoice(AR_VOICE).join(' ');
    const urduSpoken = byVoice(UR_VOICE).join(' ');

    expect(arabicSpoken).toContain('إنما الأعمال بالنيات');
    expect(urduSpoken).toContain('یہ حدیث ہے');
    expect(urduSpoken).toContain('اور اس کا مطلب واضح ہے');
    // The quotation must not also be read by the Urdu voice.
    expect(urduSpoken).not.toContain('إنما');
  });

  it('loses no text across the split', async () => {
    const text = 'یہ حدیث ہے «إنما الأعمال بالنيات» اور اس کا مطلب واضح ہے۔';
    await invokeSynthesize({ text, lang: 'ur-PK', engineId: 'piper' });

    const spoken = synthesizeWithPiper.mock.calls.map((c) => c[0]).join('');
    // Every non-space character of the source must have been handed to some voice.
    expect(spoken.replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
  });

  it('does not split when only one voice is downloaded', async () => {
    getModelPath.mockImplementation((modelId) =>
      modelId === 'piper-ur_PK-male-medium' ? UR_VOICE : null,
    );
    const text = 'یہ حدیث ہے «إنما الأعمال بالنيات» اور باقی اردو۔';
    await invokeSynthesize({ text, lang: 'ur-PK', engineId: 'piper' });

    // One call with the whole text — a missing Arabic voice costs pronunciation,
    // not the audio itself.
    expect(synthesizeWithPiper).toHaveBeenCalledTimes(1);
    expect(synthesizeWithPiper).toHaveBeenCalledWith(text, UR_VOICE);
  });

  it('decides marker-less Arabic-script runs by the requested language', async () => {
    // 'مرحبا' carries neither Urdu-only nor Arabic-only letters.
    await invokeSynthesize({ text: 'مرحبا', lang: 'ar', engineId: 'piper' });
    expect(synthesizeWithPiper).toHaveBeenCalledWith('مرحبا', AR_VOICE);

    vi.clearAllMocks();
    synthesizeWithPiper.mockResolvedValue(Buffer.from('AUDIO'));
    await invokeSynthesize({ text: 'مرحبا', lang: 'ur-PK', engineId: 'piper' });
    expect(synthesizeWithPiper).toHaveBeenCalledWith('مرحبا', UR_VOICE);
  });

  it('applies the split to the edge-tts fallback too', async () => {
    synthesizeWithEdgeTts.mockRejectedValue(new Error('offline'));
    await invokeSynthesize({
      text: 'یہ اردو ہے «إنما الأعمال بالنيات» بس۔',
      lang: 'ur-PK',
      engineId: 'edge-tts',
      onlineConsent: true,
    });
    const voicesUsed = new Set(synthesizeWithPiper.mock.calls.map((c) => c[1]));
    expect(voicesUsed).toEqual(new Set([UR_VOICE, AR_VOICE]));
  });
});
