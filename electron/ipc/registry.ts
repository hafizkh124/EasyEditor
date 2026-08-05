/**
 * Electron IPC Channel Registry & Allowlist
 * 
 * Principle: Never accept arbitrary channel names from renderer.
 * Every valid channel must be explicitly registered here.
 */

export const ALLOWED_IPC_CHANNELS = {
  // System / App state
  SYSTEM_GET_VERSION: 'system:get-version',
  SYSTEM_IS_DESKTOP: 'system:is-desktop',
  SYSTEM_OPEN_EXTERNAL: 'system:open-external',

  // BYOK AI (M5.2 placeholder channels)
  AI_SAVE_KEY: 'ai:save-key',
  AI_GET_KEY_STATUS: 'ai:get-key-status',
  AI_DELETE_KEY: 'ai:delete-key',
  AI_TEST_KEY: 'ai:test-key',
  AI_INVOKE: 'ai:invoke',

  // Local SQLite Backend (M5.3 placeholder channels)
  WORKSPACE_INVOKE: 'workspace:invoke',

  // Shamela (M5.4 placeholder channels)
  SHAMELA_INVOKE: 'shamela:invoke',
  SHAMELA_DISCOVER: 'shamela:discover',
  SHAMELA_DIAGNOSE: 'shamela:diagnose',
  SHAMELA_READ: 'shamela:read',
  SHAMELA_IMPORT: 'shamela:import',
  SHAMELA_IMPORT_PROGRESS: 'shamela:import-progress',
  SHAMELA_CANCEL_IMPORT: 'shamela:cancel-import',

  // Tafsir MCP (SPEC-TAFSIR)
  TAFSIR_INVOKE: 'tafsir:invoke',
  TAFSIR_INSTALL_PROGRESS: 'tafsir:install-progress',

  // Voice (M5.5 / M5.6 placeholder channels)
  VOICE_SYNTHESIZE: 'voice:synthesize',
  VOICE_TRANSCRIBE: 'voice:transcribe',
  VOICE_GET_MODELS: 'voice:get-models',
  VOICE_DOWNLOAD_MODEL: 'voice:download-model',
  VOICE_DOWNLOAD_MODEL_PROGRESS: 'voice:download-model-progress',
  VOICE_DELETE_MODEL: 'voice:delete-model',
  VOICE_SIDECAR_STATUS: 'voice:sidecar-status',
  VOICE_SIDECAR_INSTALL: 'voice:sidecar-install',
  VOICE_SAVE_CLONE_SAMPLE: 'voice:save-clone-sample',
  VOICE_EXPORT_AUDIOBOOK: 'voice:export-audiobook',
  VOICE_EXPORT_AUDIOBOOK_PROGRESS: 'voice:export-audiobook-progress',
  VOICE_CANCEL_AUDIOBOOK: 'voice:cancel-audiobook',

  // RTL / Window
  SYSTEM_SET_TITLE: 'system:set-title',
} as const;

export type IpcChannel = typeof ALLOWED_IPC_CHANNELS[keyof typeof ALLOWED_IPC_CHANNELS];

const ALLOWED_SET = new Set<string>(Object.values(ALLOWED_IPC_CHANNELS));

export function isAllowedIpcChannel(channel: string): channel is IpcChannel {
  return ALLOWED_SET.has(channel);
}
