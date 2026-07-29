import { ipcMain, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { ALLOWED_IPC_CHANNELS } from './registry.js';
import type { VoiceSynthesizeRequest, VoiceTranscribeRequest } from '../../src/core/voice/types.js';
import { synthesizeWithPiper } from '../voice/piper.js';
import { synthesizeWithEdgeTts } from '../voice/edgeTts.js';
import { transcribeWithWhisper } from '../voice/whisper.js';
import { listModels, downloadModel, deleteModel, getModelPath } from '../voice/modelManager.js';

export function registerVoiceHandlers(): void {
  ipcMain.handle(
    ALLOWED_IPC_CHANNELS.VOICE_SYNTHESIZE,
    async (_event, req: VoiceSynthesizeRequest) => {
      const { text, lang, engineId, voiceId } = req;
      if (engineId === 'edge-tts') {
        const buffer = await synthesizeWithEdgeTts(text, lang);
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      }
      // Default to Piper local TTS
      const modelPath = voiceId ? getModelPath(voiceId) ?? '' : '';
      const buffer = await synthesizeWithPiper(text, modelPath);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
  );

  ipcMain.handle(
    ALLOWED_IPC_CHANNELS.VOICE_TRANSCRIBE,
    async (_event, req: VoiceTranscribeRequest) => {
      const { audioPath, lang, engineId } = req;
      const modelId = engineId ?? 'whisper-small';
      const modelPath = getModelPath(modelId) ?? '';
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
      const targetPath = path.join(clonesDir, filename);
      fs.writeFileSync(targetPath, Buffer.from(buffer));
      return targetPath;
    },
  );
}
