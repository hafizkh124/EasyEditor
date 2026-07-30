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

const ONLINE_CONSENT_KEY = 'voice_online_engine_consent';

/**
 * SPEC-M5 FR-6.6: has the user explicitly accepted that text sent to the online
 * engine leaves their machine (to Microsoft)? Only an exact 'true' counts — a
 * missing or malformed value is treated as "no".
 */
export function hasOnlineConsent(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(ONLINE_CONSENT_KEY) === 'true';
}

export function setOnlineConsent(granted: boolean): void {
  if (typeof localStorage === 'undefined') return;
  if (granted) {
    localStorage.setItem(ONLINE_CONSENT_KEY, 'true');
  } else {
    localStorage.removeItem(ONLINE_CONSENT_KEY);
  }
}

export function getAvailableEngines(): { tts: string[]; stt: string[] } {
  return {
    tts: ['piper', 'edge-tts', 'cloud'],
    stt: ['whisper', 'cloud'],
  };
}
