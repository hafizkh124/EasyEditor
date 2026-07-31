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
import { getWorkspaceDbService } from './workspaceHandlers.js';

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
      req: GeminiGenerateRequest & {
        streamChannelId?: string;
        mode?: 'generate' | 'embed' | 'edge-function';
        functionName?: string;
        body?: Record<string, unknown>;
      },
    ) => {
      const window = BrowserWindow.fromWebContents(event.sender);

      if (req.mode === 'embed') {
        return embedTextContent(req.prompt);
      }

      if (req.mode === 'edge-function') {
        // Local routes replace the cloud function one name at a time.
        // transcribe never arrives here (it branches earlier, in
        // transcribeLongForm); library-ingest now runs against the local
        // SQLite corpus. graph-extract still has no local counterpart, so it
        // refuses clearly rather than falling through to
        // generateContentStream with an undefined prompt.
        if (req.functionName === 'library-ingest') {
          const body = req.body ?? {};
          const service = await getWorkspaceDbService();
          return service.ingestLibraryItem({
            itemId: String(body.item_id ?? ''),
            offset: typeof body.offset === 'number' ? body.offset : 0,
            batchSize: typeof body.batch_size === 'number' ? body.batch_size : 100,
          });
        }

        if (req.functionName === 'graph-extract') {
          throw new Error(
            'علمی گراف (entity extraction) ابھی صرف ویب ورژن میں دستیاب ہے — ' +
              'یہ مشترکہ cloud corpus پر چلتا ہے، اس لیے مقامی موڈ میں Graph ٹیب موجود نہیں۔ ' +
              'باقی سب کچھ — کتب خانہ، تلاش، حوالہ جات — مقامی طور پر کام کرتا ہے۔',
          );
        }

        const name = req.functionName ?? '(نامعلوم)';
        throw new Error(
          `ڈیسک ٹاپ موڈ میں "${name}" ابھی دستیاب نہیں۔ یہ خصوصیت ویب ورژن میں کام کرتی ہے۔`,
        );
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
