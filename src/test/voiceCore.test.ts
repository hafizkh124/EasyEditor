import { describe, it, expect, beforeEach, vi } from 'vitest';
import { formatSrtTime, toSrt } from '../lib/subtitles/toSrt';
import { formatVttTime, toVtt } from '../lib/subtitles/toVtt';
import {
  getDefaultEngineId,
  getPreferredEngine,
  setPreferredEngine,
  getAvailableEngines,
  hasOnlineConsent,
  setOnlineConsent,
} from '../core/voice/registry';
import { LocalTtsEngine, LocalSttEngine } from '../core/voice/localEngines';
import { CloudTtsEngine, CloudSttEngine } from '../core/voice/cloudEngines';

vi.mock('@/core/ai/aiAdapter', () => ({
  callEdgeFunction: vi.fn().mockResolvedValue({ data: [], error: undefined }),
}));

describe('Subtitle Converters', () => {
  const sampleSegments = [
    { start: 0, end: 2.5, text: 'Hello world' },
    { start: 2.5, end: 5.123, text: 'Arabic text: مرحبا' },
  ];

  it('formats SRT time correctly', () => {
    expect(formatSrtTime(0)).toBe('00:00:00,000');
    expect(formatSrtTime(65.123)).toBe('00:01:05,123');
    expect(formatSrtTime(3665.999)).toBe('01:01:05,999');
  });

  it('converts segments to SRT format', () => {
    const srt = toSrt(sampleSegments);
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,500\nHello world');
    expect(srt).toContain('2\n00:00:02,500 --> 00:00:05,123\nArabic text: مرحبا');
  });

  it('formats VTT time correctly', () => {
    expect(formatVttTime(0)).toBe('00:00:00.000');
    expect(formatVttTime(65.123)).toBe('00:01:05.123');
    expect(formatVttTime(3665.999)).toBe('01:01:05.999');
  });

  it('converts segments to VTT format', () => {
    const vtt = toVtt(sampleSegments);
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
    expect(vtt).toContain('00:00:00.000 --> 00:00:02.500\nHello world');
    expect(vtt).toContain('00:00:02.500 --> 00:00:05.123\nArabic text: مرحبا');
  });
});

describe('Voice Registry', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns default engine for languages', () => {
    expect(getDefaultEngineId('ur-PK')).toBe('piper');
    expect(getDefaultEngineId('ar')).toBe('piper');
    expect(getDefaultEngineId('en')).toBe('cloud');
    expect(getDefaultEngineId('fr')).toBe('cloud');
  });

  it('stores and retrieves preferred engine in localStorage', () => {
    expect(getPreferredEngine('ur-PK')).toBe('piper');
    setPreferredEngine('ur-PK', 'edge-tts');
    expect(getPreferredEngine('ur-PK')).toBe('edge-tts');
  });

  it('withholds online consent until it is explicitly granted', () => {
    expect(hasOnlineConsent()).toBe(false);
    setOnlineConsent(true);
    expect(hasOnlineConsent()).toBe(true);
    setOnlineConsent(false);
    expect(hasOnlineConsent()).toBe(false);
  });

  it('does not read a malformed consent value as permission', () => {
    localStorage.setItem('voice_online_engine_consent', 'yes');
    expect(hasOnlineConsent()).toBe(false);
  });

  it('returns available engines list', () => {
    const engines = getAvailableEngines();
    expect(engines.tts).toContain('piper');
    expect(engines.stt).toContain('whisper');
  });
});

describe('Voice Engines (Local & Cloud)', () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>).electronAPI;
  });

  it('throws error when LocalTtsEngine called in non-desktop mode', async () => {
    const engine = new LocalTtsEngine();
    await expect(engine.synthesize('test', 'ur')).rejects.toThrow(
      'Local TTS engine is only available in the desktop app.',
    );
  });

  it('throws error when LocalSttEngine called in non-desktop mode', async () => {
    const engine = new LocalSttEngine();
    await expect(engine.transcribe('/path/to/audio', 'ur')).rejects.toThrow(
      'Local STT engine is only available in the desktop app.',
    );
  });

  it('cloud TTS throws without auth session', async () => {
    const cloudTts = new CloudTtsEngine();
    expect(cloudTts.isOnline).toBe(true);
    await expect(cloudTts.synthesize('hello', 'en')).rejects.toThrow('Authentication required');
  });

  it('cloud STT returns stub results with mocked edge function', async () => {
    const cloudStt = new CloudSttEngine();
    expect(cloudStt.isOnline).toBe(true);
    const segments = await cloudStt.transcribe('/path/audio', 'en');
    expect(segments).toEqual([]);
  });
});
