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

  // Optional cloud sign-in: main → renderer only. Carries the raw
  // `easyeditor://auth/callback…` URL the OS handed us after the user approved
  // the OAuth consent screen in their real browser.
  AUTH_DEEP_LINK: 'auth:deep-link',

  // BYOK AI (M5.2; per-provider since M9 Phase C — all key channels take an
  // optional providerId, default 'gemini').
  AI_SAVE_KEY: 'ai:save-key',
  AI_GET_KEY_STATUS: 'ai:get-key-status',
  AI_DELETE_KEY: 'ai:delete-key',
  AI_TEST_KEY: 'ai:test-key',
  AI_INVOKE: 'ai:invoke',
  /** Provider selection + verification (M9 Phase C, ADR-0031). */
  AI_PROVIDER: 'ai:provider',

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

  // Desktop document bridge — Word/InPage/LibreOffice (SPEC-M8, Layer 1).
  // P1 dispatches `detectTools` and `ping`; adapter actions land in P2.
  DOC_BRIDGE_INVOKE: 'docbridge:invoke',
  DOC_BRIDGE_PROGRESS: 'docbridge:progress',

  // Project folder — the .docx import/export bridge (SPEC-M8 Layer 5, ADR-0018).
  FS_INVOKE: 'fs:invoke',
  FS_CHANGED: 'fs:changed',

  // Agent — the multi-step tool loop (SPEC-M8 Layer 6, ADR-0016).
  AGENT_INVOKE: 'agent:invoke',
  AGENT_PROGRESS: 'agent:progress',

  // Connectors Hub — the connector registry, per-machine global switches, and
  // health/ping keyed by each connector's `healthKind`.
  CONNECTORS_INVOKE: 'connectors:invoke',

  // Cloud Shamela (Connectors Hub Phase 8, ADR-0044) — OAuth BYOA to shamela.link/mcp.
  SHAMELA_CLOUD_INVOKE: 'shamela-cloud:invoke',

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
  // M9 Phase 1b — the renderer's resolved light/dark theme, so the Windows
  // caption-button overlay matches the app instead of a hardcoded colour.
  SYSTEM_SET_THEME: 'system:set-theme',
} as const;

export type IpcChannel = typeof ALLOWED_IPC_CHANNELS[keyof typeof ALLOWED_IPC_CHANNELS];

const ALLOWED_SET = new Set<string>(Object.values(ALLOWED_IPC_CHANNELS));

export function isAllowedIpcChannel(channel: string): channel is IpcChannel {
  return ALLOWED_SET.has(channel);
}
