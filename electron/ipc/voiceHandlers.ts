import { ipcMain, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { ALLOWED_IPC_CHANNELS } from './registry.js';
import type {
  VoiceSynthesizeRequest,
  VoiceSynthesizeResult,
  VoiceTranscribeRequest,
} from '../../src/core/voice/types.js';
import { synthesizeWithPiper } from '../voice/piper.js';
import { synthesizeWithEdgeTts } from '../voice/edgeTts.js';
import { segmentedSynthesize, type TtsSynthesizeFn } from '../voice/segmentedSynthesis.js';
import type { ScriptKind } from '../../shared/text/scriptRuns.js';
import { transcribeWithWhisper } from '../voice/whisper.js';
import {
  listModels,
  downloadModel,
  deleteModel,
  getModelPath,
  MODEL_CATALOG,
} from '../voice/modelManager.js';

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

/**
 * Picks a downloaded Piper voice for `lang`. An explicit `voiceId` wins; otherwise
 * the catalogue's first downloaded Piper voice for that language is used, so the
 * FR-6.6 fallback works without the caller having to name a model.
 */
function resolvePiperModelPath(lang: string, voiceId?: string): string {
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
async function synthesizeWithPiperChecked(
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

export function registerVoiceHandlers(): void {
  ipcMain.handle(
    ALLOWED_IPC_CHANNELS.VOICE_SYNTHESIZE,
    async (_event, req: VoiceSynthesizeRequest): Promise<VoiceSynthesizeResult> => {
      const { text, lang, engineId, voiceId, onlineConsent } = req;

      if (engineId === 'edge-tts') {
        // FR-6.6: no consent, no request — the text must not leave the machine.
        if (onlineConsent !== true) {
          throw new Error(
            'آن لائن Edge TTS کے لیے صریح رضامندی درکار ہے — Settings سے اجازت دیں یا Piper (مقامی) استعمال کریں۔',
          );
        }
        try {
          const buffer = await synthesizeWithEdgeTts(text, lang, true);
          return { audio: toArrayBuffer(buffer), engineUsed: 'edge-tts', mimeType: 'audio/mpeg' };
        } catch (err) {
          // FR-6.6: fall back to local Piper on any online failure, and report
          // why — so the user never gets silence, and never mistakes the result
          // for online-quality audio.
          const reason = err instanceof Error ? err.message : String(err);
          try {
            const buffer = await synthesizeWithPiperChecked(text, lang, voiceId);
            return {
              audio: toArrayBuffer(buffer),
              engineUsed: 'piper',
              mimeType: 'audio/wav',
              fallbackFrom: 'edge-tts',
              fallbackReason: reason,
            };
          } catch (fallbackErr) {
            const fallbackReason =
              fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
            throw new Error(
              `آن لائن Edge TTS ناکام (${reason})، اور مقامی Piper بھی نہیں چل سکا (${fallbackReason})۔`,
            );
          }
        }
      }

      const buffer = await synthesizeWithPiperChecked(text, lang, voiceId);
      return { audio: toArrayBuffer(buffer), engineUsed: 'piper', mimeType: 'audio/wav' };
    },
  );

  ipcMain.handle(
    ALLOWED_IPC_CHANNELS.VOICE_TRANSCRIBE,
    async (_event, req: VoiceTranscribeRequest) => {
      const { audioPath, audio, lang, engineId } = req;
      const modelId = engineId ?? 'whisper-small';
      const modelPath = getModelPath(modelId) ?? '';

      if (audio) {
        // The renderer holds decoded audio chunks in memory, not on disk, and
        // whisper.cpp reads from a path — so the bytes land in a temp file that
        // is removed again whether or not transcription succeeds.
        const tmpDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'easyeditor-stt-'));
        const tmpPath = path.join(tmpDir, 'chunk.wav');
        try {
          fs.writeFileSync(tmpPath, Buffer.from(audio));
          return await transcribeWithWhisper(tmpPath, lang, modelPath);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      }

      if (!audioPath) {
        throw new Error('ٹرانسکرپشن کے لیے نہ آڈیو ڈیٹا دیا گیا، نہ فائل کا راستہ۔');
      }
      return transcribeWithWhisper(audioPath, lang, modelPath);
    },
  );

  ipcMain.handle(ALLOWED_IPC_CHANNELS.VOICE_GET_MODELS, async () => {
    return listModels();
  });

  ipcMain.handle(
    ALLOWED_IPC_CHANNELS.VOICE_DOWNLOAD_MODEL,
    async (event, payload: string | { modelId: string }) => {
      const modelId = typeof payload === 'string' ? payload : payload.modelId;
      return downloadModel(modelId, (progress) => {
        event.sender.send(ALLOWED_IPC_CHANNELS.VOICE_DOWNLOAD_MODEL_PROGRESS, progress);
      });
    },
  );

  ipcMain.handle(
    ALLOWED_IPC_CHANNELS.VOICE_DELETE_MODEL,
    async (_event, payload: string | { modelId: string }) => {
      const modelId = typeof payload === 'string' ? payload : payload.modelId;
      return deleteModel(modelId);
    },
  );

  ipcMain.handle(ALLOWED_IPC_CHANNELS.VOICE_SIDECAR_STATUS, async () => {
    const { checkSidecarStatus } = await import('../voice/pythonSidecar.js');
    return checkSidecarStatus();
  });

  ipcMain.handle(ALLOWED_IPC_CHANNELS.VOICE_SIDECAR_INSTALL, async () => {
    const { installSidecarEnv } = await import('../voice/pythonSidecar.js');
    return installSidecarEnv();
  });

  ipcMain.handle(
    ALLOWED_IPC_CHANNELS.VOICE_SAVE_CLONE_SAMPLE,
    async (_event, buffer: ArrayBuffer, filename: string) => {
      const clonesDir = path.join(app.getPath('userData'), 'voice-clones');
      if (!fs.existsSync(clonesDir)) {
        fs.mkdirSync(clonesDir, { recursive: true });
      }

      // SPEC-M5 FR-2.2: filename comes from the renderer and must never be
      // trusted as a path fragment — path.basename() strips any directory
      // components (so "../../evil.txt" collapses to "evil.txt"), and the
      // resolved-path check below is a second, independent guard against
      // any escape this platform's path.basename() might miss.
      const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
      if (!safeName || safeName.startsWith('.')) {
        throw new Error('Invalid filename for voice clone sample.');
      }
      const targetPath = path.join(clonesDir, safeName);
      if (!targetPath.startsWith(clonesDir + path.sep)) {
        throw new Error('Path escape blocked for voice clone sample.');
      }

      fs.writeFileSync(targetPath, Buffer.from(buffer));
      return targetPath;
    },
  );
}
