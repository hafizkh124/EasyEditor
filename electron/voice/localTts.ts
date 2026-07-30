// Local (Piper) synthesis with the FR-6.5 per-script split applied.
//
// Extracted from voiceHandlers so the audiobook export (FR-6.9) speaks with the
// same voice selection and the same segmentation as the Speak page, rather than
// growing a second, drifting copy of the rules.

import { synthesizeWithPiper } from './piper.js';
import { segmentedSynthesize, type TtsSynthesizeFn } from './segmentedSynthesis.js';
import { getModelPath, MODEL_CATALOG } from './modelManager.js';
import type { ScriptKind } from '../../shared/text/scriptRuns.js';

/**
 * Picks a downloaded Piper voice for `lang`. An explicit `voiceId` wins; otherwise
 * the catalogue's first downloaded Piper voice for that language is used, so the
 * FR-6.6 fallback works without the caller having to name a model.
 */
export function resolvePiperModelPath(lang: string, voiceId?: string): string {
  if (voiceId) {
    const explicit = getModelPath(voiceId);
    if (explicit) return explicit;
  }
  const base = lang.split('-')[0];
  const candidates = MODEL_CATALOG.filter(
    (m) => m.engine === 'piper' && (m.langs.includes(lang) || m.langs.includes(base)),
  );
  for (const candidate of candidates) {
    const candidatePath = getModelPath(candidate.id);
    if (candidatePath) return candidatePath;
  }
  return '';
}

/**
 * SPEC-M5 FR-6.5: Urdu scholarly prose is full of Arabic quotations, and Piper's
 * Urdu voice mispronounces them ("Quality may vary on mixed-language input").
 * So the text is split by script and each run spoken by the voice for its own
 * language, then the audio is joined.
 *
 * Voices that are not downloaded fall back to the primary one — a missing Arabic
 * voice costs pronunciation quality on those runs, which is the behaviour before
 * FR-6.5, and is still far better than refusing to speak at all.
 */
export async function synthesizeLocalTts(
  text: string,
  lang: string,
  voiceId?: string,
): Promise<Buffer> {
  const primaryPath = resolvePiperModelPath(lang, voiceId);
  if (!primaryPath) {
    throw new Error(
      `اس زبان (${lang}) کا کوئی Piper ماڈل ڈاؤن لوڈ نہیں — Settings کے ماڈل مینیجر سے ڈاؤن لوڈ کریں۔`,
    );
  }

  const urduPath = resolvePiperModelPath('ur') || primaryPath;
  const arabicPath = resolvePiperModelPath('ar') || primaryPath;

  const speakWith = (modelPath: string): TtsSynthesizeFn => (runText: string) =>
    synthesizeWithPiper(runText, modelPath);

  let buffer: Buffer;
  if (urduPath === arabicPath && urduPath === primaryPath) {
    // Only one voice is available, so splitting would just add joins for nothing.
    buffer = await synthesizeWithPiper(text, primaryPath);
  } else {
    const engines = new Map<ScriptKind, TtsSynthesizeFn>([
      ['urdu', speakWith(urduPath)],
      ['arabic', speakWith(arabicPath)],
      ['latin', speakWith(primaryPath)],
      ['neutral', speakWith(primaryPath)],
    ]);
    // Ambiguous Arabic-script runs (no Urdu- or Arabic-only markers) are decided
    // by the requested language rather than always defaulting to Urdu.
    const fallbackScript = lang.split('-')[0] === 'ar' ? 'arabic' : 'urdu';
    buffer = await segmentedSynthesize(text, engines, fallbackScript);
  }

  // FR-6.6: never hand back empty audio as if synthesis had succeeded.
  if (buffer.length === 0) {
    throw new Error('Piper سے کوئی آڈیو نہیں ملا۔');
  }
  return buffer;
}
