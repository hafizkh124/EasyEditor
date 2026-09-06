import { ipcMain, BrowserWindow } from 'electron';
import { ALLOWED_IPC_CHANNELS } from './registry.js';
import {
  saveProviderKey,
  getProviderKeyStatus,
  deleteProviderKey,
} from '../ai/keyStore.js';
import {
  generateContentStream,
  embedTextContent,
  GeminiGenerateRequest,
  ByokApiError,
  redactKeyFromLog,
} from '../ai/geminiClient.js';
import { testProviderKey } from '../agent/modelRouter.js';
import {
  getActiveProviderId, setActiveProviderId, markProviderVerified,
  getTextProviderId, setTextProviderId,
  verifiedProviders, resolveProvider,
} from '../ai/providerConfig.js';
import { PROVIDER_IDS, isProviderId, type ProviderId } from '../../shared/agent/providers.js';

const asProvider = (v: unknown): ProviderId => (isProviderId(v) ? v : 'gemini');
import { getWorkspaceDbService } from './workspaceHandlers.js';
import { REFINE_TEXT_ACTIONS } from '../../shared/ai/prompts/refineText.js';

export function registerAiHandlers(): void {
  // The key channels take (payload, provider?) — provider defaults to 'gemini'
  // so the M8 renderer calls keep working unchanged.
  ipcMain.handle(ALLOWED_IPC_CHANNELS.AI_SAVE_KEY, async (_event, key: string, provider?: unknown) => {
    return saveProviderKey(asProvider(provider), key);
  });

  ipcMain.handle(ALLOWED_IPC_CHANNELS.AI_GET_KEY_STATUS, async (_event, provider?: unknown) => {
    return getProviderKeyStatus(asProvider(provider));
  });

  ipcMain.handle(ALLOWED_IPC_CHANNELS.AI_DELETE_KEY, async (_event, provider?: unknown) => {
    await deleteProviderKey(asProvider(provider));
    return true;
  });

  ipcMain.handle(ALLOWED_IPC_CHANNELS.AI_TEST_KEY, async (_event, key: string, provider?: unknown) => {
    return testProviderKey(asProvider(provider), key);
  });

  ipcMain.handle(ALLOWED_IPC_CHANNELS.AI_PROVIDER, async (_event, req: { action: string; provider?: unknown; verified?: unknown }) => {
    switch (req.action) {
      case 'list':
        return PROVIDER_IDS.map((id) => {
          const p = resolveProvider(id);
          return {
            id, label: p.label, kind: p.kind, freeTier: p.freeTier,
            getKeyUrl: p.getKeyUrl, keyEnvVar: p.keyEnvVar,
            toolModel: p.toolModel, textModel: p.textModel, reasoningModel: p.reasoningModel,
            privacyNote: p.privacyNote ?? null,
            keyPattern: p.keyPattern.source,
          };
        });
      case 'state':
        return { active: getActiveProviderId(), text: getTextProviderId(), verified: verifiedProviders() };
      case 'setActive':
        setActiveProviderId(asProvider(req.provider));
        return { active: getActiveProviderId(), text: getTextProviderId() };
      case 'setText':
        setTextProviderId(isProviderId(req.provider) ? req.provider : null);
        return { active: getActiveProviderId(), text: getTextProviderId() };
      case 'markVerified':
        markProviderVerified(asProvider(req.provider), req.verified !== false);
        return { active: getActiveProviderId(), verified: verifiedProviders() };
      default:
        return { error: `unknown provider action: ${req.action}` };
    }
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

        if (req.functionName === 'refine-text') {
          // Desktop equivalent of the refine-text edge function: same action
          // prompts, run through the local BYOK Gemini path.
          const body = req.body ?? {};
          const text = String(body.text ?? '');
          const action = String(body.action ?? '');
          const customPrompt =
            typeof body.custom_prompt === 'string' ? body.custom_prompt : undefined;
          const systemPrompt = customPrompt ?? REFINE_TEXT_ACTIONS[action];

          if (!text || !systemPrompt) {
            throw new Error('اصلاح کے لیے متن اور درست ایکشن درکار ہے۔');
          }

          const refined = await generateContentStream({
            prompt: text,
            systemInstruction: systemPrompt,
          });
          return { data: { text: refined } };
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
