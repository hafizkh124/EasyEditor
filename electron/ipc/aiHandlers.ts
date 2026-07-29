import { ipcMain, BrowserWindow } from 'electron';
import { ALLOWED_IPC_CHANNELS } from './registry.js';
import {
  saveGeminiKey,
  getGeminiKeyStatus,
  deleteGeminiKey,
} from '../ai/keyStore.js';
import {
  testGeminiKey,
  generateContentStream,
  embedTextContent,
  GeminiGenerateRequest,
  ByokApiError,
  redactKeyFromLog,
} from '../ai/geminiClient.js';

export function registerAiHandlers(): void {
  ipcMain.handle(ALLOWED_IPC_CHANNELS.AI_SAVE_KEY, async (_event, key: string) => {
    return saveGeminiKey(key);
  });

  ipcMain.handle(ALLOWED_IPC_CHANNELS.AI_GET_KEY_STATUS, async () => {
    return getGeminiKeyStatus();
  });

  ipcMain.handle(ALLOWED_IPC_CHANNELS.AI_DELETE_KEY, async () => {
    await deleteGeminiKey();
    return true;
  });

  ipcMain.handle(ALLOWED_IPC_CHANNELS.AI_TEST_KEY, async (_event, key?: string) => {
    return testGeminiKey(key);
  });

  ipcMain.handle(
    ALLOWED_IPC_CHANNELS.AI_INVOKE,
    async (
      event,
      req: GeminiGenerateRequest & { streamChannelId?: string; mode?: 'generate' | 'embed' },
    ) => {
      const window = BrowserWindow.fromWebContents(event.sender);

      if (req.mode === 'embed') {
        return embedTextContent(req.prompt);
      }

      try {
        const streamChannelId = req.streamChannelId;
        const result = await generateContentStream(req, (chunk) => {
          if (streamChannelId && window && !window.isDestroyed()) {
            window.webContents.send(streamChannelId, { chunk });
          }
        });

        if (streamChannelId && window && !window.isDestroyed()) {
          window.webContents.send(streamChannelId, { done: true });
        }

        return { text: result };
      } catch (err: unknown) {
        const msg = err instanceof ByokApiError ? err.message : err instanceof Error ? err.message : String(err);
        const redactedMsg = redactKeyFromLog(msg);
        
        if (req.streamChannelId && window && !window.isDestroyed()) {
          window.webContents.send(req.streamChannelId, { error: redactedMsg });
        }

        throw new Error(redactedMsg);
      }
    },
  );
}
