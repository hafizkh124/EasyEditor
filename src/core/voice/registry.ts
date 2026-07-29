export const ENGINE_DEFAULTS: Record<string, string> = {
  'ur-PK': 'piper',
  'ur': 'piper',
  'ar': 'piper',
  'en': 'cloud',
};

const STORAGE_PREFIX = 'voice_preferred_engine_';

export function getDefaultEngineId(lang: string): string {
  return ENGINE_DEFAULTS[lang] ?? ENGINE_DEFAULTS[lang.split('-')[0]] ?? 'cloud';
}

export function setPreferredEngine(lang: string, engineId: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(`${STORAGE_PREFIX}${lang}`, engineId);
  }
}

export function getPreferredEngine(lang: string): string {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${lang}`);
    if (stored) {
      return stored;
    }
  }
  return getDefaultEngineId(lang);
}

export function getAvailableEngines(): { tts: string[]; stt: string[] } {
  return {
    tts: ['piper', 'edge-tts', 'cloud'],
    stt: ['whisper', 'cloud'],
  };
}
