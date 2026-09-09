/**
 * Cloud Shamela (شامله لنک) — IPC handlers (ADR-0044).
 *
 * One `SHAMELA_CLOUD_INVOKE` channel with an action switch (the Tafsir / Shamela
 * pattern). `status` never returns a token — only booleans (ADR-0036). `connect`
 * may trigger the interactive OAuth flow (opens the user's browser).
 */
import { ipcMain } from 'electron';
import { ALLOWED_IPC_CHANNELS } from './registry.js';
import { logger } from '../lib/logger.js';
import {
  connectCloud,
  disconnectCloud,
  signOutCloud,
  cloudStatus,
  listCloudToolsRaw,
} from '../shamela/cloudClient.js';

const log = logger.child('ipc/shamelaCloud');

export function registerShamelaCloudHandlers(): void {
  ipcMain.handle(
    ALLOWED_IPC_CHANNELS.SHAMELA_CLOUD_INVOKE,
    async (_event, payload: { action: string; [key: string]: unknown }) => {
      switch (payload.action) {
        case 'status':
          return cloudStatus();

        case 'connect': {
          try {
            await connectCloud();
            return { ...cloudStatus(), ok: true };
          } catch (err) {
            log.warn('شامله لنک connect failed', { message: (err as Error).message });
            return { ...cloudStatus(), ok: false, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'disconnect':
          await disconnectCloud();
          return { disconnected: true };

        case 'signOut':
          await signOutCloud();
          return { signedOut: true };

        case 'listTools':
          try {
            return { tools: await listCloudToolsRaw() };
          } catch (err) {
            return { tools: [], error: err instanceof Error ? err.message : String(err) };
          }

        default:
          throw new Error(`unknown shamela-cloud action: ${payload.action}`);
      }
    },
  );
}
