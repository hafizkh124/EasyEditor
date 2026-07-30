import { ipcMain, app, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { ALLOWED_IPC_CHANNELS } from './registry.js';
import type {
  VoiceSynthesizeRequest,
  VoiceSynthesizeResult,
  VoiceTranscribeRequest,
  AudiobookExportRequest,
} from '../../src/core/voice/types.js';
import { synthesizeWithEdgeTts } from '../voice/edgeTts.js';
import { synthesizeLocalTts } from '../voice/localTts.js';
import { transcribeWithWhisper } from '../voice/whisper.js';
import { listModels, downloadModel, deleteModel, getModelPath } from '../voice/modelManager.js';

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
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
            const buffer = await synthesizeLocalTts(text, lang, voiceId);
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

      const buffer = await synthesizeLocalTts(text, lang, voiceId);
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

  // SPEC-M5 FR-6.9. A book-length export runs for minutes, so it reports progress
  // and can be cancelled; the flag is per-window so two windows cannot cancel
  // each other's export.
  const cancelledExports = new Set<number>();

  ipcMain.handle(
    ALLOWED_IPC_CHANNELS.VOICE_CANCEL_AUDIOBOOK,
    async (event) => {
      cancelledExports.add(event.sender.id);
    },
  );

  ipcMain.handle(
    ALLOWED_IPC_CHANNELS.VOICE_EXPORT_AUDIOBOOK,
    async (event, req: AudiobookExportRequest) => {
      const senderId = event.sender.id;
      cancelledExports.delete(senderId);

      const { exportAudiobook, AudiobookCancelledError } = await import('../voice/audiobook.js');

      try {
        const result = await exportAudiobook({
          chapters: req.chapters,
          lang: req.lang,
          voiceId: req.voiceId,
          title: req.title,
          bitrateKbps: req.bitrateKbps,
          isCancelled: () => cancelledExports.has(senderId),
          onProgress: (progress) => {
            event.sender.send(ALLOWED_IPC_CHANNELS.VOICE_EXPORT_AUDIOBOOK_PROGRESS, progress);
          },
        });

        // The file is written from main via a save dialog: handing a
        // hundred-megabyte buffer back to the renderer only for it to write the
        // same bytes out again would double the peak memory for nothing.
        const suggested = `${(req.title || 'audiobook').replace(/[^\p{L}\p{N} ._-]/gu, '_')}.mp3`;
        const { canceled, filePath } = await dialog.showSaveDialog({
          defaultPath: suggested,
          filters: [{ name: 'MP3', extensions: ['mp3'] }],
        });
        if (canceled || !filePath) {
          return { cancelled: true as const };
        }

        onProgressWriting(event);
        fs.writeFileSync(filePath, result.mp3);

        return {
          cancelled: false as const,
          filePath,
          durationMs: result.durationMs,
          chapterCount: result.chapters.length,
          bytes: result.mp3.length,
        };
      } catch (err) {
        if (err instanceof AudiobookCancelledError) {
          return { cancelled: true as const };
        }
        throw err;
      } finally {
        cancelledExports.delete(senderId);
      }
    },
  );
}

function onProgressWriting(event: { sender: Electron.WebContents }): void {
  event.sender.send(ALLOWED_IPC_CHANNELS.VOICE_EXPORT_AUDIOBOOK_PROGRESS, { phase: 'writing' });
}
