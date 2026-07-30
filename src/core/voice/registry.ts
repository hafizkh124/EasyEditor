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

/**
 * The STT preference is stored separately from TTS, and is global rather than
 * per-language. Two reasons:
 *
 * - The keys must not be shared: `getPreferredEngine('ur-PK')` answers 'piper',
 *   which is meaningless for transcription, so reading it to choose an STT
 *   engine would silently resolve to the wrong thing.
 * - It is not per-language because one Whisper model covers all 99 languages,
 *   unlike Piper which needs a separate voice per language. A per-language key
 *   would also leave the Transcribe page's "auto" option with no stored answer.
 *
 * Cloud stays the default so nothing changes for existing users; local Whisper
 * needs a multi-hundred-MB model, and Settings is where the user opts in and can
 * see whether that model is present (FR-6.1).
 */
export const DEFAULT_STT_ENGINE = 'cloud';

const STT_ENGINE_KEY = 'voice_preferred_stt_engine';

export function setPreferredSttEngine(engineId: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STT_ENGINE_KEY, engineId);
}

export function getPreferredSttEngine(): string {
  if (typeof localStorage === 'undefined') return DEFAULT_STT_ENGINE;
  return localStorage.getItem(STT_ENGINE_KEY) ?? DEFAULT_STT_ENGINE;
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
